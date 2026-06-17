# 🍳 Household Cooking Bot

WhatsApp bot that fairly schedules and tracks cooking duties across two households.

**Members:**
- House 1: Dabwitso, Emmanuel, Muchafara, Nathan
- House 2: Bosco, Chibili

---

## How It Works

- Every 6 days, each person cooks once
- The cook is also responsible for the dishes that night
- Daily at **10:00** the bot announces who cooks tonight
- At **20:00** it sends a reminder if nothing has been confirmed
- Members confirm via WhatsApp commands
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
- `WHATSAPP_TOKEN` — your Meta API access token
- `WHATSAPP_PHONE_NUMBER_ID` — from the Meta developer dashboard
- `VERIFY_TOKEN` — any string you choose (used to verify your webhook with Meta)
- `GROUP_CHAT_ID` — the WhatsApp group ID (you'll see this in incoming webhook payloads once connected)

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

Use the ngrok HTTPS URL as your webhook URL in the Meta dashboard:
```
https://your-ngrok-url.ngrok.io/webhook
```

### 5. Set up Meta WhatsApp Cloud API

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create an app → WhatsApp → Cloud API
3. Add your webhook URL and verify token
4. Subscribe to the `messages` webhook field
5. Note your Phone Number ID and generate a permanent access token

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

Each person needs to link their phone number once. Send this in the WhatsApp group or as a DM:

```
register @Dabwitso
register @Emmanuel
register @Muchafara
register @Nathan
register @Bosco
register @Chibili
```

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
│       ├── whatsapp.js          # Meta API sender
│       └── templates.js         # All message templates
├── data/
│   └── cooking.db               # SQLite database (auto-created)
├── .env.example
├── package.json
└── README.md
```
