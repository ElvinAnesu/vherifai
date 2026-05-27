const twilioClient = require("../lib/twilio-client");

async function sendTextMessage(twilioNumber, userPhone, message) {

  const result = await twilioClient.messages.create({
    from: twilioNumber,
    to: userPhone,
    body: message,
  }).then(message => console.log(message.sid)); 



  return result;
} 

async function sendTemplateMessage(twilioNumber, userPhone, teplateId) {

  const result = await twilioClient.messages.create(
    {
      from: twilioNumber,
      contentSid: teplateId,
      to: userPhone
    }
  ).then(message => console.log(message.sid)); 

  return result;

}

async function sendBusinessInfoTemplate(twilioNumber, userPhone, business, paybill, description, reports) {
  const result = await twilioClient.messages.create({
    from: twilioNumber,
    contentSid: 'HX1474f446485ef82af73dfabd913ecbdf',
    to: userPhone,
    contentVariables: JSON.stringify({ "1": business, "2": paybill, "3": description, "4": reports })
  }).then(message => console.log(message.sid));

  return result;
}

module.exports = { sendTextMessage, sendTemplateMessage, sendBusinessInfoTemplate };
