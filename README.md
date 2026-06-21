# 🍳 Household Cooking Bot

Telegram bot that fairly schedules and tracks cooking duties across two households.

**Members:**
- House 1: Dabwitso, Emmanuel, Muchafara, Nathan
- House 2: Bosco, Chibili

---

## How It Works

- Every 6 days, each person cooks once
- The cook is also responsible for the dishes that night
- Daily at **10:00** the bot announces who cooks tonight
- At **20:00** it sends a reminder if nothing has been confirmed
- Members confirm via Telegram commands in the group chat
- Anyone can raise a dispute; majority vote resolves it

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

Edit `.env` with your values:
- `TELEGRAM_BOT_TOKEN` — your Telegram bot token from BotFather
- `GROUP_CHAT_ID` — the Telegram group chat ID (a negative number, e.g., -1001234567890)

### 3. Run
```bash
npm start
# or for development with auto-restart:
npm run dev
```

### 4. Expose your webhook
For local development, use [ngrok](https://ngrok.com):
```bash
ngrok http 3000
```

### 5. Set up Telegram Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Create a new bot with `/newbot`
3. Copy the HTTP API token
4. Set your webhook with:
   ```
   curl -X POST https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-ngrok-url.ngrok.io/webhook
   ```
5. Create a Telegram group and invite your bot
6. Get the group chat ID by sending a message and checking `GET /config` endpoint

### 6. Deploy to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

Set your environment variables in the Railway dashboard under your project settings.

---

## Member Registration

Each person needs to link their Telegram ID once. Send this in the Telegram group:

```
register @Dabwitso
register @Emmanuel
register @Muchafara
register @Nathan
register @Bosco
register @Chibili
```

Members who haven't registered will see a prompt with available names.

---

## Commands Reference

| Command | What it does |
|---|---|
| `done cooking` | Confirm you've finished cooking tonight |
| `done dishes` | Confirm dishes are done |
| `sub needed` | Ask for a volunteer to cover you tonight |
| `cover` | Volunteer to cook for whoever needs a sub |
| `swap @name` | Request a turn swap with another member |
| `swap yes` | Accept a swap request directed at you |
| `swap no` | Decline a swap request |
| `dispute cooking` | Dispute that cooking was actually done |
| `dispute dishes` | Dispute that dishes were actually done |
| `yes` / `no` | Vote on an open dispute |
| `skip` | Mark yourself as skipping tonight (you go to front of tomorrow's queue) |
| `schedule` | See the next 7 days |
| `help` | List all commands |

---

## Sub vs Swap

**Sub needed** — you can't cook tonight, someone covers you, but you *owe a turn*.
The system tracks this automatically and schedules your owed turn.

**Swap** — mutual exchange of future turns. No debt, just a reshuffled schedule.

---

## Dispute Flow

1. Any member types `dispute cooking` or `dispute dishes`
2. Bot sends a group poll
3. Members reply `yes` (uphold) or `no` (overturn)
4. First to reach 4 out of 6 votes wins
5. If no majority in 30 minutes, confirmation stands by default

---

## Health Check

```
GET /health
```

Returns current member list with queue positions and today's assigned cook.

---

## Manual Triggers (for testing)

```
POST /trigger/morning
```

Runs the morning announcement immediately without waiting for the cron.

---

## Project Structure

```
cooking-bot/
├── src/
│   ├── index.js                 # Express server + webhook
│   ├── db/
│   │   └── database.js          # SQLite schema + seed
│   ├── handlers/
│   │   ├── rotation.js          # Core scheduling logic
│   │   ├── disputes.js          # Dispute + voting logic
│   │   └── messageHandler.js    # Command parser
│   ├── scheduler/
│   │   └── crons.js             # Morning/evening cron jobs
│   └── utils/
│       ├── telegram.js          # Telegram Bot API sender
│       └── templates.js         # All message templates
├── data/
│   └── cooking.db               # SQLite database (auto-created)
├── .env.example
├── package.json
└── README.md
```
