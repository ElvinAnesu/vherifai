const supabase = require("../lib/supabase-client");

async function lookupTillNumber(tillNumber) {
  const { data, error } = await supabase
    .from("vf_till_numbers")
    .select("owner_name, fraud_complaints")
    .eq("till_number", tillNumber)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return "Till number data not found.";
  }

  if (data.fraud_complaints === 0) {
    return `This till number belongs to ${data.owner_name} and has no fraud filed against it.`;
  }

  return `This till number belongs to ${data.owner_name} with ${data.fraud_complaints} fraud complaints.`;
}

async function getKnowledgeSummary() {
  const { data, error } = await supabase
    .from("vf_till_numbers")
    .select("till_number, owner_name, fraud_complaints")
    .order("till_number");

  if (error) {
    throw error;
  }

  const lines = (data || []).map((record) => {
    const fraud =
      record.fraud_complaints === 0
        ? "no fraud complaints"
        : `${record.fraud_complaints} fraud complaints`;
    return `- Till ${record.till_number}: belongs to ${record.owner_name}, ${fraud}`;
  });

  lines.push("- Any other till number: data not found");
  return lines.join("\n");
}

module.exports = {
  lookupTillNumber,
  getKnowledgeSummary,
};
