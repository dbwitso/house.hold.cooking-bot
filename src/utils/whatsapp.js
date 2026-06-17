const axios = require('axios');
require('dotenv').config();

const BASE_URL = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

const headers = () => ({
  Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
});

/**
 * Send a text message to a phone number or group
 */
async function sendMessage(to, text) {
  try {
    await axios.post(BASE_URL, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }, { headers: headers() });
  } catch (err) {
    const errData = err.response?.data?.error;
    if (errData?.code === 100) {
      console.warn(`⚠️  Message to ${to} failed: Phone number may not be configured or app not published. Code: ${errData.code}`);
    } else {
      console.error('WhatsApp send error:', errData?.message || err.message);
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
