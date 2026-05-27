const Anthropic = require("@anthropic-ai/sdk");

const aiClient = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

module.exports = aiClient;
