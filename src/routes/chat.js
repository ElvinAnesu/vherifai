const express = require("express");
const twilio = require("twilio");
const { processChatWebhook } = require("../helpers/conversation");
const { handleIncomingMessage } = require("../helpers/conversations");

const router = express.Router();




function logChatError(err, context) {
  console.error("[chat] Webhook processing failed", {
    message: err?.message,
    stack: err?.stack,
    name: err?.name,
    ...context,
  });
}

router.post("/", (req, res) => {
  const { Body, From, To } = req.body;

   const userPhone = From;
   const twilioNumber = To;
   const message = Body;

  (async () => {
    try {
      const sentMessage = await processChatWebhook({ message, userPhone, twilioNumber });
    } catch (err) {
      logChatError(err, { userPhone, twilioNumber, body: Body });
    }
  })();
});

module.exports = router;
