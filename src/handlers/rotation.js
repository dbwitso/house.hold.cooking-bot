const db = require('../db/database');

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

async function getTodayRotation() {
  await db.getDb();
  const today = todayStr();
  return db.get(`
    SELECT r.*, m.name as cook_name, m.house as cook_house,
           c.name as covered_by_name
    FROM rotation r
    JOIN members m ON r.member_id = m.id
    LEFT JOIN members c ON r.covered_by = c.id
    WHERE r.scheduled_date = $1`, [today]);
}

async function assignToday() {
  await db.getDb();
  const today = todayStr();
  const existing = await getTodayRotation();
  if (existing) return existing;

  const next = await db.get(`
    SELECT m.* FROM members m
    WHERE m.active=1
    AND m.id NOT IN (
      SELECT member_id FROM rotation
      WHERE scheduled_date = $1 AND status NOT IN ('pending')
    )
    ORDER BY m.queue_position ASC LIMIT 1
  `, [today]);

  if (!next) throw new Error('No active members available');

  await db.run('INSERT INTO rotation (member_id, scheduled_date, status) VALUES ($1,$2,$3)', [next.id, today, 'pending']);
  await rotateToBack(next.id);
  return getTodayRotation();
}

async function rotateToBack(memberId) {
  const max = await db.get('SELECT MAX(queue_position) as m FROM members');
  const newPos = (max.m || 0) + 1;
  await db.run('UPDATE members SET queue_position=$1 WHERE id=$2', [newPos, memberId]);
  await reindexQueue();
}

async function reindexQueue() {
  const members = await db.all('SELECT id FROM members WHERE active=1 ORDER BY queue_position ASC');
  for (let i = 0; i < members.length; i++) {
    await db.run('UPDATE members SET queue_position=$1 WHERE id=$2', [i + 1, members[i].id]);
  }
}

async function getUpcomingSchedule(days = 7) {
  await db.getDb();
  const schedule = [];
  const members = await db.all('SELECT * FROM members WHERE active=1 ORDER BY queue_position ASC');
  const scheduled = await db.all(`
    SELECT r.*, m.name as cook_name FROM rotation r
    JOIN members m ON r.member_id = m.id
    WHERE r.scheduled_date >= date('now')
    ORDER BY r.scheduled_date ASC LIMIT $1`, [days]);

  let memberIndex = 0;
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    const existing = scheduled.find(s => s.scheduled_date === dateStr);
    if (existing) {
      schedule.push({ date: dateStr, cook: existing.cook_name, status: existing.status });
    } else {
      schedule.push({ date: dateStr, cook: members[memberIndex % members.length]?.name || 'TBD', status: 'projected' });
      memberIndex++;
    }
  }
  return schedule;
}

async function confirmCookingDone(memberId) {
  await db.getDb();
  const today = todayStr();
  const rotation = await db.get('SELECT * FROM rotation WHERE scheduled_date=$1 AND (member_id=$2 OR covered_by=$3)', [today, memberId, memberId]);
  if (!rotation) return { error: "You're not assigned to cook today." };
  if (rotation.status === 'cook_done' || rotation.status === 'dishes_done') return { error: 'Already confirmed.' };
  await db.run("UPDATE rotation SET status='cook_done' WHERE id=$1", [rotation.id]);
  return { success: true, rotationId: rotation.id };
}

async function confirmDishesDone(memberId) {
  await db.getDb();
  const today = todayStr();
  const rotation = await db.get('SELECT * FROM rotation WHERE scheduled_date=$1 AND (member_id=$2 OR covered_by=$3)', [today, memberId, memberId]);
  if (!rotation) return { error: "You're not assigned to cook today." };
  if (rotation.status !== 'cook_done') return { error: 'Please confirm cooking done first.' };
  await db.run("UPDATE rotation SET status='dishes_done' WHERE id=$1", [rotation.id]);
  return { success: true, rotationId: rotation.id };
}

async function skipToday(memberId) {
  await db.getDb();
  const today = todayStr();
  const rotation = await db.get('SELECT * FROM rotation WHERE scheduled_date=$1 AND member_id=$2', [today, memberId]);
  if (!rotation) return { error: "You're not assigned to cook today." };
  await db.run("UPDATE rotation SET status='skipped' WHERE id=$1", [rotation.id]);
  await db.run('UPDATE members SET queue_position=0 WHERE id=$1', [memberId]);
  await reindexQueue();
  return { success: true };
}

async function requestSub(memberId) {
  await db.getDb();
  const today = todayStr();
  const rotation = await db.get('SELECT * FROM rotation WHERE scheduled_date=$1 AND member_id=$2', [today, memberId]);
  if (!rotation) return { error: "You're not assigned to cook today." };
  const existing = await db.get("SELECT * FROM sub_requests WHERE rotation_id=$1 AND status='open'", [rotation.id]);
  if (existing) return { error: 'Sub request already open.' };
  const exp = new Date(); exp.setHours(exp.getHours() + 3);
  await db.run('INSERT INTO sub_requests (rotation_id,requester_id,expires_at) VALUES ($1,$2,$3)', [rotation.id, memberId, exp.toISOString()]);
  await db.run('UPDATE members SET owed_turns=owed_turns+1 WHERE id=$1', [memberId]);
  return { success: true, subRequestId: db.lastId() };
}

