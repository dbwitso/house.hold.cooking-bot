const rotation = require('./rotation');
const disputes = require('./disputes');
const { sendMessage: waSend, sendGroupMessage } = require('../utils/whatsapp');
const templates = require('../utils/templates');

async function send(to, text) { await waSend(to, text); }

async function handleMessage(from, text, isGroup) {
  const raw = text.trim().toLowerCase();

  // Register (works before phone is linked)
  const regMatch = raw.match(/^register\s+@?(\w+)$/);
  if (regMatch) {
    const target = await rotation.getMemberByName(regMatch[1]);
    if (!target) { await send(from, `❌ "${regMatch[1]}" not in the list. Names: Dabwitso, Emmanuel, Muchafara, Nathan, Bosco, Chibili.`); return; }
    rotation.setMemberPhone(target.name, from);
    await send(from, templates.registered(target.name));
    return;
  }

  const member = await rotation.getMemberByPhone(from);
  if (!member) {
    await send(from, `👋 Reply *register @YourName* to link your number.\nNames: Dabwitso, Emmanuel, Muchafara, Nathan, Bosco, Chibili.`);
    return;
  }

  if (raw === 'help') { await send(from, templates.help()); return; }

  if (raw === 'schedule') {
    const days = await rotation.getUpcomingSchedule(7);
    await send(from, templates.schedule(days));
    return;
  }

  if (raw === 'done cooking') {
    const r = await rotation.confirmCookingDone(member.id);
    if (r.error) { await send(from, `❌ ${r.error}`); return; }
    const rot = await rotation.getTodayRotation();
    await sendGroupMessage(templates.cookingConfirmed(rot.covered_by_name || rot.cook_name));
    return;
  }

  if (raw === 'done dishes') {
    const r = await rotation.confirmDishesDone(member.id);
    if (r.error) { await send(from, `❌ ${r.error}`); return; }
    const rot = await rotation.getTodayRotation();
    await sendGroupMessage(templates.dishesConfirmed(rot.covered_by_name || rot.cook_name));
    return;
  }

  if (raw === 'skip') {
    const r = await rotation.skipToday(member.id);
    if (r.error) { await send(from, `❌ ${r.error}`); return; }
    await sendGroupMessage(`⏭️ *${member.name}* skipped tonight and moves to front of tomorrow's queue.`);
    return;
  }

  if (raw === 'sub needed') {
    const r = await rotation.requestSub(member.id);
    if (r.error) { await send(from, `❌ ${r.error}`); return; }
    await sendGroupMessage(templates.subRequest(member.name));
    return;
  }

  if (raw === 'cover') {
    const r = await rotation.coverSub(member.id);
    if (r.error) { await send(from, `❌ ${r.error}`); return; }
    const rot = await rotation.getTodayRotation();
    await sendGroupMessage(templates.subFilled(member.name, rot.cook_name));
    return;
  }

  const swapReqMatch = raw.match(/^swap\s+@?(\w+)$/);
  if (swapReqMatch && !['yes','no'].includes(swapReqMatch[1])) {
    const r = await rotation.requestSwap(member.id, swapReqMatch[1]);
    if (r.error) { await send(from, `❌ ${r.error}`); return; }
    const rot = await rotation.getTodayRotation();
    await sendGroupMessage(templates.swapRequest(member.name, r.targetName, rot?.scheduled_date));
    return;
  }

  if (raw === 'swap yes') {
    const r = await rotation.acceptSwap(member.id);
    if (r.error) { await send(from, `❌ ${r.error}`); return; }
    await sendGroupMessage(templates.swapAccepted(member.name, ''));
    return;
  }

  if (raw === 'swap no') {
    const r = await rotation.declineSwap(member.id);
    if (r.error) { await send(from, `❌ ${r.error}`); return; }
    await sendGroupMessage(`❌ *Swap declined* by ${member.name}.`);
    return;
  }

  if (raw === 'dispute cooking' || raw === 'dispute dishes') {
    const stage = raw.split(' ')[1];
    const r = await disputes.raiseDispute(member.id, stage);
    if (r.error) { await send(from, `❌ ${r.error}`); return; }
    const rot = await rotation.getTodayRotation();
    await sendGroupMessage(templates.disputeRaised(member.name, stage, rot.covered_by_name || rot.cook_name));
    return;
  }

  if (raw === 'yes' || raw === 'no') {
    const openDispute = await disputes.getOpenDispute();
    if (!openDispute) { await send(from, 'No open dispute right now.'); return; }
    const r = await disputes.castVote(member.id, raw === 'yes');
    if (r.error) { await send(from, `❌ ${r.error}`); return; }
    if (r.resolved) {
      const rot = await rotation.getTodayRotation();
      await sendGroupMessage(templates.disputeResult(r.outcome, rot.covered_by_name || rot.cook_name, openDispute.stage));
    } else {
      await send(from, `✅ Vote recorded. ${r.votesIn} votes so far, need ${r.needed}.`);
    }
    return;
  }

  await send(from, templates.notRecognised());
}

module.exports = { handleMessage };
