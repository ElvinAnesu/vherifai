const supabase = require("../lib/supabase-client");

function businessDisplayName(business) {
  if (!business) return "Unknown";
  return business.official_business_name || business.trading_name || "Unknown";
}

async function lookupTillNumber(tillNumber) {
  const { data, error } = await supabase
    .from("vf_tillnumbers")
    .select("till_number, fraud_complaints, vf_registered_businesses(official_business_name, trading_name)")
    .eq("till_number", tillNumber)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return "Till number data not found.";
  }

  const ownerName = businessDisplayName(data.vf_registered_businesses);

  if (data.fraud_complaints === 0) {
    return `This till number belongs to ${ownerName} and has no fraud filed against it.`;
  }

  return `This till number belongs to ${ownerName} with ${data.fraud_complaints} fraud complaints.`;
}

async function getKnowledgeSummary() {
  const { data, error } = await supabase
    .from("vf_tillnumbers")
    .select("till_number, fraud_complaints, vf_registered_businesses(official_business_name, trading_name)")
    .order("till_number");

  if (error) {
    throw error;
  }

  const lines = (data || []).map((record) => {
    const ownerName = businessDisplayName(record.vf_registered_businesses);
    const fraud =
      record.fraud_complaints === 0
        ? "no fraud complaints"
        : `${record.fraud_complaints} fraud complaints`;
    return `- Till ${record.till_number}: belongs to ${ownerName}, ${fraud}`;
  });

  lines.push("- Any other till number: data not found");
  return lines.join("\n");
}

module.exports = {
  lookupTillNumber,
  getKnowledgeSummary,
};
