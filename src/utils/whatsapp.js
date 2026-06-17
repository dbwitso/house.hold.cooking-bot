const axios = require('axios');
require('dotenv').config();

const BASE_URL = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

const headers = () => ({
  Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
});

/**
 * Send a text message to a phone number or group
 */
async function sendMessage(to, text) {
  try {
    if (!to) {
      console.error('❌ sendMessage: No recipient (to) provided');
      return;
    }
    if (!process.env.WHATSAPP_TOKEN) {
      console.error('❌ sendMessage: WHATSAPP_TOKEN not set');
      return;
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: String(to).trim(),
      type: 'text',
      text: { body: text },
    };

    const response = await axios.post(BASE_URL, payload, { headers: headers() });
    console.log(`✅ Message sent to ${to}`);
  } catch (err) {
    const errData = err.response?.data?.error;
    console.error(`❌ [${errData?.code || 'ERROR'}] Message to ${to} failed:`, errData?.message || err.message);
    if (errData?.code === 100) {
      console.error('   → Check: Token valid? Phone number format correct? Business account linked?');
    }
  }
}

/**
 * Send a message to the group
 */
async function sendGroupMessage(text) {
  await sendMessage(process.env.GROUP_CHAT_ID, text);
}

/**
 * Send a message to a specific member (if their phone is registered)
 */
async function sendToMember(member, text) {
  if (!member?.phone) {
    console.warn(`No phone number for ${member?.name}, skipping DM`);
    return;
  }
  await sendMessage(member.phone, text);
}

module.exports = { sendMessage, sendGroupMessage, sendToMember };
