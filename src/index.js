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
    console.log(`[POLLING] Fetching updates since update_id ${lastUpdateId}`);
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`, {
      params: { offset: lastUpdateId + 1, timeout: 30 }
    });

    if (!response.data.ok) {
      console.error(`[POLLING] Telegram API error:`, response.data.description);
      setTimeout(pollUpdates, 1000);
      return;
    }

    if (response.data.result.length === 0) {
      console.log(`[POLLING] No new messages`);
      setTimeout(pollUpdates, 1000);
      return;
    }

    console.log(`[POLLING] 📬 Got ${response.data.result.length} update(s)`);

    for (const update of response.data.result) {
      lastUpdateId = update.update_id;
      const message = update.message;

      if (!message) {
        console.log(`[POLLING] Skipping non-message update`);
        continue;
      }

      if (!message.text) {
        console.log(`[POLLING] Skipping non-text message`);
        continue;
      }

      const userId = message.from.id;
      const chatId = message.chat.id;
      const text = message.text;
      const name = message.from.first_name || 'User';

      console.log(`[POLLING] 📨 Message from ${name} (${userId}) in chat ${chatId}: "${text}"`);

      try {
        await handleMessage(userId, text, chatId);
      } catch (handlerErr) {
        console.error(`[POLLING] Handler error for user ${userId}:`, handlerErr.message);
      }
    }
  } catch (err) {
    console.error(`[POLLING] ❌ Error:`, err.message);
    if (err.code === 'ECONNRESET') {
      console.log(`[POLLING] Connection reset, retrying in 5 seconds...`);
      setTimeout(pollUpdates, 5000);
      return;
    }
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
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    has_bot_token: !!process.env.TELEGRAM_BOT_TOKEN,
    bot_token_length: process.env.TELEGRAM_BOT_TOKEN?.length || 0,
    group_chat_id: process.env.GROUP_CHAT_ID,
    database_url_set: !!process.env.DATABASE_URL,
    port: PORT,
    note: 'Set TELEGRAM_BOT_TOKEN and GROUP_CHAT_ID in .env. Get bot token from @BotFather on Telegram.'
  });
});

// Monitoring endpoint
app.get('/monitor', async (req, res) => {
  try {
    await db.getDb();
    const members = await db.all('SELECT id, name, telegram_id, house, queue_position, owed_turns FROM members WHERE active=1 ORDER BY queue_position');
    const today = new Date().toISOString().split('T')[0];
    const todayRotation = await db.get('SELECT r.*, m.name as cook_name FROM rotation r JOIN members m ON r.member_id=m.id WHERE r.scheduled_date=$1', [today]);

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      members: {
        total: members.length,
        list: members.map(m => ({
          name: m.name,
          house: m.house,
          telegram_id: m.telegram_id || 'NOT_REGISTERED',
          queue_position: m.queue_position,
          owed_turns: m.owed_turns
        }))
      },
      today: {
        date: today,
        assignment: todayRotation ? {
          cook: todayRotation.cook_name,
          status: todayRotation.status
        } : 'NOT_ASSIGNED'
      }
    });
  } catch (err) {
    console.error('[MONITOR] Error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
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

// Force seed database (emergency recovery)
app.post('/admin/seed', async (req, res) => {
  try {
    console.log('[ADMIN] Force seeding members...');
    const members = [
      { name: 'Dabwitso', house: 1, pos: 1 },
      { name: 'Emmanuel', house: 1, pos: 2 },
      { name: 'Muchafara', house: 1, pos: 3 },
      { name: 'Nathan', house: 1, pos: 4 },
      { name: 'Bosco', house: 2, pos: 5 },
      { name: 'Chibili', house: 2, pos: 6 },
    ];

    // Clear existing members
    await db.run('DELETE FROM members WHERE id > 0');
    console.log('[ADMIN] Cleared existing members');

    // Insert new members
    for (const m of members) {
      await db.run('INSERT INTO members (name, house, queue_position) VALUES ($1, $2, $3)', [m.name, m.house, m.pos]);
    }

    const verify = await db.all('SELECT id, name, telegram_id FROM members ORDER BY queue_position');
    console.log('[ADMIN] Seed complete. Members:', verify);

    res.json({ success: true, members_seeded: verify });
  } catch (err) {
    console.error('[ADMIN] Seed error:', err.message);
    res.status(500).json({ error: err.message });
  }
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
