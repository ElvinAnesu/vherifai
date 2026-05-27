const supabase = require("../lib/supabase-client");

async function getSession(userPhone) {

  const { data: existing, error: selectError } = await supabase
    .from("vf_sessions")
    .select("*")
    .eq("phone", userPhone)
    .eq("is_active", true)
    .maybeSingle();

  if (selectError) {
    throw selectError;
  }

  if (existing) {
    return existing;
  }

  // No active session exists — create a new one
  const { data: created, error: insertError } = await supabase
    .from("vf_sessions")
    .insert({ phone: userPhone })
    .select()
    .single();

  if (insertError) {
    throw insertError;
  }

  return created;
}

module.exports = { getSession };
