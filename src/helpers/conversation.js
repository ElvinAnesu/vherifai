const { sendTextMessage, sendTemplateMessage } = require("./messages");
const { getSession } = require("./session");
const supabase = require("../lib/supabase-client");
const { mainMenuFlow, businessLookupFlow } = require("./flows");
// When you want real logic again, uncomment the next line:

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

// async function handleSessionFlow(flowId, flowStage, message, userPhone, twilioNumber){
//   console.log("flowId:", flowId);
//   console.log("flowStage:", flowStage);
//   console.log("message:", message);

//   if(flowId === 1 && flowStage === 0){
//     const sentMessage = await sendTemplateMessage(
//       twilioNumber,
//       userPhone,
//       'HX756b0bd4d9540d4fae0d56343a960033');
//       await supabase
//       .from("vf_sessions")
//       .update({ current_flow_stage: 1,})
//       .eq("phone", userPhone);
//   } else {
//     const { data: action, error: actionsError } = await supabase
//       .from("vf_flow_stages_actions")
//       .select("*, vf_flow_stages!inner(flow, stage)")
//       .eq("vf_flow_stages.flow", flowId)
//       .eq("vf_flow_stages.stage", flowStage)
//       .eq("user_message", message)
//       .maybeSingle();

//     if (actionsError) {
//       console.error("Error fetching flow stage actions:", actionsError);
//       return;
//     }

//     console.log("flow stage action:", action);

//     if (!action) {
//       console.log("No action found for message:", message);
//       return;
//     }

//     if (action.respose_type === 'text') {
//       await sendTextMessage(twilioNumber, userPhone, action.response);
//     } else if (action.respose_type === 'template') {
//       await sendTemplateMessage(twilioNumber, userPhone, action.template_id);
//     }

//     if (action.switch_flow) {
//       await supabase
//         .from("vf_sessions")
//         .update({ current_flow: action.target_flow, current_flow_stage: 0, updated_at: new Date().toISOString() })
//         .eq("phone", userPhone);
//       return;
//     }

//     if (action.is_closing) {
//       console.log("closing action");
//       return;
//     }

//     await supabase
//       .from("vf_sessions")
//       .update({ current_flow_stage: flowStage + 1,})
//       .eq("phone", userPhone);
//   }
// }


async function handleSessionFlow(flowId, flowStage, message, userPhone, twilioNumber){

  switch(flowId){
    case 1:
      mainMenuFlow(flowStage, message, userPhone, twilioNumber);
      break;
    case 2:
      businessLookupFlow(flowStage, message, userPhone, twilioNumber);
      break;
    default:
      console.log("Invalid flowId:", flowId);
  }
}

 
async function processChatWebhook({ message, userPhone, twilioNumber }) {

  //gets user sssion and return the current flow and stag
  const session = await getSession(userPhone); 

  console.log("session:", session);
  const flowId = session.current_flow;
  const flowStage = session.current_flow_stage;

  //accepts the current flow and there for they should be a function to handle each stage
  await handleSessionFlow(flowId, flowStage, message, userPhone, twilioNumber);

}

module.exports = { processChatWebhook };
