const db = require('../db/database');

async function raiseDispute(raisedById, stage) {
  await db.getDb();
  const today = new Date().toISOString().split('T')[0];
  const rotation = await db.get('SELECT * FROM rotation WHERE scheduled_date=$1', [today]);
  if (!rotation) return { error: 'No cook assigned today.' };
  const validStages = { cooking: 'cook_done', dishes: 'dishes_done' };
  if (rotation.status !== validStages[stage]) return { error: `${stage} hasn't been confirmed yet.` };
  const existing = await db.get("SELECT * FROM disputes WHERE rotation_id=$1 AND stage=$2 AND status='open'", [rotation.id, stage]);
  if (existing) return { error: 'A dispute is already open.' };
  const exp = new Date(); exp.setMinutes(exp.getMinutes() + 30);
  await db.run('INSERT INTO disputes (rotation_id,raised_by,stage,expires_at) VALUES ($1,$2,$3,$4)', [rotation.id, raisedById, stage, exp.toISOString()]);
  return { success: true, disputeId: db.lastId() };
}

async function castVote(memberId, vote) {
  await db.getDb();
  const dispute = await db.get("SELECT * FROM disputes WHERE status='open' AND expires_at>now()::text ORDER BY created_at DESC LIMIT 1");
  if (!dispute) return { error: 'No open dispute.' };
  const already = await db.get('SELECT * FROM dispute_votes WHERE dispute_id=$1 AND member_id=$2', [dispute.id, memberId]);
  if (already) return { error: 'Already voted.' };
  await db.run('INSERT INTO dispute_votes (dispute_id,member_id,vote) VALUES ($1,$2,$3)', [dispute.id, memberId, vote ? 1 : 0]);
  const tally = await db.get('SELECT SUM(vote) as yes, COUNT(*) as total FROM dispute_votes WHERE dispute_id=$1', [dispute.id]);
  const totalMembers = await db.get('SELECT COUNT(*) as c FROM members WHERE active=1');
  const majority = Math.floor(totalMembers.c / 2) + 1;
  if (tally.yes >= majority) {
    await db.run("UPDATE disputes SET status='resolved_upheld' WHERE id=$1", [dispute.id]);
    return { success: true, resolved: true, outcome: 'upheld' };
  } else if ((tally.total - tally.yes) >= majority) {
    await db.run("UPDATE disputes SET status='resolved_overturned' WHERE id=$1", [dispute.id]);
    const prevStatus = dispute.stage === 'cooking' ? 'pending' : 'cook_done';
    await db.run('UPDATE rotation SET status=$1 WHERE id=$2', [prevStatus, dispute.rotation_id]);
    return { success: true, resolved: true, outcome: 'overturned' };
  }
  return { success: true, resolved: false, votesIn: tally.total, needed: majority };
}

async function expireDisputes() {
  await db.getDb();
  await db.run("UPDATE disputes SET status='resolved_upheld' WHERE status='open' AND expires_at<=now()::text");
  await db.run("UPDATE swap_requests SET status='expired' WHERE status='pending' AND expires_at<=now()::text");
}

async function getOpenDispute() {
  await db.getDb();
  return db.get(`
    SELECT d.*, m.name as raised_by_name,
           (SELECT COUNT(*) FROM dispute_votes WHERE dispute_id=d.id) as votes_cast
    FROM disputes d JOIN members m ON d.raised_by=m.id
    WHERE d.status='open' AND d.expires_at>now()::text
    ORDER BY d.created_at DESC LIMIT 1`);
}

module.exports = { raiseDispute, castVote, expireDisputes, getOpenDispute };
