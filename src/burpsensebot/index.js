import { config } from '../../config.js';
import { logger } from '../utils/logger.js';
import { scanLinksForContracts } from '../utils/linkScanner.js';

export class BurpSenseBot {
  constructor({ bot, getMessages, getUserClient, sendAlert } = {}) {
    this.bot = bot;
    this.getMessages = typeof getMessages === 'function' ? getMessages : () => [];
    this.getUserClient = typeof getUserClient === 'function' ? getUserClient : () => null;
    this.sendAlertFn = typeof sendAlert === 'function' ? sendAlert : null;
  }

  async queryRickBurpBot(chatId = String(config.telegram.groupId)) {
    try {
      logger.info('Querying RickBurpBot: /tt@rick for tweets and /xt@rick for profiles');

      const waitMs = config.telegram.rickReplyWaitMs || 15000;
      const tweetsRes = await this.requestFromRickBot('/tt@rick', waitMs, chatId);
      const profilesRes = await this.requestFromRickBot('/xt@rick', waitMs, chatId);

      const combinedText = [tweetsRes.text, profilesRes.text].filter(Boolean).join('\n');
      const combinedEntityUrls = [
        ...(tweetsRes.urls || []),
        ...(profilesRes.urls || [])
      ];

      if (!combinedText) {
        logger.warn('No response from RickBurpBot');
        return null;
      }

      const parsed = this.parseTrendingData(combinedText);

      const tweetInputs = [...new Set([
        ...(parsed.tweetUrls || []),
        ...combinedEntityUrls.filter(u => /\/status\//i.test(u))
      ])];
      const tweetScan = await this.scanTweetsWithProfileFallback(tweetInputs);

      const handleUrls = (parsed.profileHandles || [])
        .map(h => h.replace(/^@/, ''))
        .filter(Boolean)
        .map(u => `https://x.com/${u}`);

      const otherInputs = [...new Set([
        ...parsed.profileUrls,
        ...handleUrls,
        ...combinedEntityUrls.filter(u => !/\/status\//i.test(u)),
        ...(parsed.urls || [])
      ])];
      const linkScan = await scanLinksForContracts(otherInputs);

      const evmCombined = [...new Set([
        ...(parsed.evmAddresses || []),
        ...(tweetScan.evmAddresses || []),
        ...(linkScan.evmAddresses || [])
      ])];
      const solCombined = [...new Set([
        ...(parsed.solanaAddresses || []),
        ...(tweetScan.solanaAddresses || []),
        ...(linkScan.solanaAddresses || [])
      ])];

      logger.info(`Parsed ${evmCombined.length} EVM, ${solCombined.length} Solana, ${parsed.tweetUrls.length} tweets, ${parsed.profileHandles.length} profiles`);

      const result = {
        ...parsed,
        evmAddresses: evmCombined,
        solanaAddresses: solCombined,
        linkDetails: [
          ...(tweetScan.details || []),
          ...(linkScan.details || [])
        ]
      };

      await this.shareDiscoverySummary(result, chatId);
      return result;
    } catch (error) {
      logger.error('Error querying RickBurpBot:', error);
      return null;
    }
  }

  async requestFromRickBot(commandText, waitMs, chatId) {
    try {
      const userClient = this.getUserClient();
      if (userClient?.ready) {
        const since = Date.now();
        const sent = await userClient.sendText(chatId, `${commandText}`);
        const viaUser = await userClient.pollBotReplies({
          chatId,
          fromUsername: config.telegram.rickBurpUsername,
          sinceMs: since - 1000,
          replyToMsgId: sent?.id || null,
          textIncludes: ['Trending', '𝕏', 'twitter.com', 'x.com'],
          timeoutMs: waitMs,
          pollIntervalMs: 3000,
          maxBatch: 120
        });
        if (viaUser?.text || (viaUser?.urls?.length || 0) > 0) {
          return { text: viaUser.text, urls: viaUser.urls };
        }
      } else if (this.bot?.telegram) {
        await this.bot.telegram.sendMessage(chatId, `${commandText}`);
      }

      const start = Date.now();
      const pollInterval = 3000;
      const groupIdStr = String(chatId);
      const rickBurpUser = (config.telegram.rickBurpUsername || '').replace('@', '');
      let responseText = '';
      let responseUrls = [];

      while (Date.now() - start < waitMs) {
        await new Promise(r => setTimeout(r, pollInterval));
        const cutoff = Date.now() - (waitMs + 15000);
        const hits = this.getMessages().filter(msg =>
          msg.timestamp.getTime() >= cutoff &&
          msg.chatId === groupIdStr &&
          ((rickBurpUser && msg.from === rickBurpUser) || (!rickBurpUser && msg.isBot))
        );
        if (hits.length > 0) {
          responseText = hits.map(m => m.text).join('\n');
          responseUrls = hits.flatMap(m => m.urls || []);
          break;
        }
      }

      if (!responseText) {
        const cutoff = Date.now() - 3 * 60 * 1000;
        const hits = this.getMessages().filter(m =>
          m.isBot &&
          m.chatId === groupIdStr &&
          m.timestamp.getTime() >= cutoff
        );
        if (hits.length > 0) {
          responseText = hits.map(m => m.text).join('\n');
          responseUrls = hits.flatMap(m => m.urls || []);
        }
      }

      return { text: responseText, urls: [...new Set(responseUrls)] };
    } catch (e) {
      logger.warn(`Request to RickBurpBot failed for '${commandText}': ${e.message}`);
      return { text: '', urls: [] };
    }
  }

  parseTrendingData(text) {
    const evmAddressRegex = /0x[a-fA-F0-9]{40}/g;
    const solanaAddressRegex = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

    const evmAddresses = text.match(evmAddressRegex) || [];
    const potentialSolanaAddresses = text.match(solanaAddressRegex) || [];
    const solanaAddresses = potentialSolanaAddresses.filter(addr =>
      addr.length >= 32 && addr.length <= 44 && !addr.startsWith('0x')
    );

    const tweetUrlRegex = /https?:\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/\d+/gi;
    const profileUrlRegex = /https?:\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+(?!\/status)/gi;
    const handleRegex = /@[A-Za-z0-9_]{1,15}/g;

    const tweetUrls = text.match(tweetUrlRegex) || [];
    const profileUrls = (text.match(profileUrlRegex) || []).filter(u => !tweetUrls.includes(u));
    const profileHandles = text.match(handleRegex) || [];

    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = text.match(urlRegex) || [];

    return {
      rawText: text,
      evmAddresses: [...new Set(evmAddresses)],
      solanaAddresses: [...new Set(solanaAddresses)],
      tweetUrls: [...new Set(tweetUrls)],
      profileUrls: [...new Set(profileUrls)],
      profileHandles: [...new Set(profileHandles.map(h => h.toLowerCase()))],
      urls,
      timestamp: new Date()
    };
  }

  async scanTweetsWithProfileFallback(tweetUrls) {
    const uniqueTweets = [...new Set((tweetUrls || []).filter(Boolean))];
    if (uniqueTweets.length === 0) {
      return { evmAddresses: [], solanaAddresses: [], details: [] };
    }

    const primary = await scanLinksForContracts(uniqueTweets);
    const found = (primary.evmAddresses?.length || 0) + (primary.solanaAddresses?.length || 0) > 0;
    if (found) return primary;

    const profiles = [];
    for (const u of uniqueTweets) {
      try {
        const p = new URL(u);
        const ok = /(x\.com|twitter\.com)/i.test(p.hostname);
        if (!ok) continue;
        const seg = p.pathname.split('/').filter(Boolean)[0];
        if (seg) profiles.push(`${p.protocol}//${p.hostname}/${seg}`);
      } catch {}
    }

    const profileScan = await scanLinksForContracts([...new Set(profiles)]);
    return {
      evmAddresses: [...new Set([
        ...(primary.evmAddresses || []),
        ...(profileScan.evmAddresses || [])
      ])],
      solanaAddresses: [...new Set([
        ...(primary.solanaAddresses || []),
        ...(profileScan.solanaAddresses || [])
      ])],
      details: [
        ...(primary.details || []),
        ...(profileScan.details || [])
      ]
    };
  }

  async shareDiscoverySummary(discovery, chatId) {
    try {
      const details = discovery.linkDetails || [];
      const evmSet = new Set([...(discovery.evmAddresses || [])]);
      const solSet = new Set([...(discovery.solanaAddresses || [])]);
      for (const d of details) {
        (d.evm || []).forEach(a => evmSet.add(a));
        (d.sol || []).forEach(a => solSet.add(a));
      }

      const evmAll = [...evmSet];
      const solAll = [...solSet];

      const header = 'Latest Burp Smells';
      const evmTitle = `EVM (${evmAll.length}):`;
      const solTitle = `SOL (${solAll.length}):`;

      const toTwitter = (u) => {
        try {
          const p = new URL(u);
          if (/nitter/i.test(p.hostname)) {
            const parts = p.pathname.split('/').filter(Boolean);
            const user = parts[0];
            if (parts[1] === 'status' && parts[2]) return `https://x.com/${user}/status/${parts[2]}`;
            if (user) return `https://x.com/${user}`;
          }
        } catch {}
        return u;
      };

      const mapEvm = new Map();
      const mapSol = new Map();
      for (const d of details) {
        const src = toTwitter(d.url);
        for (const a of (d.evm || [])) {
          const k = String(a).toLowerCase();
          if (!mapEvm.has(k)) mapEvm.set(k, new Set());
          mapEvm.get(k).add(src);
        }
        for (const a of (d.sol || [])) {
          const k = String(a);
          if (!mapSol.has(k)) mapSol.set(k, new Set());
          mapSol.get(k).add(src);
        }
      }

      const lines = [
        header,
        evmTitle,
        ...(evmAll.length ? [evmAll.join(', ')] : ['(none)']),
        solTitle,
        ...(solAll.length ? [solAll.join(', ')] : ['(none)'])
      ];

      if (mapEvm.size || mapSol.size) {
        lines.push('');
        if (mapEvm.size) {
          lines.push('Sources (EVM):');
          for (const a of evmAll) {
            const sources = [...(mapEvm.get(String(a).toLowerCase()) || [])];
            if (sources.length) lines.push(`- ${a} <- ${sources.join(', ')}`);
          }
        }
        if (mapSol.size) {
          lines.push('Sources (SOL):');
          for (const a of solAll) {
            const sources = [...(mapSol.get(String(a)) || [])];
            if (sources.length) lines.push(`- ${a} <- ${sources.join(', ')}`);
          }
        }
      }

      const chunks = this._chunkMessages(lines.join('\n'));
      for (const part of chunks) {
        await this.sendAlert(part, chatId);
      }
    } catch (e) {
      // Non-fatal
    }
  }

  async sendAlert(message, chatId) {
    if (this.sendAlertFn) {
      await this.sendAlertFn(message, chatId);
      return;
    }
    if (!this.bot?.telegram) return;
    try {
      await this.bot.telegram.sendMessage(chatId, message);
      logger.info('Alert sent to Telegram group');
    } catch (error) {
      logger.error('Error sending Telegram alert:', error);
    }
  }

  _chunkMessages(text, maxLen = 3500) {
    const out = [];
    let curr = '';
    for (const line of (text || '').split('\n')) {
      if ((curr + '\n' + line).length > maxLen && curr.length) {
        out.push(curr);
        curr = line;
      } else {
        curr = curr ? `${curr}\n${line}` : line;
      }
    }
    if (curr) out.push(curr);
    return out;
  }
}
