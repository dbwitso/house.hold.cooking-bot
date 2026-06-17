const db = require('../db/database');

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

async function getTodayRotation() {
  const d = await db.getDb();
  const today = todayStr();
  return db.get(`
    SELECT r.*, m.name as cook_name, m.house as cook_house,
           c.name as covered_by_name
    FROM rotation r
    JOIN members m ON r.member_id = m.id
    LEFT JOIN members c ON r.covered_by = c.id
    WHERE r.scheduled_date = ?`, [today]);
}

async function assignToday() {
  await db.getDb();
  const today = todayStr();
  const existing = await getTodayRotation();
  if (existing) return existing;

  const next = db.get('SELECT * FROM members WHERE active=1 ORDER BY queue_position ASC LIMIT 1');
  if (!next) throw new Error('No active members');

  db.run('INSERT INTO rotation (member_id, scheduled_date, status) VALUES (?,?,?)', [next.id, today, 'pending']);
  rotateToBack(next.id);
  return getTodayRotation();
}

function rotateToBack(memberId) {
  const max = db.get('SELECT MAX(queue_position) as m FROM members').m || 0;
  db.run('UPDATE members SET queue_position=? WHERE id=?', [max + 1, memberId]);
  reindexQueue();
}

function reindexQueue() {
  const members = db.all('SELECT id FROM members WHERE active=1 ORDER BY queue_position ASC');
  members.forEach((m, i) => db.run('UPDATE members SET queue_position=? WHERE id=?', [i + 1, m.id]));
}

async function getUpcomingSchedule(days = 7) {
  await db.getDb();
  const schedule = [];
  const members = db.all('SELECT * FROM members WHERE active=1 ORDER BY queue_position ASC');
  const scheduled = db.all(`
    SELECT r.*, m.name as cook_name FROM rotation r
    JOIN members m ON r.member_id = m.id
    WHERE r.scheduled_date >= date('now')
    ORDER BY r.scheduled_date ASC LIMIT ?`, [days]);

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
  const rotation = db.get('SELECT * FROM rotation WHERE scheduled_date=? AND (member_id=? OR covered_by=?)', [today, memberId, memberId]);
  if (!rotation) return { error: "You're not assigned to cook today." };
  if (rotation.status === 'cook_done' || rotation.status === 'dishes_done') return { error: 'Already confirmed.' };
  db.run("UPDATE rotation SET status='cook_done' WHERE id=?", [rotation.id]);
  return { success: true, rotationId: rotation.id };
}

async function confirmDishesDone(memberId) {
  await db.getDb();
  const today = todayStr();
  const rotation = db.get('SELECT * FROM rotation WHERE scheduled_date=? AND (member_id=? OR covered_by=?)', [today, memberId, memberId]);
  if (!rotation) return { error: "You're not assigned to cook today." };
  if (rotation.status !== 'cook_done') return { error: 'Please confirm cooking done first.' };
  db.run("UPDATE rotation SET status='dishes_done' WHERE id=?", [rotation.id]);
  return { success: true, rotationId: rotation.id };
}

async function skipToday(memberId) {
  await db.getDb();
  const today = todayStr();
  const rotation = db.get('SELECT * FROM rotation WHERE scheduled_date=? AND member_id=?', [today, memberId]);
  if (!rotation) return { error: "You're not assigned to cook today." };
  db.run("UPDATE rotation SET status='skipped' WHERE id=?", [rotation.id]);
  db.run('UPDATE members SET queue_position=0 WHERE id=?', [memberId]);
  reindexQueue();
  return { success: true };
}

async function requestSub(memberId) {
  await db.getDb();
  const today = todayStr();
  const rotation = db.get('SELECT * FROM rotation WHERE scheduled_date=? AND member_id=?', [today, memberId]);
  if (!rotation) return { error: "You're not assigned to cook today." };
  const existing = db.get("SELECT * FROM sub_requests WHERE rotation_id=? AND status='open'", [rotation.id]);
  if (existing) return { error: 'Sub request already open.' };
  const exp = new Date(); exp.setHours(exp.getHours() + 3);
  db.run('INSERT INTO sub_requests (rotation_id,requester_id,expires_at) VALUES (?,?,?)', [rotation.id, memberId, exp.toISOString()]);
  db.run('UPDATE members SET owed_turns=owed_turns+1 WHERE id=?', [memberId]);
  return { success: true, subRequestId: db.lastId() };
}

