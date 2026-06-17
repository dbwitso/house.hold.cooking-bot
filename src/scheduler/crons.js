const cron = require('node-cron');
const { assignToday, getTodayRotation } = require('../handlers/rotation');
const { expireDisputes } = require('../handlers/disputes');
const { sendGroupMessage } = require('../utils/whatsapp');
const templates = require('../utils/templates');
const db = require('../db/database');

function startScheduler() {
  // Morning announcement 10:00 CAT
  cron.schedule('0 10 * * *', async () => {
    try {
      const rotation = await assignToday();
      await sendGroupMessage(templates.morningAnnouncement(rotation.cook_name, rotation.cook_house));
    } catch (err) { console.error('Morning cron error:', err); }
  }, { timezone: 'Africa/Lusaka' });

  // Evening reminder 20:00 CAT
  cron.schedule('0 20 * * *', async () => {
    try {
      const rotation = await getTodayRotation();
      if (!rotation || rotation.status === 'dishes_done') return;
      const cookName = rotation.covered_by_name || rotation.cook_name;
      await sendGroupMessage(templates.eveningReminder(cookName));
    } catch (err) { console.error('Evening cron error:', err); }
  }, { timezone: 'Africa/Lusaka' });

  // Hourly cleanup
  cron.schedule('0 * * * *', async () => {
    try {
      await db.getDb();
      const expired = db.all("SELECT sr.*, m.name as requester_name FROM sub_requests sr JOIN members m ON sr.requester_id=m.id WHERE sr.status='open' AND sr.expires_at<=datetime('now')");
      for (const req of expired) {
        db.run("UPDATE sub_requests SET status='expired' WHERE id=?", [req.id]);
        await sendGroupMessage(templates.subExpired(req.requester_name));
      }
      await expireDisputes();
    } catch (err) { console.error('Cleanup cron error:', err); }
  });

  console.log('📅 Scheduler started (Africa/Lusaka)');
}

module.exports = { startScheduler };
