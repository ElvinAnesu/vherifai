const express = require("express");
const multer = require("multer");
const xlsx = require("xlsx");
const supabase = require("../lib/supabase-client");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/octet-stream",
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error("Only .xlsx and .xls files are allowed"));
    }
  },
});

const BUSINESS_FIELDS = [
  "official_business_name", "trading_name", "category_id",
  "goods_services", "contact_number", "socialmedia", "location",
  "website", "social_media_handle", "source", "verification",
  "tracking", "notes",
];

const BUSINESS_SELECT = "*, vf_paybills(*), vf_tillnumbers(*), vf_business_categories(*)";

const PAYBILL_FIELDS = [
  "paybill", "account_number", "payment_type", "send_money",
];

const TILLNUMBER_FIELDS = [
  "till_number", "fraud_complaints",
];

function sanitisePayload(raw, fields) {
  const payload = {};
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      const val = raw[field];
      if (val === undefined || val === null) {
        payload[field] = null;
      } else if (field === "fraud_complaints" || field === "category_id") {
        const num = Number(val);
        payload[field] = Number.isFinite(num) ? num : null;
      } else {
        const str = String(val).trim();
        payload[field] = str === "" ? null : str;
      }
    }
  });
  return payload;
}

function parseBusinessId(req, res) {
  const numericId = Number(req.params.id);
  if (!numericId || isNaN(numericId)) {
    res.status(400).json({ error: "Invalid business id" });
    return null;
  }
  return numericId;
}

function parsePaybillId(req, res) {
  const numericId = Number(req.params.id);
  if (!numericId || isNaN(numericId)) {
    res.status(400).json({ error: "Invalid paybill id" });
    return null;
  }
  return numericId;
}

function parseCategoryId(req, res) {
  const numericId = Number(req.params.id);
  if (!numericId || isNaN(numericId)) {
    res.status(400).json({ error: "Invalid category id" });
    return null;
  }
  return numericId;
}

async function getOtherCategoryId() {
  const { data, error } = await supabase
    .from("vf_business_categories")
    .select("id")
    .eq("name", "Other")
    .single();

  if (error) throw error;
  return data.id;
}

async function resolveCategoryId(raw) {
  if (raw.category_id !== undefined && raw.category_id !== null && raw.category_id !== "") {
    const numericId = Number(raw.category_id);
    if (Number.isFinite(numericId)) return numericId;
  }

  const name = raw.business_category !== undefined && raw.business_category !== null
    ? String(raw.business_category).trim()
    : "";

  if (!name || name === "??") {
    return getOtherCategoryId();
  }

  const { data } = await supabase
    .from("vf_business_categories")
    .select("id")
    .eq("name", name)
    .maybeSingle();

  if (data) return data.id;
  return getOtherCategoryId();
}

async function ensureBusinessCategory(payload) {
  if (!payload.category_id) {
    payload.category_id = await getOtherCategoryId();
  }
  return payload;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

router.get("/stats", async (req, res) => {
  try {
    const [businesses, paybills, tillnumbers, fraudReports, reviews, sessions] = await Promise.all([
      supabase.from("vf_registered_businesses").select("id", { count: "exact", head: true }),
      supabase.from("vf_paybills").select("id", { count: "exact", head: true }),
      supabase.from("vf_tillnumbers").select("id", { count: "exact", head: true }),
      supabase.from("vf_fraud_reports").select("id", { count: "exact", head: true }),
      supabase.from("vf_reviews").select("id", { count: "exact", head: true }),
      supabase.from("vf_sessions").select("phone"),
    ]);

    const uniqueUsers = sessions.data
      ? new Set(sessions.data.map((s) => s.phone)).size
      : 0;

    res.json({
      businesses: businesses.count ?? 0,
      paybills: paybills.count ?? 0,
      tillnumbers: tillnumbers.count ?? 0,
      fraudReports: fraudReports.count ?? 0,
      reviews: reviews.count ?? 0,
      uniqueUsers,
    });
  } catch (err) {
    console.error("[admin] stats error", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ─── Daily Active Users (last 7 days) ─────────────────────────────────────────

router.get("/daily-active-users", async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("vf_sessions")
      .select("phone, created_at")
      .gte("created_at", sevenDaysAgo.toISOString());

    if (error) return res.status(500).json({ error: error.message });

    const dayMap = {};

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dayMap[key] = new Set();
    }

    (data || []).forEach((row) => {
      const key = row.created_at.slice(0, 10);
      if (dayMap[key]) dayMap[key].add(row.phone);
    });

    const result = Object.entries(dayMap).map(([day, phones]) => ({
      day,
      users: phones.size,
    }));

    res.json(result);
  } catch (err) {
    console.error("[admin] daily-active-users error", err);
    res.status(500).json({ error: "Failed to fetch daily active users" });
  }
});

// ─── Businesses ───────────────────────────────────────────────────────────────

router.get("/businesses", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vf_registered_businesses")
      .select(BUSINESS_SELECT)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    console.error("[admin] list businesses error", err);
    res.status(500).json({ error: "Failed to fetch businesses" });
  }
});

