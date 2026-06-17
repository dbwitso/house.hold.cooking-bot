const db = require('../db/database');

async function raiseDispute(raisedById, stage) {
  await db.getDb();
  const today = new Date().toISOString().split('T')[0];
  const rotation = db.get('SELECT * FROM rotation WHERE scheduled_date=?', [today]);
  if (!rotation) return { error: 'No cook assigned today.' };
  const validStages = { cooking: 'cook_done', dishes: 'dishes_done' };
  if (rotation.status !== validStages[stage]) return { error: `${stage} hasn't been confirmed yet.` };
  const existing = db.get("SELECT * FROM disputes WHERE rotation_id=? AND stage=? AND status='open'", [rotation.id, stage]);
  if (existing) return { error: 'A dispute is already open.' };
  const exp = new Date(); exp.setMinutes(exp.getMinutes() + 30);
  db.run('INSERT INTO disputes (rotation_id,raised_by,stage,expires_at) VALUES (?,?,?,?)', [rotation.id, raisedById, stage, exp.toISOString()]);
  return { success: true, disputeId: db.lastId() };
}

async function castVote(memberId, vote) {
  await db.getDb();
  const dispute = db.get("SELECT * FROM disputes WHERE status='open' AND expires_at>datetime('now') ORDER BY created_at DESC LIMIT 1");
  if (!dispute) return { error: 'No open dispute.' };
  const already = db.get('SELECT * FROM dispute_votes WHERE dispute_id=? AND member_id=?', [dispute.id, memberId]);
  if (already) return { error: 'Already voted.' };
  db.run('INSERT INTO dispute_votes (dispute_id,member_id,vote) VALUES (?,?,?)', [dispute.id, memberId, vote ? 1 : 0]);
  const tally = db.get('SELECT SUM(vote) as yes, COUNT(*) as total FROM dispute_votes WHERE dispute_id=?', [dispute.id]);
  const totalMembers = db.get('SELECT COUNT(*) as c FROM members WHERE active=1').c;
  const majority = Math.floor(totalMembers / 2) + 1;
  if (tally.yes >= majority) {
    db.run("UPDATE disputes SET status='resolved_upheld' WHERE id=?", [dispute.id]);
    return { success: true, resolved: true, outcome: 'upheld' };
  } else if ((tally.total - tally.yes) >= majority) {
    db.run("UPDATE disputes SET status='resolved_overturned' WHERE id=?", [dispute.id]);
    const prevStatus = dispute.stage === 'cooking' ? 'pending' : 'cook_done';
    db.run('UPDATE rotation SET status=? WHERE id=?', [prevStatus, dispute.rotation_id]);
    return { success: true, resolved: true, outcome: 'overturned' };
  }
  return { success: true, resolved: false, votesIn: tally.total, needed: majority };
}

async function expireDisputes() {
  await db.getDb();
  db.run("UPDATE disputes SET status='resolved_upheld' WHERE status='open' AND expires_at<=datetime('now')");
  db.run("UPDATE swap_requests SET status='expired' WHERE status='pending' AND expires_at<=datetime('now')");
}

async function getOpenDispute() {
  await db.getDb();
  return db.get(`
    SELECT d.*, m.name as raised_by_name,
           (SELECT COUNT(*) FROM dispute_votes WHERE dispute_id=d.id) as votes_cast
    FROM disputes d JOIN members m ON d.raised_by=m.id
    WHERE d.status='open' AND d.expires_at>datetime('now')
    ORDER BY d.created_at DESC LIMIT 1`);
}

module.exports = { raiseDispute, castVote, expireDisputes, getOpenDispute };
