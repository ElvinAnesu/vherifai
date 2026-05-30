const express = require("express");
const supabase = require("../lib/supabase-client");

const router = express.Router();

// ─── Stats ────────────────────────────────────────────────────────────────────

router.get("/stats", async (req, res) => {
  try {
    const [businesses, fraudReports, reviews, sessions] = await Promise.all([
      supabase.from("vf_registered_businesses").select("id", { count: "exact", head: true }),
      supabase.from("vf_fraud_reports").select("id", { count: "exact", head: true }),
      supabase.from("vf_reviews").select("id", { count: "exact", head: true }),
      supabase.from("vf_sessions").select("id", { count: "exact", head: true }),
    ]);

    res.json({
      businesses: businesses.count ?? 0,
      fraudReports: fraudReports.count ?? 0,
      reviews: reviews.count ?? 0,
      sessions: sessions.count ?? 0,
    });
  } catch (err) {
    console.error("[admin] stats error", err);
    res.status(500).json({ error: "Failed to fetch stats" });
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

router.put("/businesses/:id", async (req, res) => {
  const { id } = req.params;
  const numericId = Number(id);

  if (!numericId || isNaN(numericId)) {
    return res.status(400).json({ error: "Invalid business id" });
  }

  const ALLOWED_FIELDS = [
    "payment_type", "paybill", "account_number", "send_money",
    "official_business_name", "trading_name", "business_category",
    "goods_services", "contact_number", "socialmedia", "location",
    "website", "social_media_handle", "source", "verification",
    "tracking", "notes",
  ];

  const payload = {};
  ALLOWED_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      const val = req.body[field];
      payload[field] = typeof val === "string" && val.trim() === "" ? null : val;
    }
  });

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
