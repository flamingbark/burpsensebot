import axios from 'axios';
import { logger } from './logger.js';
import he from 'he';
import { looksLikeNitterHtml } from './nitterHeuristics.js';

// Regexes for extracting contract addresses
const EVM_REGEX = /0x[a-fA-F0-9]{40}/g;
// Allow up to 60 to catch cases like "<address>pump" then normalize later
const SOL_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{32,60}\b/g;

export function extractAddressesFromText(text) {
  if (!text) return { evm: [], sol: [] };
  // Normalize: decode entities, strip zero-width chars and fancy punctuation that may split addresses
  const cleaned = sanitizeHtmlToText(text);
  const evm = [...new Set((cleaned.match(EVM_REGEX) || []).map(s => s.toLowerCase()))];
  const possibles = cleaned.match(SOL_REGEX) || [];
  const sol = [...new Set(possibles
    .map(s => s.replace(/pump$/i, ''))
    .map(s => s.substring(0, 44)) // ensure max length 44
    .filter(a => a.length >= 32 && a.length <= 44 && !a.startsWith('0x'))
  )];
  return { evm, sol };
}

export async function scanLinksForContracts(urls, options = {}) {
  const unique = [...new Set((urls || []).filter(Boolean))];
  const timeout = options.timeoutMs || 12000;
  const ua = options.userAgent || 'Mozilla/5.0 (compatible; TrendScannerBot/1.0; +https://example.com/bot)';
  const nitterBase = (process.env.NITTER_BASE_URL || '').replace(/\/$/, '');
  const fallbackMirrors = (process.env.NITTER_FALLBACKS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const defaultMirrors = [
    'https://nitter.net',
    'https://nitter.it',
    'https://nitter.fdn.fr',
    'https://nitter.domain.glass',
    'https://nitter.poast.org',
    'https://nitter.moomoo.me',
    // User-provided additional mirrors
    'https://twitt.re',
    'https://nitter.dashy.a3x.dn.nyx.im',
    'http://46.250.231.226:8889',
    'https://nitter.privacydev.net',
    'https://xcancel.com'
  ];
  const mirrors = [nitterBase, ...fallbackMirrors, ...defaultMirrors].filter(Boolean);
  // Only attempt each page once (no per-page retries)
  const attempts = 1;
  const backoffMs = parseInt(process.env.NITTER_ATTEMPT_DELAY_MS || '1500');

  const foundEvm = new Set();
  const foundSol = new Set();
  const details = [];

  for (const src of unique) {
    try {
      // Try through a set of Nitter mirrors for both profiles and tweets
      let extracted = { evm: [], sol: [] };
      let finalDetail = { url: src, evm: [], sol: [] };
      let tweetLinks = [];
      let gotPage = false; // stop on first page that loads, per user preference
      for (const mirror of mirrors) {
        const candidates = mapToNitterCandidates(src, mirror);
        let lastErr = null;
        for (const fetchUrl of candidates) {
          for (let i = 0; i < attempts; i++) {
            try {
              logger.info(`Scanning single page (no crawl): ${fetchUrl} [try ${i+1}/${attempts}]`);
              const res = await axios.get(fetchUrl, {
                timeout,
                maxRedirects: 5,
                headers: {
                  'user-agent': ua,
                  'accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
                  'accept-language': 'en-US,en;q=0.9',
                  'referer': 'https://x.com/'
                },
                validateStatus: (s) => s >= 200 && s < 400
              });
              const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
              const body = sanitizeHtmlToText(raw);
              extracted = extractAddressesFromText(body);
              finalDetail = { url: fetchUrl, evm: extracted.evm, sol: extracted.sol };
              // Collect some recent tweet links from profile pages (always consider top 5)
              try {
                const u = new URL(fetchUrl);
                const isStatus = /\/status\//.test(u.pathname);
                if (!isStatus) {
                  const links = extractTweetLinks(raw, `${u.protocol}//${u.host}`);
                  tweetLinks = links.slice(0, 5);
                }
              } catch {}
              // Accept only if the response looks like a real Nitter/X page
              const usable = looksLikeNitterHtml(raw) || (extracted.evm.length + extracted.sol.length) > 0 || tweetLinks.length > 0;
              if (usable) {
                gotPage = true; // use this instance only
                break; // stop retrying this candidate
              } else {
                // Placeholder/parked page with 200 OK; try next candidate or mirror
                lastErr = new Error('unusable mirror response');
              }
            } catch (e) {
              lastErr = e;
              if (i < attempts - 1) await new Promise(r => setTimeout(r, backoffMs));
            }
          }
          if (gotPage) break; // stop after first page load
        }
        if (gotPage) break; // don't try other mirrors
        if (lastErr) logger.warn(`Failed on mirror ${mirror}: ${lastErr.message}`);
      }
      extracted.evm.forEach(a => foundEvm.add(a));
      extracted.sol.forEach(a => foundSol.add(a));
      details.push(finalDetail);

      // Always scan top tweet pages (up to 5)
      for (const tUrl of tweetLinks) {
        try {
          const tr = await axios.get(tUrl, {
            timeout,
            maxRedirects: 5,
            headers: { 'user-agent': ua, 'accept': 'text/html,application/json;q=0.9,*/*;q=0.8', 'referer': finalDetail.url },
            validateStatus: (s) => s >= 200 && s < 400
          });
          const tRaw = typeof tr.data === 'string' ? tr.data : JSON.stringify(tr.data);
          const tBody = sanitizeHtmlToText(tRaw);
          const tx = extractAddressesFromText(tBody);
          tx.evm.forEach(a => foundEvm.add(a));
          tx.sol.forEach(a => foundSol.add(a));
          if ((tx.evm?.length || 0) + (tx.sol?.length || 0)) {
            details.push({ url: tUrl, evm: tx.evm, sol: tx.sol });
          }

          // One-level deep: follow external website links found in the tweet page
          const hrefs = extractHrefs(tRaw, tUrl)
            .filter(l => /^https?:\/\//i.test(l))
            .filter(l => !/nitter\.|x\.com|twitter\.com/i.test(l));
          const ext = [...new Set(hrefs)].slice(0, 10);
          for (const u of ext) {
            try {
              const er = await axios.get(u, {
                timeout,
                maxRedirects: 5,
                headers: { 'user-agent': ua, 'accept': 'text/html,application/json;q=0.9,*/*;q=0.8', 'referer': tUrl },
                validateStatus: (s) => s >= 200 && s < 400
              });
              const eBody = sanitizeHtmlToText(typeof er.data === 'string' ? er.data : JSON.stringify(er.data));
              const ex = extractAddressesFromText(eBody);
              ex.evm.forEach(a => foundEvm.add(a));
              ex.sol.forEach(a => foundSol.add(a));
              if ((ex.evm?.length || 0) + (ex.sol?.length || 0)) {
                details.push({ url: u, evm: ex.evm, sol: ex.sol });
              }
            } catch {}
          }

        } catch (e) {
          logger.warn(`Failed to fetch tweet page ${tUrl}: ${e.message}`);
        }
      }

    } catch (e) {
      logger.warn(`Failed to fetch ${src}: ${e.message}`);
    }
  }

  return { evmAddresses: [...foundEvm], solanaAddresses: [...foundSol], details };
}

function mapToNitterCandidates(u, base) {
  const out = [];
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith('x.com') || host.endsWith('twitter.com')) {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const user = parts[0];
      if (/\/status\//.test(parsed.pathname)) {
        const status = parts[2];
        if (base && user && status) out.push(`${base}/${user}/status/${status}`);
      } else if (user && /^[A-Za-z0-9_]{1,15}$/.test(user)) {
        if (base) {
          out.push(`${base}/${user}`);
        }
      }
    }
  } catch {}
  if (out.length === 0 && base) out.push(u);
  return out;
}

function sanitizeHtmlToText(htmlLike) {
  try {
    const decoded = he.decode(String(htmlLike));
    // Remove tags, keep text content; collapse whitespace
    const noTags = decoded.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
      .replace(/[\u2010-\u2015\u2212]/g, '-') // various dashes
      .replace(/\s+/g, ' ');
    return noTags;
  } catch {
    return String(htmlLike || '');
  }
}

function extractTweetLinks(html, origin) {
  const out = [];
  const re = /href=["']([^"']*\/status\/\d+)["']/gi;
  let m;
  const seen = new Set();
  while ((m = re.exec(html)) !== null) {
    const rel = m[1];
    if (rel && !seen.has(rel)) {
      seen.add(rel);
      try {
        const abs = new URL(rel, origin).toString();
        out.push(abs);
      } catch {}
    }
  }
  return out;
}

// no crawling helpers retained — we only scan the fetched page body