async function coverSub(volunteerId) {
  await db.getDb();
  const today = todayStr();
  const sub = db.get(`
    SELECT sr.*, r.scheduled_date FROM sub_requests sr
    JOIN rotation r ON sr.rotation_id=r.id
    WHERE r.scheduled_date=? AND sr.status='open'
    ORDER BY sr.created_at ASC LIMIT 1`, [today]);
  if (!sub) return { error: 'No open sub requests today.' };
  if (sub.requester_id === volunteerId) return { error: "Can't cover your own request." };
  db.run("UPDATE sub_requests SET volunteer_id=?,status='filled' WHERE id=?", [volunteerId, sub.id]);
  db.run('UPDATE rotation SET covered_by=? WHERE id=?', [volunteerId, sub.rotation_id]);
  const vol = db.get('SELECT * FROM members WHERE id=?', [volunteerId]);
  if (vol.owed_turns > 0) db.run('UPDATE members SET owed_turns=owed_turns-1 WHERE id=?', [volunteerId]);
  return { success: true };
}

async function requestSwap(requesterId, targetName) {
  await db.getDb();
  const today = todayStr();
  const requesterRot = db.get('SELECT * FROM rotation WHERE scheduled_date=? AND member_id=?', [today, requesterId]);
  if (!requesterRot) return { error: "You're not assigned to cook today." };
  const target = db.get('SELECT * FROM members WHERE LOWER(name)=LOWER(?)', [targetName]);
  if (!target) return { error: `"${targetName}" not found.` };
  if (target.id === requesterId) return { error: "Can't swap with yourself." };
  const exp = new Date(); exp.setHours(exp.getHours() + 2);
  db.run('INSERT INTO swap_requests (requester_rotation_id,target_member_id,expires_at) VALUES (?,?,?)', [requesterRot.id, target.id, exp.toISOString()]);
  return { success: true, swapRequestId: db.lastId(), targetName: target.name };
}

async function acceptSwap(targetMemberId) {
  await db.getDb();
  const swap = db.get(`
    SELECT sr.*, r.member_id as requester_id, r.scheduled_date
    FROM swap_requests sr
    JOIN rotation r ON sr.requester_rotation_id=r.id
    WHERE sr.target_member_id=? AND sr.status='pending'
    ORDER BY sr.created_at DESC LIMIT 1`, [targetMemberId]);
  if (!swap) return { error: 'No pending swap request.' };
  const targetRot = db.get("SELECT * FROM rotation WHERE member_id=? AND scheduled_date>date('now') ORDER BY scheduled_date ASC LIMIT 1", [targetMemberId]);
  db.run('UPDATE rotation SET member_id=?,swapped_with=? WHERE id=?', [targetMemberId, swap.requester_id, swap.requester_rotation_id]);
  if (targetRot) db.run('UPDATE rotation SET member_id=?,swapped_with=? WHERE id=?', [swap.requester_id, targetMemberId, targetRot.id]);
  db.run("UPDATE swap_requests SET status='accepted' WHERE id=?", [swap.id]);
  return { success: true, swapDate: swap.scheduled_date };
}

async function declineSwap(targetMemberId) {
  await db.getDb();
  const swap = db.get("SELECT * FROM swap_requests WHERE target_member_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1", [targetMemberId]);
  if (!swap) return { error: 'No pending swap request.' };
  db.run("UPDATE swap_requests SET status='declined' WHERE id=?", [swap.id]);
  return { success: true };
}

async function getMemberByPhone(phone) {
  await db.getDb();
  return db.get('SELECT * FROM members WHERE phone=?', [phone]);
}

async function getMemberByName(name) {
  await db.getDb();
  return db.get('SELECT * FROM members WHERE LOWER(name)=LOWER(?)', [name]);
}

function setMemberPhone(name, phone) {
  db.run('UPDATE members SET phone=? WHERE LOWER(name)=LOWER(?)', [phone, name]);
}

async function getAllMembers() {
  await db.getDb();
  return db.all('SELECT * FROM members WHERE active=1 ORDER BY queue_position ASC');
}

module.exports = {
  assignToday, getTodayRotation, getUpcomingSchedule,
  confirmCookingDone, confirmDishesDone, skipToday,
  requestSub, coverSub, requestSwap, acceptSwap, declineSwap,
  getMemberByPhone, getMemberByName, setMemberPhone, getAllMembers,
};
