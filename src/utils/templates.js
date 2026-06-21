/**
 * All bot message templates in one place.
 * Keep them friendly, clear, and short enough to read on a phone.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(dateStr) {
  const d = new Date(dateStr);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const templates = {
  morningAnnouncement: (cookName, house) =>
    `🍳 *Good morning!*\n\nTonight's cook is *${cookName}* (House ${house}).\n\n${cookName}, when you're done cooking reply *done cooking*, and once the dishes are sorted reply *done dishes*.\n\nNeed someone to cover? Reply *sub needed*.\nNeed to swap a future turn? Reply *swap @name*.`,

  eveningReminder: (cookName) =>
    `⏰ *Evening reminder*\n\n${cookName}, how did tonight go?\n\nReply *done cooking* or *sub needed* if you haven't already.`,

  cookingConfirmed: (cookName) =>
    `✅ *Cooking confirmed!*\n\n${cookName} has finished cooking. Dinner is served 🙌\n\nDishes next — ${cookName}, reply *done dishes* when you're done.`,

  dishesConfirmed: (cookName) =>
    `✅ *Dishes confirmed!*\n\n${cookName} is all done — cooking and dishes sorted for today. Nice one! 👏`,

  subRequest: (cookName) =>
    `🆘 *Sub needed!*\n\n*${cookName}* can't cook tonight and needs someone to step in.\n\nReply *cover* to volunteer. First person in wins.\n\n_(Note: ${cookName} will owe a turn)_`,

  subFilled: (volunteerName, cookName) =>
    `✅ *Sub covered!*\n\n*${volunteerName}* has volunteered to cook tonight in place of ${cookName}.\n\n${volunteerName}, you're on! Reply *done cooking* when you're done.`,

  subExpired: (cookName) =>
    `⚠️ *No volunteer found*\n\nNo one stepped up to cover for ${cookName}. Admins please sort this out.`,

  swapRequest: (requesterName, targetName, date) =>
    `🔄 *Swap request*\n\n*${requesterName}* wants to swap their cooking turn (${fmtDate(date)}) with *${targetName}*.\n\n${targetName}, reply *swap yes* to accept or *swap no* to decline. Request expires in 2 hours.`,

  swapAccepted: (requesterName, targetName) =>
    `✅ *Swap accepted!*\n\n${requesterName} and ${targetName} have swapped turns. Schedule updated.`,

  swapDeclined: (requesterName, targetName) =>
    `❌ *Swap declined*\n\n${targetName} declined the swap request from ${requesterName}. No change to the schedule.`,

  disputeRaised: (raisedBy, stage, cookName) =>
    `⚠️ *Dispute raised!*\n\n*${raisedBy}* is disputing that ${cookName} confirmed *${stage}*.\n\nAll members: reply *yes* to uphold the confirmation or *no* to overturn it.\n\nVoting closes in 30 minutes. Majority wins.`,

  disputeResult: (outcome, cookName, stage) => {
    if (outcome === 'upheld') {
      return `✅ *Dispute resolved — upheld*\n\n${cookName}'s ${stage} confirmation stands. Majority voted yes.`;
    }
    return `🔄 *Dispute resolved — overturned*\n\n${cookName}'s ${stage} confirmation has been reversed. ${cookName}, please make sure it's actually done and confirm again.`;
  },

  schedule: (days) => {
    const lines = days.map(d => {
      const status = d.status === 'dishes_done' ? '✅' :
                     d.status === 'cook_done' ? '🍳' :
                     d.status === 'projected' ? '📅' :
                     d.status === 'skipped' ? '⏭️' : '⏳';
      return `${status} ${fmtDate(d.date)}: *${d.cook}*`;
    });
    return `📋 *Cooking schedule — next 7 days*\n\n${lines.join('\n')}\n\n✅ done  🍳 cooking  ⏳ upcoming  📅 projected`;
  },

  help: () =>
    `🤖 *Cooking Bot — Commands*\n\n` +
    `*today* — who's cooking tonight?\n` +
    `*done cooking* — confirm you cooked tonight\n` +
    `*done dishes* — confirm dishes are done\n` +
    `*rating 1-5* — rate the meal\n` +
    `*sub needed* — ask for someone to cover you\n` +
    `*cover* — volunteer to cover tonight's cook\n` +
    `*delegate @name* — ask someone else to cook for you\n` +
    `*swap @name* — request a turn swap\n` +
    `*swap yes / swap no* — accept/decline a swap\n` +
    `*dispute cooking* — dispute a cooking confirmation\n` +
    `*dispute dishes* — dispute a dishes confirmation\n` +
    `*yes / no* — vote on an open dispute\n` +
    `*schedule* — see the next 7 days\n` +
    `*skip* — mark yourself as skipping (moves to front of queue)\n` +
    `*register @name* — link your Telegram ID\n\n` +
    `👤 *ADMIN (Dabwitso):*\n` +
    `*admin reassign @name1 @name2* — change today's cook\n` +
    `*admin assign @name1 covers @name2* — coverage with turn swap\n` +
    `*admin skip @name N cycles* — skip someone for N cycles`,

  registered: (name) =>
    `✅ You're registered as *${name}*. You'll now receive reminders and updates.`,

  notRecognised: () =>
    `🤔 I didn't understand that. Reply *help* to see all commands.`,

  notAssigned: () =>
    `You're not assigned to cook today, so that command doesn't apply to you right now.`,
};

module.exports = templates;
