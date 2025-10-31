import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { logger } from '../utils/logger.js';
import { config } from '../../config.js';
import fs from 'fs/promises';

export class UserTelegramClient {
  constructor() {
    this.client = null;
    this.ready = false;
  }

  async init() {
    const { apiId, apiHash, sessionString, sessionFile } = config.telegram.user;
    if (!apiId || !apiHash) {
      logger.info('UserTelegramClient disabled (missing TELEGRAM_API_ID/API_HASH)');
      return;
    }

    let sess = sessionString || '';
    if (!sess) {
      try {
        const path = sessionFile;
        const data = await fs.readFile(path, 'utf8');
        sess = (data || '').trim();
      } catch {
        // no session yet
      }
    }

    if (!sess) {
      logger.error('No user session found. Run: npm run userbot:login (see .env.example for vars)');
      return;
    }

    const stringSession = new StringSession(sess);
    this.client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 3 });
    await this.client.connect();
    this.ready = true;
    logger.info('UserTelegramClient connected');
  }

  async sendText(chatId, text) {
    if (!this.ready) {
      logger.warn('UserTelegramClient not ready; cannot send');
      return null;
    }
    try {
      const res = await this.client.sendMessage(chatId, { message: text });
      return res; // return Message object
    } catch (e) {
      logger.error(`UserTelegramClient send failed: ${e.message}`);
      return null;
    }
  }

  // Poll recent messages in a chat and collect those from a specific username
  async pollBotReplies({ chatId, fromUsername, sinceMs, replyToMsgId = null, textIncludes = [], timeoutMs = 60000, pollIntervalMs = 3000, maxBatch = 100 }) {
    if (!this.ready) return { text: '', urls: [] };
    const started = Date.now();
    const target = (fromUsername || '').replace('@', '');
    const urls = new Set();
    let text = '';

    while (Date.now() - started < timeoutMs) {
      try {
        const entity = await this.client.getEntity(chatId);
        const iter = this.client.iterMessages(entity, { limit: maxBatch });
        const collected = [];
        for await (const m of iter) {
          const t = (m?.message || '').toString();
          let ts = 0;
          try {
            if (m?.date instanceof Date) {
              ts = m.date.getTime();
            } else if (typeof m?.date === 'number') {
              // gramJS sometimes returns seconds as number
              ts = (m.date > 1e12 ? m.date : m.date * 1000);
            } else if (m?.date) {
              const d = new Date(m.date);
              if (!isNaN(d.getTime())) ts = d.getTime();
            }
          } catch {}
          const from = m?.sender?.username || m?.from?.username || '';
          const replyId = (m?.replyTo && (m.replyTo.replyToMsgId || m.replyTo.reply_to_msg_id)) || null;
          const hasTextHit = (textIncludes || []).some(k => k && t.toLowerCase().includes(String(k).toLowerCase()));
          const isCandidate = (!target || from === target || hasTextHit);
          const matchesThread = !replyToMsgId || (replyId && replyToMsgId && Number(replyId) === Number(replyToMsgId));
          if (ts >= (sinceMs || 0) && isCandidate && matchesThread) {
            collected.push(m);
          }
        }
        if (collected.length > 0) {
          collected.sort((a,b)=> (a.date?.getTime()||0) - (b.date?.getTime()||0));
          for (const m of collected) {
            text += (m?.message || '') + '\n';
            for (const u of this._extractUrlsFromGram(m)) urls.add(u);
          }
          break;
        }
      } catch (e) {
        logger.warn(`UserTelegramClient poll failed: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
    return { text: text.trim(), urls: [...urls] };
  }

  _extractUrlsFromGram(msg) {
    try {
      const out = new Set();
      const text = (msg?.message || '').toString();
      const ents = msg?.entities || [];
      for (const ent of ents) {
        const name = ent?.className || ent?._;
        if (name && name.toLowerCase().includes('messageentitytexturl') && ent.url) {
          out.add(ent.url);
        } else if (name && name.toLowerCase().includes('messageentityurl')) {
          try {
            const offset = ent.offset || 0; const length = ent.length || 0;
            const u = text.substr(offset, length);
            if (u) out.add(u);
          } catch {}
        }
      }
      return [...out];
    } catch {
      return [];
    }
  }
}
