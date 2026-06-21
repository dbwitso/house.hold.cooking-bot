const rotation = require('./rotation');
const disputes = require('./disputes');
const { sendMessage: tgSend, sendToMember } = require('../utils/telegram');
const templates = require('../utils/templates');
const db = require('../db/database');

let currentChatId = null;

async function send(to, text) {
  await tgSend(currentChatId || to, text);
}

async function broadcast(text) {
  const members = await rotation.getAllMembers();
  for (const member of members) {
    await sendToMember(member, text);
  }
}

async function handleMessage(from, text, chatId) {
  currentChatId = chatId;
  const raw = text.trim().toLowerCase();

  console.log(`[HANDLER] from=${from}, chatId=${chatId}, text="${text}"`);

  // Register (works before Telegram ID is linked)
  const regMatch = raw.match(/^register\s+@?(\w+)$/);
  if (regMatch) {
    const nameToRegister = regMatch[1];
    console.log(`[REGISTER] Attempting to register ${nameToRegister} with ID ${from}`);

    try {
      const target = await rotation.getMemberByName(nameToRegister);
      if (!target) {
        console.log(`[REGISTER] Name "${nameToRegister}" not found in database`);
        await send(from, `❌ "${nameToRegister}" not in the list. Names: Dabwitso, Emmanuel, Muchafara, Nathan, Bosco, Chibili.`);
        return;
      }

      console.log(`[REGISTER] Found member: ${target.name} (ID: ${target.id}). Setting telegram_id to ${from}`);
      await rotation.setMemberTelegramId(target.name, from);
      console.log(`[REGISTER] ✅ Successfully registered ${target.name} with telegram_id ${from}`);

      await send(from, templates.registered(target.name));
      return;
    } catch (err) {
      console.error(`[REGISTER] ERROR:`, err.message);
      await send(from, `❌ Registration failed: ${err.message}`);
      return;
    }
  }

  const member = await rotation.getMemberByTelegramId(from);
  if (!member) {
    console.log(`[HANDLER] User ${from} not registered, sending registration prompt`);
    await send(from, `👋 Reply *register @YourName* to link your Telegram ID.\nNames: Dabwitso, Emmanuel, Muchafara, Nathan, Bosco, Chibili.`);
    return;
  }

  console.log(`[HANDLER] User registered as: ${member.name}`);

  if (raw === 'help') {
    console.log(`[HELP] Sending help to ${member.name}`);
    await send(from, templates.help());
    return;
  }

  // Admin commands (Dabwitso only)
  if (member.name === 'Dabwitso') {
    // Reassign today's cook
    const reassignMatch = raw.match(/^admin reassign @?(\w+) @?(\w+)$/);
    if (reassignMatch) {
      console.log(`[ADMIN] Reassigning ${reassignMatch[1]} to ${reassignMatch[2]}`);
      const current = await rotation.getMemberByName(reassignMatch[1]);
      const newCook = await rotation.getMemberByName(reassignMatch[2]);
      if (!current) { await send(from, `❌ "${reassignMatch[1]}" not found`); return; }
      if (!newCook) { await send(from, `❌ "${reassignMatch[2]}" not found`); return; }

      const today = new Date().toISOString().split('T')[0];
      await db.run('UPDATE rotation SET member_id=$1 WHERE scheduled_date=$2', [newCook.id, today]);
      await broadcast(`🔄 *Admin change:* ${current.name} → ${newCook.name} for today`);
      return;
    }

    // Assign with swap (coverage = swap turn)
    const swapCoverMatch = raw.match(/^admin assign @?(\w+) covers @?(\w+)$/);
    if (swapCoverMatch) {
      console.log(`[ADMIN] ${swapCoverMatch[1]} covers for ${swapCoverMatch[2]} (swap turns)`);
      const coverPerson = await rotation.getMemberByName(swapCoverMatch[1]);
      const originalPerson = await rotation.getMemberByName(swapCoverMatch[2]);
      if (!coverPerson) { await send(from, `❌ "${swapCoverMatch[1]}" not found`); return; }
      if (!originalPerson) { await send(from, `❌ "${swapCoverMatch[2]}" not found`); return; }

      const today = new Date().toISOString().split('T')[0];
      // Assign cover person to today
      await db.run('UPDATE rotation SET member_id=$1 WHERE scheduled_date=$2', [coverPerson.id, today]);
      // Create a debt: original person gets cover person's future turn
      // (This is handled manually for now - need to swap their queue positions)
      await broadcast(`🔄 *Coverage with turn swap:*\n${coverPerson.name} cooks TODAY\n${originalPerson.name} takes ${coverPerson.name}'s future turn`);
      return;
    }

    // Reorder queue
    const queueMatch = raw.match(/^admin queue (.+)$/);
    if (queueMatch) {
      const names = queueMatch[1].split(/\s+/).map(n => n.replace('@', ''));
      console.log(`[ADMIN] Reordering queue: ${names.join(' → ')}`);

      const members = [];
      for (const name of names) {
        const member = await rotation.getMemberByName(name);
        if (!member) {
          await send(from, `❌ "${name}" not found`);
          return;
        }
        members.push(member);
      }

      // Update queue positions
      for (let i = 0; i < members.length; i++) {
        await db.run('UPDATE members SET queue_position=$1 WHERE id=$2', [i + 1, members[i].id]);
      }

      const order = members.map(m => m.name).join(' → ');
      await broadcast(`📋 *Queue reordered:*\n${order}`);
      console.log(`[ADMIN] ✅ Queue set to: ${order}`);
      return;
    }
  }

  // Rating system (after dishes done)
  const ratingMatch = raw.match(/^rating\s+([1-5])$/);
  if (ratingMatch) {
    console.log(`[RATING] ${member.name} rated meal: ${ratingMatch[1]} stars`);
    const today = new Date().toISOString().split('T')[0];
    await db.run('UPDATE rotation SET meal_rating=$1 WHERE scheduled_date=$2', [parseInt(ratingMatch[1]), today]);
    const stars = '⭐'.repeat(parseInt(ratingMatch[1]));
    await send(from, `${stars} Thanks for the feedback!`);
    return;
  }

  if (raw === 'today' || raw === 'today cook' || raw === "who's cooking") {
    console.log(`[TODAY] ${member.name} checking today's cook`);
    const today = await rotation.getTodayRotation();
    if (today) {
      const cook = today.covered_by_name || today.cook_name;
      await send(from, `🍳 *Today's Cook:* ${cook}\nStatus: ${today.status}`);
    } else {
      await send(from, `📅 No cook assigned yet for today.`);
    }
    return;
  }

  if (raw === 'schedule') {
    console.log(`[SCHEDULE] Fetching schedule for ${member.name}`);
    const days = await rotation.getUpcomingSchedule(7);
    await send(from, templates.schedule(days));
    return;
  }

  if (raw === 'done cooking') {
    console.log(`[DONE_COOKING] ${member.name} confirming cooking done`);
    const r = await rotation.confirmCookingDone(member.id);
    if (r.error) {
      console.log(`[DONE_COOKING] Error: ${r.error}`);
      await send(from, `❌ ${r.error}`);
      return;
    }
    const rot = await rotation.getTodayRotation();
    await broadcast(templates.cookingConfirmed(rot.covered_by_name || rot.cook_name));
    return;
  }

  if (raw === 'done dishes') {
    console.log(`[DONE_DISHES] ${member.name} confirming dishes done`);
    const r = await rotation.confirmDishesDone(member.id);
    if (r.error) {
      console.log(`[DONE_DISHES] Error: ${r.error}`);
      await send(from, `❌ ${r.error}`);
      return;
    }
    const rot = await rotation.getTodayRotation();
    await broadcast(templates.dishesConfirmed(rot.covered_by_name || rot.cook_name));
    return;
  }

  if (raw === 'skip') {
    console.log(`[SKIP] ${member.name} skipping today`);
    const r = await rotation.skipToday(member.id);
    if (r.error) {
      console.log(`[SKIP] Error: ${r.error}`);
      await send(from, `❌ ${r.error}`);
      return;
    }
    await broadcast(`⏭️ *${member.name}* skipped tonight and moves to front of tomorrow's queue.`);
    return;
  }

  if (raw === 'sub needed') {
    console.log(`[SUB_REQUEST] ${member.name} needs a sub`);
    const r = await rotation.requestSub(member.id);
    if (r.error) {
      console.log(`[SUB_REQUEST] Error: ${r.error}`);
      await send(from, `❌ ${r.error}`);
      return;
    }
    await broadcast(templates.subRequest(member.name));
    return;
  }

  if (raw === 'cover') {
    console.log(`[COVER] ${member.name} volunteering to cover`);
    const r = await rotation.coverSub(member.id);
    if (r.error) {
      console.log(`[COVER] Error: ${r.error}`);
      await send(from, `❌ ${r.error}`);
      return;
    }
    const rot = await rotation.getTodayRotation();
    await broadcast(templates.subFilled(member.name, rot.cook_name));
    return;
  }

  const swapReqMatch = raw.match(/^swap\s+@?(\w+)$/);
  if (swapReqMatch && !['yes','no'].includes(swapReqMatch[1])) {
    console.log(`[SWAP_REQUEST] ${member.name} requesting swap with ${swapReqMatch[1]}`);
    const r = await rotation.requestSwap(member.id, swapReqMatch[1]);
    if (r.error) {
      console.log(`[SWAP_REQUEST] Error: ${r.error}`);
      await send(from, `❌ ${r.error}`);
      return;
    }
    const rot = await rotation.getTodayRotation();
    await broadcast(templates.swapRequest(member.name, r.targetName, rot?.scheduled_date));
    return;
  }

  if (raw === 'swap yes') {
    console.log(`[SWAP_ACCEPT] ${member.name} accepting swap`);
    const r = await rotation.acceptSwap(member.id);
    if (r.error) {
      console.log(`[SWAP_ACCEPT] Error: ${r.error}`);
      await send(from, `❌ ${r.error}`);
      return;
    }
    await broadcast(templates.swapAccepted(member.name, ''));
    return;
  }

  if (raw === 'swap no') {
    console.log(`[SWAP_DECLINE] ${member.name} declining swap`);
    const r = await rotation.declineSwap(member.id);
    if (r.error) {
      console.log(`[SWAP_DECLINE] Error: ${r.error}`);
      await send(from, `❌ ${r.error}`);
      return;
    }
    await broadcast(`❌ *Swap declined* by ${member.name}.`);
    return;
  }

  if (raw === 'dispute cooking' || raw === 'dispute dishes') {
    const stage = raw.split(' ')[1];
    console.log(`[DISPUTE] ${member.name} raising dispute on ${stage}`);
    const r = await disputes.raiseDispute(member.id, stage);
    if (r.error) {
      console.log(`[DISPUTE] Error: ${r.error}`);
      await send(from, `❌ ${r.error}`);
      return;
    }
    const rot = await rotation.getTodayRotation();
    await broadcast(templates.disputeRaised(member.name, stage, rot.covered_by_name || rot.cook_name));
    return;
  }

  if (raw === 'yes' || raw === 'no') {
    console.log(`[VOTE] ${member.name} voting ${raw}`);
    const openDispute = await disputes.getOpenDispute();
    if (!openDispute) {
      console.log(`[VOTE] No open dispute`);
      await send(from, 'No open dispute right now.');
      return;
    }
    const r = await disputes.castVote(member.id, raw === 'yes');
    if (r.error) {
      console.log(`[VOTE] Error: ${r.error}`);
      await send(from, `❌ ${r.error}`);
      return;
    }
    if (r.resolved) {
      const rot = await rotation.getTodayRotation();
      await broadcast(templates.disputeResult(r.outcome, rot.covered_by_name || rot.cook_name, openDispute.stage));
    } else {
      await send(from, `✅ Vote recorded. ${r.votesIn} votes so far, need ${r.needed}.`);
    }
    return;
  }

  console.log(`[HANDLER] Command not recognized: "${text}"`);
  await send(from, templates.notRecognised());
}

module.exports = { handleMessage };
