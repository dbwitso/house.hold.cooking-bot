require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { startScheduler } = require('./scheduler/crons');
const { handleMessage } = require('./handlers/messageHandler');
const { assignToday, getAllMembers, getTodayRotation } = require('./handlers/rotation');
const { sendToMember } = require('./utils/telegram');
const templates = require('./utils/templates');
const db = require('./db/database');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let lastUpdateId = 0;

// Polling for messages
async function pollUpdates() {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`, {
      params: { offset: lastUpdateId + 1, timeout: 30 }
    });

    if (!response.data.ok) return;

    for (const update of response.data.result) {
      lastUpdateId = update.update_id;
      const message = update.message;

      if (!message || !message.text) continue;

      const userId = message.from.id;
      const chatId = message.chat.id;
      const text = message.text;
      const name = message.from.first_name || 'User';
      console.log(`📨 ${name} (${userId}): ${text}`);
      await handleMessage(userId, text, chatId);
    }
  } catch (err) {
    console.error('Polling error:', err.message);
  }

  setTimeout(pollUpdates, 1000);
}

// Webhook endpoint (optional, for production)
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const update = req.body;
    const message = update.message;

    if (!message || !message.text) return;

    const userId = message.from.id;
    const text = message.text;
    console.log(`📨 ${message.from.first_name} (${userId}): ${text}`);
    await handleMessage(userId, text);
  } catch (err) { console.error('Webhook error:', err); }
});

// Diagnostics
app.get('/config', (req, res) => {
  res.json({
    has_token: !!process.env.TELEGRAM_BOT_TOKEN,
    token_length: process.env.TELEGRAM_BOT_TOKEN?.length || 0,
    group_chat_id: process.env.GROUP_CHAT_ID,
    note: 'Set TELEGRAM_BOT_TOKEN and GROUP_CHAT_ID in .env. Get bot token from @BotFather on Telegram.'
  });
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await db.getDb();
    const members = db.all('SELECT name, house, queue_position, owed_turns FROM members WHERE active=1 ORDER BY queue_position');
    const today = db.get(`SELECT r.*, m.name as cook_name FROM rotation r JOIN members m ON r.member_id=m.id WHERE r.scheduled_date=date('now')`);
    res.json({ status: 'ok', members, today: today || 'Not yet assigned' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manual morning trigger (for testing)
app.post('/trigger/morning', async (req, res) => {
  try {
    const rotation = await assignToday();
    const msg = templates.morningAnnouncement(rotation.cook_name, rotation.cook_house);
    const members = await getAllMembers();
    for (const member of members) {
      await sendToMember(member, msg);
    }
    res.json({ success: true, cook: rotation.cook_name, sentTo: members.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Boot
async function boot() {
  await db.getDb();
  console.log('🗄️  Database ready');

  try {
    const rotation = await assignToday();
    console.log(`🍳 Today's cook: ${rotation.cook_name} (House ${rotation.cook_house})`);
  } catch (err) {
    console.error('Failed to assign today:', err.message);
  }

  startScheduler();
  pollUpdates();

  app.listen(PORT, () => {
    console.log(`🚀 Cooking bot on port ${PORT}`);
    console.log(`📲 Polling for messages (local mode)`);
    console.log(`🏥 Health: GET /health`);
  });
}

boot().catch(console.error);
module.exports = app;