router.get("/businesses/:id", async (req, res) => {
  const businessId = parseBusinessId(req, res);
  if (!businessId) return;

  try {
    const { data, error } = await supabase
      .from("vf_registered_businesses")
      .select(BUSINESS_SELECT)
      .eq("id", businessId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Business not found" });
    res.json(data);
  } catch (err) {
    console.error("[admin] get business error", err);
    res.status(500).json({ error: "Failed to fetch business" });
  }
});

router.post("/businesses", async (req, res) => {
  const payload = await ensureBusinessCategory(sanitisePayload(req.body, BUSINESS_FIELDS));

  if (!payload.official_business_name) {
    return res.status(400).json({ error: "official_business_name is required" });
  }

  try {
    const { data, error } = await supabase
      .from("vf_registered_businesses")
      .insert(payload)
      .select(BUSINESS_SELECT)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    console.error("[admin] create business error", err);
    res.status(500).json({ error: "Failed to create business" });
  }
});

router.put("/businesses/:id", async (req, res) => {
  const businessId = parseBusinessId(req, res);
  if (!businessId) return;

  const payload = sanitisePayload(req.body, BUSINESS_FIELDS);

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  if (Object.prototype.hasOwnProperty.call(payload, "category_id") && !payload.category_id) {
    payload.category_id = await getOtherCategoryId();
  }

  try {
    const { data, error } = await supabase
      .from("vf_registered_businesses")
      .update(payload)
      .eq("id", businessId)
      .select(BUSINESS_SELECT)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Business not found" });
    res.json(data);
  } catch (err) {
    console.error("[admin] update business error", err);
    res.status(500).json({ error: "Failed to update business" });
  }
});

router.delete("/businesses/:id", async (req, res) => {
  const businessId = parseBusinessId(req, res);
  if (!businessId) return;

  try {
    const { data, error } = await supabase
      .from("vf_registered_businesses")
      .delete()
      .eq("id", businessId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Business not found" });
    res.status(204).send();
  } catch (err) {
    console.error("[admin] delete business error", err);
    res.status(500).json({ error: "Failed to delete business" });
  }
});

router.post("/businesses/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: "The Excel file contains no data rows" });
    }

    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      const paybillPayload = sanitisePayload(row, PAYBILL_FIELDS);
      const businessPayload = sanitisePayload(row, BUSINESS_FIELDS);
      businessPayload.category_id = await resolveCategoryId(row);

      if (!paybillPayload.paybill) {
        skipped += 1;
        continue;
      }

      const { data: existingPaybill } = await supabase
        .from("vf_paybills")
        .select("id, business_id")
        .eq("paybill", paybillPayload.paybill)
        .maybeSingle();

      if (existingPaybill) {
        await supabase
          .from("vf_paybills")
          .update({ ...paybillPayload, updated_at: new Date().toISOString() })
          .eq("id", existingPaybill.id);

        if (Object.keys(businessPayload).length > 0) {
          await supabase
            .from("vf_registered_businesses")
            .update(businessPayload)
            .eq("id", existingPaybill.business_id);
        }
      } else {
        if (!businessPayload.official_business_name) {
          businessPayload.official_business_name = `Business ${paybillPayload.paybill}`;
        }

        const { data: newBusiness, error: bizError } = await supabase
          .from("vf_registered_businesses")
          .insert(businessPayload)
          .select("id")
          .single();

        if (bizError) {
          skipped += 1;
          continue;
        }

        const { error: paybillError } = await supabase
          .from("vf_paybills")
          .insert({ ...paybillPayload, business_id: newBusiness.id });

        if (paybillError) {
          await supabase.from("vf_registered_businesses").delete().eq("id", newBusiness.id);
          skipped += 1;
          continue;
        }
      }

      imported += 1;
    }

    if (imported === 0) {
      return res.status(400).json({
        error: "No valid rows found. Each row must have a non-empty paybill column.",
      });
    }

    res.status(201).json({
      message: `Successfully imported ${imported} business record(s).`,
      imported,
      skipped,
    });
  } catch (err) {
    console.error("[admin] import businesses error", err);
    res.status(500).json({ error: "Failed to parse or import the Excel file" });
  }
});

