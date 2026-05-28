const supabase = require("../lib/supabase-client");
const { sendTemplateMessage, sendTextMessage, sendBusinessInfoTemplate } = require("./messages");




async function switchFlow(flowId, userPhone) {
  await supabase
    .from("vf_sessions")
    .update({ current_flow: flowId, current_flow_stage: 0, updated_at: new Date().toISOString() })
    .eq("phone", userPhone);
}

async function invalidMessage(twilioNumber, userPhone) {
  await sendTextMessage(twilioNumber, userPhone, "Oops, I did not get that, please try again.");
}

async function endSession(userPhone) {
  await supabase
    .from("vf_sessions")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("phone", userPhone);
}

async function mainMenuFlow(flowStage, message, userPhone, twilioNumber) {
  console.log("flow: main menu flow");
  console.log("flowStage:", flowStage);
  console.log("message:", message);
  if(flowStage === 0){
    const sentMessage = await sendTemplateMessage(
      twilioNumber,
      userPhone,
      'HXf3c63a81e8cbf98c1015b0b023d8fbdf');

    await supabase
    .from("vf_sessions")
    .update({ current_flow_stage: 1,})
    .eq("phone", userPhone);

    return sentMessage;
  } else if(flowStage === 1){
    switch(message){
      case 'registered_business':
        await switchFlow(2, userPhone);
        await sendTextMessage(twilioNumber, userPhone, "Send me a paybill or till number and I'll tell you what we know.");
        break;
      case 'submit_report':
        await switchFlow(3, userPhone);
        break;
      case 'suspicious_message':
        await switchFlow(4, userPhone);
        break;
      default:
        await invalidMessage(twilioNumber, userPhone);
    }
  }
}

async function businessLookupFlow(flowStage, message, userPhone, twilioNumber) {
  console.log("lookup");
  console.log("flowStage:", flowStage);
  console.log("message:", message);
  if(flowStage === 0){
    const { data: business, error } = await supabase
      .from("vf_registered_businesses")
      .select("*")
      .eq("paybill", message)
      .maybeSingle();

    if (error) {
      console.error("Error looking up business:", error);
      return;
    }

    if (business) {
      await sendBusinessInfoTemplate(
        twilioNumber,
        userPhone,
        business.official_business_name,
        business.paybill,
        business.notes,
        "0"
      );
    } else {
      await sendTemplateMessage(twilioNumber, userPhone, 'HX1671c8959b9514246d8ebba98184a32c');
    }

    await supabase
      .from("vf_sessions")
      .update({ current_flow_stage: 1, current_paybill: message, updated_at: new Date().toISOString() })
      .eq("phone", userPhone)
      .eq("is_active", true);
  } else if(flowStage === 1){
    switch(message){
      case 'More':
        const { data: sess } = await supabase
          .from("vf_sessions")
          .select("current_paybill")
          .eq("phone", userPhone)
          .eq("is_active", true)
          .maybeSingle();

        if (!sess || !sess.current_paybill) {
          await sendTextMessage(twilioNumber, userPhone, "Session expired. Please text hi to start again.");
          break;
        }

        const { data: biz } = await supabase
          .from("vf_registered_businesses")
          .select("*")
          .eq("paybill", sess.current_paybill)
          .maybeSingle();

        if (biz) {
          let details = `Report Summary\n- ${biz.official_business_name}\n${biz.paybill}`;
          if (biz.business_category) details += `\n${biz.business_category}`;
          if (biz.goods_services) details += `\n${biz.goods_services}`;
          if (biz.notes) details += `\n${biz.notes}`;
          await sendTextMessage(twilioNumber, userPhone, details);
          await sendTextMessage(twilioNumber, userPhone, "Asante kwakutumia Vherifai, just text hi to use again.");
          await endSession(userPhone);
        }
        break;
      case 'Review':
        await sendTextMessage(twilioNumber, userPhone, "Tell us your experience with this business.");
        await supabase
          .from("vf_sessions")
          .update({ current_flow_stage: 2, updated_at: new Date().toISOString() })
          .eq("phone", userPhone);
        break;
      case 'End':
        await sendTextMessage(twilioNumber, userPhone, "Asante kwakutumia Vherifai, just text hi to use again.");
        await endSession(userPhone);
        break;
      case 'Retry':
        await sendTextMessage(twilioNumber, userPhone, "Send me a paybill and i wil tell you what we know.");
        await supabase
          .from("vf_sessions")
          .update({ current_flow_stage: 0, updated_at: new Date().toISOString() })
          .eq("phone", userPhone);
        break;
      default:
        await invalidMessage(twilioNumber, userPhone);
    } 
  } else if(flowStage === 2){
    const { data: sess } = await supabase
      .from("vf_sessions")
      .select("current_paybill")
      .eq("phone", userPhone)
      .maybeSingle();

    if (!sess || !sess.current_paybill) {
      await sendTextMessage(twilioNumber, userPhone, "Session expired. Please text hi to start again.");
      return;
    }

    await supabase
      .from("vf_reviews")
      .insert({ review: message, userp: userPhone, paybill: sess.current_paybill });

    await sendTextMessage(twilioNumber, userPhone, "Review submitted!");
    await sendTextMessage(twilioNumber, userPhone, "Asante kwakutumia Vherifai, just text hi to use again.");
    await endSession(userPhone);
  }
}

module.exports = { mainMenuFlow, businessLookupFlow };
