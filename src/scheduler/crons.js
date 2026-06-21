const cron = require('node-cron');
const { assignToday, getTodayRotation, getAllMembers, getUpcomingSchedule } = require('../handlers/rotation');
const { expireDisputes } = require('../handlers/disputes');
const { sendMessage, sendToMember } = require('../utils/telegram');
const templates = require('../utils/templates');
const db = require('../db/database');

const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;

async function broadcast(text) {
  const members = await getAllMembers();
  console.log(`[BROADCAST] Sending to ${members.length} members: ${text.substring(0, 50)}...`);
  for (const member of members) {
    await sendToMember(member, text);
  }
  await sendMessage(GROUP_CHAT_ID, text);
}

function startScheduler() {
  // Morning announcement 10:00 CAT
  cron.schedule('0 10 * * *', async () => {
    try {
      console.log('[CRON] ⏰ Morning announcement running');
      const rotation = await assignToday();
      const today = new Date().toISOString().split('T')[0];

      // Check if cook has telegram_id
      if (!rotation.telegram_id) {
        console.log(`[CRON] Cook ${rotation.cook_name} has no Telegram ID - using delegate message`);
        await sendMessage(GROUP_CHAT_ID, `
🍳 *${rotation.cook_name}'s turn to cook tonight!*

@Dabwitso or @Nathan — please let ${rotation.cook_name} know it's their night.

Once done, reply:
*done cooking*
*done dishes*
        `);
      } else {
        await broadcast(templates.morningAnnouncement(rotation.cook_name, rotation.cook_house));
      }

      // Record announcement time
      await db.run("UPDATE rotation SET announced_at=now()::text WHERE scheduled_date=$1", [today]);
    } catch (err) {
      console.error('[CRON] ❌ Morning announcement error:', err.message);
    }
  }, { timezone: 'Africa/Lusaka' });

  // Afternoon reminder 14:00 CAT
  cron.schedule('0 14 * * *', async () => {
    try {
      console.log('[CRON] ⏰ Afternoon reminder running');
      const rotation = await getTodayRotation();
      if (!rotation || rotation.status === 'dishes_done') return;
      const cookName = rotation.covered_by_name || rotation.cook_name;
      await broadcast(`⏰ *Reminder:* ${cookName}, don't forget to cook today!`);
    } catch (err) {
      console.error('[CRON] ❌ Afternoon reminder error:', err.message);
    }
  }, { timezone: 'Africa/Lusaka' });

  // Evening escalation 18:00 CAT
  cron.schedule('0 18 * * *', async () => {
    try {
      console.log('[CRON] ⏰ Evening escalation running');
      const rotation = await getTodayRotation();
      if (!rotation || rotation.status === 'dishes_done') return;

      const cookName = rotation.covered_by_name || rotation.cook_name;

      if (rotation.status === 'pending') {
        console.log(`[CRON] ⚠️ ${cookName} hasn't confirmed cooking yet - escalating`);
        await sendMessage(GROUP_CHAT_ID, `
⚠️ *No confirmation from ${cookName}*

The cook assigned for today hasn't confirmed yet.

Options:
• ${cookName} — reply *done cooking* when you start
• Someone else — reply *cover* to cook instead
• ${cookName} — reply *delegate @name* if you can't cook
        `);
      }
    } catch (err) {
      console.error('[CRON] ❌ Evening escalation error:', err.message);
    }
  }, { timezone: 'Africa/Lusaka' });

  // Late evening escalation 20:00 CAT
  cron.schedule('0 20 * * *', async () => {
    try {
      console.log('[CRON] ⏰ Late evening escalation running');
      const rotation = await getTodayRotation();
      if (!rotation || rotation.status === 'dishes_done') return;

      if (rotation.status === 'pending') {
        const cookName = rotation.covered_by_name || rotation.cook_name;
        console.log(`[CRON] 🚨 ${cookName} STILL hasn't confirmed - critical escalation`);
        await sendMessage(GROUP_CHAT_ID, `
🚨 *CRITICAL: Cooking not confirmed*

${cookName} — cooking must be confirmed or delegated NOW.

@Dabwitso (Admin) — intervention needed if unresolved.
        `);
      }
    } catch (err) {
      console.error('[CRON] ❌ Late evening escalation error:', err.message);
    }
  }, { timezone: 'Africa/Lusaka' });

  // Weekly summary - Sunday 19:00 CAT
  cron.schedule('0 19 * * 0', async () => {
    try {
      console.log('[CRON] 📋 Weekly summary running');
      const nextWeek = await getUpcomingSchedule(7);
      const summary = nextWeek.map(day => {
        const status = day.status === 'dishes_done' ? '✅' :
                       day.status === 'cook_done' ? '🍳' :
                       day.status === 'projected' ? '📅' : '⏳';
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(day.date).getDay()];
        return `${status} ${dayName} ${day.date}: *${day.cook}*`;
      });

      await sendMessage(GROUP_CHAT_ID, `
📋 *NEXT WEEK'S COOKING SCHEDULE*

${summary.join('\n')}

Status: ✅ done  🍳 cooking started  ⏳ awaiting  📅 projected

Conflicts? Use: *delegate @name* or *swap @name*
      `);
    } catch (err) {
      console.error('[CRON] ❌ Weekly summary error:', err.message);
    }
  }, { timezone: 'Africa/Lusaka' });

  // Hourly cleanup
  cron.schedule('0 * * * *', async () => {
    try {
      await db.getDb();
      const expired = await db.all("SELECT sr.*, m.name as requester_name FROM sub_requests sr JOIN members m ON sr.requester_id=m.id WHERE sr.status='open' AND sr.expires_at<=now()::text");
      for (const req of expired) {
        await db.run("UPDATE sub_requests SET status='expired' WHERE id=$1", [req.id]);
        await broadcast(templates.subExpired(req.requester_name));
      }
      await expireDisputes();
    } catch (err) {
      console.error('[CRON] ❌ Cleanup error:', err.message);
    }
  });

  console.log('📅 Scheduler started with escalation & weekly summary (Africa/Lusaka)');
}

module.exports = { startScheduler };