async function coverSub(volunteerId) {
  await db.getDb();
  const today = todayStr();
  const sub = await db.get(`
    SELECT sr.*, r.scheduled_date FROM sub_requests sr
    JOIN rotation r ON sr.rotation_id=r.id
    WHERE r.scheduled_date=$1 AND sr.status='open'
    ORDER BY sr.created_at ASC LIMIT 1`, [today]);
  if (!sub) return { error: 'No open sub requests today.' };
  if (sub.requester_id === volunteerId) return { error: "Can't cover your own request." };
  await db.run("UPDATE sub_requests SET volunteer_id=$1,status='filled' WHERE id=$2", [volunteerId, sub.id]);
  await db.run('UPDATE rotation SET covered_by=$1 WHERE id=$2', [volunteerId, sub.rotation_id]);
  const vol = await db.get('SELECT * FROM members WHERE id=$1', [volunteerId]);
  if (vol.owed_turns > 0) await db.run('UPDATE members SET owed_turns=owed_turns-1 WHERE id=$1', [volunteerId]);
  return { success: true };
}

async function requestSwap(requesterId, targetName) {
  await db.getDb();
  const today = todayStr();
  const requesterRot = await db.get('SELECT * FROM rotation WHERE scheduled_date=$1 AND member_id=$2', [today, requesterId]);
  if (!requesterRot) return { error: "You're not assigned to cook today." };
  const target = await db.get('SELECT * FROM members WHERE LOWER(name)=LOWER($1)', [targetName]);
  if (!target) return { error: `"${targetName}" not found.` };
  if (target.id === requesterId) return { error: "Can't swap with yourself." };
  const exp = new Date(); exp.setHours(exp.getHours() + 2);
  await db.run('INSERT INTO swap_requests (requester_rotation_id,target_member_id,expires_at) VALUES ($1,$2,$3)', [requesterRot.id, target.id, exp.toISOString()]);
  return { success: true, swapRequestId: db.lastId(), targetName: target.name };
}

async function acceptSwap(targetMemberId) {
  await db.getDb();
  const swap = await db.get(`
    SELECT sr.*, r.member_id as requester_id, r.scheduled_date
    FROM swap_requests sr
    JOIN rotation r ON sr.requester_rotation_id=r.id
    WHERE sr.target_member_id=$1 AND sr.status='pending'
    ORDER BY sr.created_at DESC LIMIT 1`, [targetMemberId]);
  if (!swap) return { error: 'No pending swap request.' };
  const targetRot = await db.get("SELECT * FROM rotation WHERE member_id=$1 AND scheduled_date>date('now') ORDER BY scheduled_date ASC LIMIT 1", [targetMemberId]);
  await db.run('UPDATE rotation SET member_id=$1,swapped_with=$2 WHERE id=$3', [targetMemberId, swap.requester_id, swap.requester_rotation_id]);
  if (targetRot) await db.run('UPDATE rotation SET member_id=$1,swapped_with=$2 WHERE id=$3', [swap.requester_id, targetMemberId, targetRot.id]);
  await db.run("UPDATE swap_requests SET status='accepted' WHERE id=$1", [swap.id]);
  return { success: true, swapDate: swap.scheduled_date };
}

async function declineSwap(targetMemberId) {
  await db.getDb();
  const swap = await db.get("SELECT * FROM swap_requests WHERE target_member_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1", [targetMemberId]);
  if (!swap) return { error: 'No pending swap request.' };
  await db.run("UPDATE swap_requests SET status='declined' WHERE id=$1", [swap.id]);
  return { success: true };
}

async function getMemberByTelegramId(telegramId) {
  await db.getDb();
  return db.get('SELECT * FROM members WHERE telegram_id=$1', [telegramId]);
}

async function getMemberByName(name) {
  await db.getDb();
  return db.get('SELECT * FROM members WHERE LOWER(name)=LOWER($1)', [name]);
}

async function setMemberTelegramId(name, telegramId) {
  await db.getDb();
  console.log(`[DB] Updating ${name} with telegram_id=${telegramId}`);
  const result = await db.run('UPDATE members SET telegram_id=$1 WHERE LOWER(name)=LOWER($2)', [telegramId, name]);
  console.log(`[DB] Update result:`, result);
  return result;
}

async function getAllMembers() {
  await db.getDb();
  return db.all('SELECT * FROM members WHERE active=1 ORDER BY queue_position ASC');
}

module.exports = {
  assignToday, getTodayRotation, getUpcomingSchedule,
  confirmCookingDone, confirmDishesDone, skipToday,
  requestSub, coverSub, requestSwap, acceptSwap, declineSwap,
  getMemberByTelegramId, getMemberByName, setMemberTelegramId, getAllMembers,
};
