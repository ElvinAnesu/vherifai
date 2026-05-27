const { WELCOME_MESSAGE, PROMPTS, STAGES } = require("../store/data");
const { lookupTillNumber } = require("../store/till-numbers");
const { getSession, setSession, clearSession } = require("../store/sessions");
const { handleAiChat, updateSessionHistory } = require("./ai-chat");

function normalize(text) {
  return String(text || "").trim().toLowerCase();
}

function isOptionOne(text) {
  const value = normalize(text);
  return value === "1" || value.includes("verify till");
}

function isOptionTwo(text) {
  const value = normalize(text);
  return value === "2" || value.includes("chat with verifai");
}

function isResetMessage(text) {
  const value = normalize(text);
  return value === "menu" || value === "0" || value === "start";
}

async function startSession(phone) {
  await setSession(phone, {
    stage: STAGES.AWAITING_OPTION,
  });
}

async function handleIncomingMessage(phone, message) {

  const session = await getSession(phone);
  console.log("session:", session);

  if (!session) {
    console.log("starting session");
    await startSession(phone);
    return WELCOME_MESSAGE;
  }

  if (isResetMessage(message)) {
    await clearSession(phone);
    await startSession(phone);
    return WELCOME_MESSAGE;
  }

  if (session.stage === STAGES.AWAITING_OPTION) {
    if (isOptionOne(message)) {
      await setSession(phone, { stage: STAGES.AWAITING_TILL_NUMBER });
      return PROMPTS.ASK_TILL_NUMBER;
    }

    if (isOptionTwo(message)) {
      const intro = PROMPTS.CHAT_START;
      await setSession(phone, {
        stage: STAGES.AI_CHAT,
        history: [{ role: "assistant", content: intro }],
      });
      return intro;
    }

    return "Invalid option. Reply with 1 to verify a till number or 2 to chat with verifai.";
  }

  if (session.stage === STAGES.AWAITING_TILL_NUMBER) {
    const reply = await lookupTillNumber(normalize(message));
    await clearSession(phone);
    return reply;
  }

  if (session.stage === STAGES.AI_CHAT) {
    const reply = await handleAiChat(session, message);
    const history = updateSessionHistory(session, message, reply);
    await setSession(phone, { stage: STAGES.AI_CHAT, history });
    return reply;
  }

  await clearSession(phone);
  await startSession(phone);
  return WELCOME_MESSAGE;
}

module.exports = { handleIncomingMessage };
