const axios = require('axios');
require('dotenv').config();

const BASE_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * Send a text message to a chat (group or individual)
 */
async function sendMessage(chatId, text) {
  try {
    if (!chatId) {
      console.error('❌ [TG.SEND] No recipient (chatId) provided');
      return;
    }
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.error('❌ [TG.SEND] TELEGRAM_BOT_TOKEN not set');
      return;
    }

    console.log(`[TG.SEND] Sending to chatId=${chatId}, length=${text.length}`);
    const response = await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
    });
    console.log(`✅ [TG.SEND] Message sent to ${chatId}, message_id=${response.data.result.message_id}`);
  } catch (err) {
    const errData = err.response?.data;
    console.error(`❌ [TG.SEND] Message to ${chatId} failed:`, errData?.description || err.message);
    if (errData?.error_code === 403) {
      console.error(`   → Bot cannot send to this chat. Check permissions or group settings.`);
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