// ─── Categories ───────────────────────────────────────────────────────────────

router.get("/categories", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vf_business_categories")
      .select("*")
      .order("name", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    console.error("[admin] list categories error", err);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

router.post("/categories", async (req, res) => {
  const name = req.body.name ? String(req.body.name).trim() : "";

  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  try {
    const { data, error } = await supabase
      .from("vf_business_categories")
      .insert({ name })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    console.error("[admin] create category error", err);
    res.status(500).json({ error: "Failed to create category" });
  }
});

router.put("/categories/:id", async (req, res) => {
  const categoryId = parseCategoryId(req, res);
  if (!categoryId) return;

  const name = req.body.name ? String(req.body.name).trim() : "";

  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  try {
    const { data, error } = await supabase
      .from("vf_business_categories")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", categoryId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Category not found" });
    res.json(data);
  } catch (err) {
    console.error("[admin] update category error", err);
    res.status(500).json({ error: "Failed to update category" });
  }
});

router.delete("/categories/:id", async (req, res) => {
  const categoryId = parseCategoryId(req, res);
  if (!categoryId) return;

  try {
    const { count, error: countError } = await supabase
      .from("vf_registered_businesses")
      .select("id", { count: "exact", head: true })
      .eq("category_id", categoryId);

    if (countError) return res.status(500).json({ error: countError.message });

    if ((count ?? 0) > 0) {
      return res.status(400).json({
        error: "Cannot delete a category that is assigned to businesses. Reassign them first.",
      });
    }

    const { data, error } = await supabase
      .from("vf_business_categories")
      .delete()
      .eq("id", categoryId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Category not found" });
    res.status(204).send();
  } catch (err) {
    console.error("[admin] delete category error", err);
    res.status(500).json({ error: "Failed to delete category" });
  }
});

// ─── Paybills ───────────────────────────────────────────────────────────────────

router.get("/businesses/:id/paybills", async (req, res) => {
  const businessId = parseBusinessId(req, res);
  if (!businessId) return;

  try {
    const { data, error } = await supabase
      .from("vf_paybills")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    console.error("[admin] list paybills error", err);
    res.status(500).json({ error: "Failed to fetch paybills" });
  }
});

router.post("/businesses/:id/paybills", async (req, res) => {
  const businessId = parseBusinessId(req, res);
  if (!businessId) return;

  const payload = sanitisePayload(req.body, PAYBILL_FIELDS);

  if (!payload.paybill) {
    return res.status(400).json({ error: "paybill is required" });
  }

  try {
    const { data: business } = await supabase
      .from("vf_registered_businesses")
      .select("id")
      .eq("id", businessId)
      .maybeSingle();

    if (!business) return res.status(404).json({ error: "Business not found" });

    const { data, error } = await supabase
      .from("vf_paybills")
      .insert({ ...payload, business_id: businessId })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    console.error("[admin] create paybill error", err);
    res.status(500).json({ error: "Failed to create paybill" });
  }
});

router.put("/paybills/:id", async (req, res) => {
  const paybillId = parsePaybillId(req, res);
  if (!paybillId) return;

  const payload = sanitisePayload(req.body, PAYBILL_FIELDS);

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  try {
    const { data, error } = await supabase
      .from("vf_paybills")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", paybillId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Paybill not found" });
    res.json(data);
  } catch (err) {
    console.error("[admin] update paybill error", err);
    res.status(500).json({ error: "Failed to update paybill" });
  }
});

