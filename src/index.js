require('dotenv').config();
const express = require('express');
const { startScheduler } = require('./scheduler/crons');
const { handleMessage } = require('./handlers/messageHandler');
const { assignToday, getAllMembers, getTodayRotation } = require('./handlers/rotation');
const { sendGroupMessage } = require('./utils/whatsapp');
const templates = require('./utils/templates');
const db = require('./db/database');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'cooking-bot-verify';
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;

// Webhook verification
app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === VERIFY_TOKEN) { res.status(200).send(challenge); }
  else res.sendStatus(403);
});

// Incoming messages
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value.messages) continue;
        for (const message of value.messages) {
          if (message.type !== 'text') continue;
          const from = message.from;
          const text = message.text.body;
          const isGroup = from === GROUP_CHAT_ID;
          console.log(`📨 [${isGroup ? 'GROUP' : 'DM'}] ${from}: ${text}`);
          await handleMessage(from, text, isGroup);
        }
      }
    }
  } catch (err) { console.error('Webhook error:', err); }
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
    await sendGroupMessage(msg);
    res.json({ success: true, cook: rotation.cook_name, message: msg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Boot
async function boot() {
  await db.getDb();
  console.log('🗄️  Database ready');
  startScheduler();
  app.listen(PORT, () => {
    console.log(`🚀 Cooking bot on port ${PORT}`);
    console.log(`📍 Webhook: POST /webhook`);
    console.log(`🏥 Health: GET /health`);
  });
}

boot().catch(console.error);
module.exports = app;
