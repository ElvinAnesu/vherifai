const WELCOME_MESSAGE =
  "Hie welcome to vherifai, select an option to continue\n1. Verify till number\n2. Chat with verifai";

const PROMPTS = {
  ASK_TILL_NUMBER: "Please provide a till number.",
  CHAT_START:
    "Hie, I'm Verifai. Ask me about any till number. Reply menu to go back.",
};

const STAGES = {
  AWAITING_OPTION: "awaiting_option",
  AWAITING_TILL_NUMBER: "awaiting_till_number",
  AI_CHAT: "ai_chat",
};

module.exports = {
  WELCOME_MESSAGE,
  PROMPTS,
  STAGES,
};
