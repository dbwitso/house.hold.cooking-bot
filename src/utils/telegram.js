const axios = require('axios');
require('dotenv').config();

const BASE_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * Send a text message to a chat (group or individual)
 */
async function sendMessage(chatId, text) {
  try {
    if (!chatId) {
      console.error('❌ sendMessage: No recipient (chatId) provided');
      return;
    }
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.error('❌ sendMessage: TELEGRAM_BOT_TOKEN not set');
      return;
    }

    const response = await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
    });
    console.log(`✅ Message sent to ${chatId}`);
  } catch (err) {
    const errData = err.response?.data;
    console.error(`❌ Message to ${chatId} failed:`, errData?.description || err.message);
  }
}

/**
 * Send a message to the group
 */
async function sendGroupMessage(text) {
  await sendMessage(process.env.GROUP_CHAT_ID, text);
}

/**
 * Send a message to a specific member (if their Telegram ID is registered)
 */
async function sendToMember(member, text) {
  if (!member?.telegram_id) {
    console.warn(`No Telegram ID for ${member?.name}, skipping DM`);
    return;
  }
  await sendMessage(member.telegram_id, text);
}

module.exports = { sendMessage, sendGroupMessage, sendToMember };
