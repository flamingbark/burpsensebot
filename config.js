import dotenv from 'dotenv';

dotenv.config();

function parseIntOrNull(value) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

export const config = {
  telegram: {
    groupId: process.env.TELEGRAM_GROUP_ID || null,
    rickBurpUsername: process.env.RICKBURP_BOT_USERNAME || '@RickBurpBot',
    rickReplyWaitMs: parseIntOrNull(process.env.RICK_REPLY_WAIT_MS) || 15000,
    user: {
      apiId: parseIntOrNull(process.env.TELEGRAM_API_ID),
      apiHash: process.env.TELEGRAM_API_HASH || null,
      phoneNumber: process.env.TELEGRAM_PHONE_NUMBER || null,
      password: process.env.TELEGRAM_2FA_PASSWORD || null,
      sessionString: (process.env.TELEGRAM_USER_SESSION || '').trim() || null,
      sessionFile: process.env.TELEGRAM_USER_SESSION_FILE || 'data/user.session'
    }
  }
};
