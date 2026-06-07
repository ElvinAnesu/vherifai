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

async function lookupBusinessByIdentifier(identifier) {
  const { data: paybillRecord, error: paybillError } = await supabase
    .from("vf_paybills")
    .select("paybill, vf_registered_businesses(*, vf_business_categories(name))")
    .eq("paybill", identifier)
    .maybeSingle();

  if (paybillError) {
    console.error("Error looking up paybill:", paybillError);
    return null;
  }

  if (paybillRecord?.vf_registered_businesses) {
    return {
      business: paybillRecord.vf_registered_businesses,
      identifier: paybillRecord.paybill,
      type: "paybill",
    };
  }

  const { data: tillRecord, error: tillError } = await supabase
    .from("vf_tillnumbers")
    .select("till_number, vf_registered_businesses(*, vf_business_categories(name))")
    .eq("till_number", identifier)
    .maybeSingle();

  if (tillError) {
    console.error("Error looking up till number:", tillError);
    return null;
  }

  if (tillRecord?.vf_registered_businesses) {
    return {
      business: tillRecord.vf_registered_businesses,
      identifier: tillRecord.till_number,
      type: "till",
    };
  }

  return null;
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
    const result = await lookupBusinessByIdentifier(message);

    if (result) {
      await sendBusinessInfoTemplate(
        twilioNumber,
        userPhone,
        result.business.official_business_name,
        result.identifier,
        result.business.notes,
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

        const result = await lookupBusinessByIdentifier(sess.current_paybill);

        if (result) {
          const biz = result.business;
          let details = `Report Summary\n- ${biz.official_business_name}\n${result.identifier}`;
          const categoryName = biz.vf_business_categories?.name;
          if (categoryName) details += `\n${categoryName}`;
          if (biz.goods_services) details += `\n${biz.goods_services}`;
          if (biz.notes) details += `\n${biz.notes}`;
          await sendTextMessage(twilioNumber, userPhone, details);
          await sendTextMessage(twilioNumber, userPhone, "Asante kwakutumia Vherifai, just text hi to use again.");
          await endSession(userPhone);
        }
        break;
      case 'Review':
        const { data: reviewSess } = await supabase
          .from("vf_sessions")
          .select("current_paybill")
          .eq("phone", userPhone)
          .eq("is_active", true)
          .maybeSingle();

        if (!reviewSess?.current_paybill) {
          await sendTextMessage(twilioNumber, userPhone, "Session expired. Please text hi to start again.");
          break;
        }

        const { data: paybillForReview } = await supabase
          .from("vf_paybills")
          .select("paybill")
          .eq("paybill", reviewSess.current_paybill)
          .maybeSingle();

        if (!paybillForReview) {
          await sendTextMessage(twilioNumber, userPhone, "Reviews are only available for paybill lookups. Please try again with a paybill.");
          break;
        }

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