router.delete("/paybills/:id", async (req, res) => {
  const paybillId = parsePaybillId(req, res);
  if (!paybillId) return;

  try {
    const { data, error } = await supabase
      .from("vf_paybills")
      .delete()
      .eq("id", paybillId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Paybill not found" });
    res.status(204).send();
  } catch (err) {
    console.error("[admin] delete paybill error", err);
    res.status(500).json({ error: "Failed to delete paybill" });
  }
});

// ─── Till Numbers ─────────────────────────────────────────────────────────────

router.get("/businesses/:id/tillnumbers", async (req, res) => {
  const businessId = parseBusinessId(req, res);
  if (!businessId) return;

  try {
    const { data, error } = await supabase
      .from("vf_tillnumbers")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    console.error("[admin] list tillnumbers error", err);
    res.status(500).json({ error: "Failed to fetch till numbers" });
  }
});

router.post("/businesses/:id/tillnumbers", async (req, res) => {
  const businessId = parseBusinessId(req, res);
  if (!businessId) return;

  const payload = sanitisePayload(req.body, TILLNUMBER_FIELDS);

  if (!payload.till_number) {
    return res.status(400).json({ error: "till_number is required" });
  }

  try {
    const { data: business } = await supabase
      .from("vf_registered_businesses")
      .select("id")
      .eq("id", businessId)
      .maybeSingle();

    if (!business) return res.status(404).json({ error: "Business not found" });

    const { data, error } = await supabase
      .from("vf_tillnumbers")
      .insert({ ...payload, business_id: businessId })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    console.error("[admin] create tillnumber error", err);
    res.status(500).json({ error: "Failed to create till number" });
  }
});

router.put("/tillnumbers/:id", async (req, res) => {
  const tillId = req.params.id;
  if (!tillId) return res.status(400).json({ error: "Invalid till number id" });

  const payload = sanitisePayload(req.body, TILLNUMBER_FIELDS);

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  try {
    const { data, error } = await supabase
      .from("vf_tillnumbers")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", tillId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Till number not found" });
    res.json(data);
  } catch (err) {
    console.error("[admin] update tillnumber error", err);
    res.status(500).json({ error: "Failed to update till number" });
  }
});

router.delete("/tillnumbers/:id", async (req, res) => {
  const tillId = req.params.id;
  if (!tillId) return res.status(400).json({ error: "Invalid till number id" });

  try {
    const { data, error } = await supabase
      .from("vf_tillnumbers")
      .delete()
      .eq("id", tillId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Till number not found" });
    res.status(204).send();
  } catch (err) {
    console.error("[admin] delete tillnumber error", err);
    res.status(500).json({ error: "Failed to delete till number" });
  }
});

// ─── Fraud Reports ────────────────────────────────────────────────────────────

router.get("/fraud-reports", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vf_fraud_reports")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    console.error("[admin] list fraud reports error", err);
    res.status(500).json({ error: "Failed to fetch fraud reports" });
  }
});

router.post("/fraud-reports", async (req, res) => {
  const { till_number, description, reported_by } = req.body;

  if (!till_number || !description || !reported_by) {
    return res.status(400).json({ error: "till_number, description and reported_by are required" });
  }

  try {
    const { data, error } = await supabase
      .from("vf_fraud_reports")
      .insert({
        till_number: till_number.trim(),
        description: description.trim(),
        reported_by: reported_by.trim(),
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    console.error("[admin] create fraud report error", err);
    res.status(500).json({ error: "Failed to submit fraud report" });
  }
});

// ─── Reviews ──────────────────────────────────────────────────────────────────

router.get("/reviews", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vf_reviews")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    console.error("[admin] list reviews error", err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

router.post("/reviews", async (req, res) => {
  const { paybill, review, userp } = req.body;

  if (!paybill || !review) {
    return res.status(400).json({ error: "paybill and review are required" });
  }

  try {
    const { data, error } = await supabase
      .from("vf_reviews")
      .insert({
        paybill: paybill.trim(),
        review: review.trim(),
        userp: userp ? userp.trim() : null,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    console.error("[admin] create review error", err);
    res.status(500).json({ error: "Failed to submit review" });
  }
});

module.exports = router;
