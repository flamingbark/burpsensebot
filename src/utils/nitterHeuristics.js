export function looksLikeNitterHtml(html) {
  try {
    const s = String(html || '').toLowerCase();
    // Heuristics indicating a genuine Nitter/Twitter page rather than a parked placeholder
    if (s.includes('name="generator" content="nitter"')) return true;
    if (s.includes('class="profile-card"')) return true;
    if (s.includes('class="timeline"')) return true;
    if (s.includes('class="tweet"') || s.includes('/status/')) return true;
    // Common indicators of parked/anti-bot pages
    if (s.includes('window.park') || s.includes('data-adblockkey')) return false;
    // Very short HTML is rarely useful
    if (s.length < 2000) return false;
    return true;
  } catch {
    return false;
  }
}

