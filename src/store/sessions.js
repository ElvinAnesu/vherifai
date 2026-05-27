const supabase = require("../lib/supabase-client");

async function getSession(phone) {
  const { data, error } = await supabase
    .from("vf_sessions")
    .select("stage, history")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return {
    stage: data.stage,
    history: data.history || [],
  };
}

async function setSession(phone, session) {
  const { error } = await supabase.from("vf_sessions").upsert(
    {
      phone,
      stage: session.stage,
      history: session.history || [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "phone" }
  );

  if (error) {
    throw error;
  }
}

async function clearSession(phone) {
  const { error } = await supabase
    .from("vf_sessions")
    .delete()
    .eq("phone", phone);

  if (error) {
    throw error;
  }
}

module.exports = {
  getSession,
  setSession,
  clearSession,
};
