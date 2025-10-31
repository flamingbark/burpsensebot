## BurpSenseBot

BurpSenseBot combines the original TelegramCloudAutomation prompt sender with
the on-chain discovery helper that parses RickBurpBot replies. A single
Telegram **user** session (run via MTProto) can now:

- Trigger `/tt@rick` and `/xt@rick` on demand or on a schedule (no Bot API
  account required).
- Watch for RickBurpBot replies, pull the referenced tweets/profiles through
  Nitter mirrors, and extract contract addresses when they appear.
- Post a "Latest Burp Smells" summary directly back into the same chat.

### Requirements

- Node.js 18+
- A Telegram user account that belongs to each target chat
- `.env` populated from `.env.example`

### Installation

```bash
npm install
```

### Sending prompts (cloud-style)

Run once:

```bash
npm start
```

Configure a cron (every 4 hours):

```cron
0 */4 * * * cd /path/to/burpsensebot \
  && /usr/bin/env PATH=/usr/local/bin:/usr/bin npm start >> logs/cron.log 2>&1
```

Docker:

```bash
docker build -t burpsensebot .
docker run --rm --env-file .env -v $PWD/data:/app/data burpsensebot
```

### BurpSense discovery loop

The discovery helper asks RickBurpBot for the latest data, scans the links for
contract addresses, and posts the summary back into the chat.

```bash
npm run burpsense:user
```

If you only want the parsed output without posting to Telegram, pipe the
returned object by editing `src/burpsensebot/runUserDiscovery.js` to suit your
workflow.

### Environment variables

See `.env.example` for the full list. At minimum you need:

- `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`
- Either `TELEGRAM_USER_SESSION` **or** `TELEGRAM_USER_SESSION_FILE`
- `TELEGRAM_GROUP_ID` or `TELEGRAM_GROUP_IDS`

Optional tuning hints:

- Adjust `RICK_REPLY_WAIT_MS` if RickBurpBot is slow to answer.
- Provide `NITTER_BASE_URL` or fallback mirrors to improve scraping success.

### Project structure

```
├── Dockerfile
├── config.js
├── src
│   ├── burpsensebot
│   │   ├── index.js            # Core discovery + summary helper
│   │   └── runUserDiscovery.js # CLI entry point for summary posting
│   ├── sendPrompts.js          # Minimal cloud sender
│   └── telegram
│       └── userClient.js       # MTProto user session wrapper
└── src/utils                   # Shared logging + scraping helpers
```

Logs are written to `logs/sender.log` by default; the MTProto session file is
stored under `data/user.session` unless overridden in the environment.
