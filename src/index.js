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
    const offset = lastUpdateId + 1;
    console.log(`[POLLING] Fetching updates since update_id ${offset}`);

    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`, {
      params: {
        offset: offset,
        timeout: 30,
        limit: 100
      }
    });

    if (!response.data.ok) {
      console.error(`[POLLING] Telegram API error (${response.status}):`, response.data.description);
      setTimeout(pollUpdates, 2000);
      return;
    }

    if (response.data.result.length === 0) {
      console.log(`[POLLING] ✓ No new messages`);
      setTimeout(pollUpdates, 1000);
      return;
    }

    console.log(`[POLLING] 📬 Got ${response.data.result.length} update(s)`);

    for (const update of response.data.result) {
      try {
        lastUpdateId = update.update_id;
        const message = update.message;

        if (!message) {
          console.log(`[POLLING] Skipping non-message update (type: ${update.edited_message ? 'edited' : 'other'})`);
          continue;
        }

        if (!message.text) {
          console.log(`[POLLING] Skipping non-text message (type: ${message.photo ? 'photo' : message.sticker ? 'sticker' : 'other'})`);
          continue;
        }

        const userId = message.from.id;
        const chatId = message.chat.id;
        const text = message.text;
        const name = message.from.first_name || 'User';

        console.log(`[POLLING] 📨 Message from ${name} (${userId}) in chat ${chatId}: "${text}"`);

        await handleMessage(userId, text, chatId);
      } catch (updateErr) {
        console.error(`[POLLING] Error processing update ${update.update_id}:`, updateErr.message);
      }
    }
  } catch (err) {
    if (err.response?.status === 409) {
      console.error(`[POLLING] ⚠️  409 Conflict - resetting offset to latest`);
      lastUpdateId = 0;
      setTimeout(pollUpdates, 3000);
      return;
    }

    console.error(`[POLLING] ❌ Error (${err.response?.status || err.code}):`, err.message);
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
      console.log(`[POLLING] Connection issue, retrying in 5 seconds...`);
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

// Statistics dashboard
app.get('/stats', async (req, res) => {
  try {
    await db.getDb();

    // Get all members with stats
    const members = await db.all(`
      SELECT
        m.id, m.name, m.house, m.queue_position, m.owed_turns,
        COUNT(r.id) as total_cooks,
        SUM(CASE WHEN r.status = 'dishes_done' THEN 1 ELSE 0 END) as completed_cooks,
        AVG(CASE WHEN r.meal_rating > 0 THEN r.meal_rating ELSE NULL END) as avg_rating
      FROM members m
      LEFT JOIN rotation r ON m.id = r.member_id
      WHERE m.active = 1
      GROUP BY m.id, m.name, m.house, m.queue_position, m.owed_turns
      ORDER BY m.queue_position
    `);

    // Get this month's stats
    const thisMonth = new Date().toISOString().split('-').slice(0, 2).join('-');
    const monthlyStats = await db.all(`
      SELECT m.name, COUNT(r.id) as cooks_this_month
      FROM members m
      LEFT JOIN rotation r ON m.id = r.member_id AND r.scheduled_date LIKE $1
      WHERE m.active = 1
      GROUP BY m.name
      ORDER BY cooks_this_month DESC
    `, [`${thisMonth}%`]);

    // Upcoming week
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStr = nextWeek.toISOString().split('T')[0];

    const upcomingCooks = await db.all(`
      SELECT r.scheduled_date, m.name, r.status, r.meal_rating
      FROM rotation r
      JOIN members m ON r.member_id = m.id
      WHERE r.scheduled_date BETWEEN $1 AND $2
      ORDER BY r.scheduled_date
    `, [today, nextWeekStr]);

    res.json({
      timestamp: new Date().toISOString(),
      members_stats: members.map(m => ({
        name: m.name,
        house: m.house,
        queue_position: m.queue_position,
        total_cooks: parseInt(m.total_cooks) || 0,
        completed_cooks: parseInt(m.completed_cooks) || 0,
        avg_meal_rating: m.avg_rating ? parseFloat(m.avg_rating).toFixed(1) : 'N/A',
        owed_turns: m.owed_turns
      })),
      this_month: monthlyStats,
      upcoming_week: upcomingCooks.map(c => ({
        date: c.scheduled_date,
        cook: c.name,
        status: c.status,
        rating: c.meal_rating || 'pending'
      }))
    });
  } catch (err) {
    console.error('[STATS] Error:', err.message);
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
