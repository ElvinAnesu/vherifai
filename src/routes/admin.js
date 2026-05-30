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
  "payment_type", "paybill", "account_number", "send_money",
  "official_business_name", "trading_name", "business_category",
  "goods_services", "contact_number", "socialmedia", "location",
  "website", "social_media_handle", "source", "verification",
  "tracking", "notes",
];

function sanitiseBusinessPayload(raw) {
  const payload = {};
  BUSINESS_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      const val = raw[field];
      if (val === undefined || val === null) {
        payload[field] = null;
      } else {
        const str = String(val).trim();
        payload[field] = str === "" ? null : str;
      }
    }
  });
  return payload;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

router.get("/stats", async (req, res) => {
  try {
    const [businesses, fraudReports, reviews, sessions] = await Promise.all([
      supabase.from("vf_registered_businesses").select("id", { count: "exact", head: true }),
      supabase.from("vf_fraud_reports").select("id", { count: "exact", head: true }),
      supabase.from("vf_reviews").select("id", { count: "exact", head: true }),
      supabase.from("vf_sessions").select("phone"),
    ]);

    const uniqueUsers = sessions.data
      ? new Set(sessions.data.map((s) => s.phone)).size
      : 0;

    res.json({
      businesses: businesses.count ?? 0,
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

    // Build a map of day → Set of unique phones
    const dayMap = {};

    // Pre-fill all 7 days with empty sets so days with 0 sessions still appear
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10); // "YYYY-MM-DD"
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
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    console.error("[admin] list businesses error", err);
    res.status(500).json({ error: "Failed to fetch businesses" });
  }
});

router.post("/businesses", async (req, res) => {
  const payload = sanitiseBusinessPayload(req.body);

  if (!payload.paybill) {
    return res.status(400).json({ error: "paybill is required" });
  }

  try {
    const { data, error } = await supabase
      .from("vf_registered_businesses")
      .insert(payload)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    console.error("[admin] create business error", err);
    res.status(500).json({ error: "Failed to create business" });
  }
});

router.put("/businesses/:id", async (req, res) => {
  const numericId = Number(req.params.id);

  if (!numericId || isNaN(numericId)) {
    return res.status(400).json({ error: "Invalid business id" });
  }

  const payload = sanitiseBusinessPayload(req.body);

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  try {
    const { data, error } = await supabase
      .from("vf_registered_businesses")
      .update(payload)
      .eq("id", numericId)
      .select()
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
  const numericId = Number(req.params.id);

  if (!numericId || isNaN(numericId)) {
    return res.status(400).json({ error: "Invalid business id" });
  }

  try {
    const { data, error } = await supabase
      .from("vf_registered_businesses")
      .delete()
      .eq("id", numericId)
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

    const records = rows.map((row) => sanitiseBusinessPayload(row));
    const validRecords = records.filter((r) => r.paybill);

    if (validRecords.length === 0) {
      return res.status(400).json({
        error: "No valid rows found. Each row must have a non-empty paybill column.",
      });
    }

    const { data, error } = await supabase
      .from("vf_registered_businesses")
      .upsert(validRecords, { onConflict: "paybill" })
      .select();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({
      message: `Successfully imported ${data.length} business record(s).`,
      imported: data.length,
      skipped: rows.length - validRecords.length,
    });
  } catch (err) {
    console.error("[admin] import businesses error", err);
    res.status(500).json({ error: "Failed to parse or import the Excel file" });
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
