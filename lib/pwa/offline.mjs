// lib/pwa/offline.mjs - the offline banner's text (components/OfflineBanner.tsx).

/** "You're offline.", plus a note about saved satellites only when the page
 *  is showing them (the home's records came from the worker's cache). */
export function offlineText(fromCache) {
  return fromCache ? "You're offline. Showing the last saved satellites." : "You're offline.";
}

// A connection coming back (a router restarting) fires online and offline
// several times. The banner rides that out: it waits a moment before saying
// offline, and once up stays up until the connection has held for a few
// seconds, then says "Back online." briefly and goes.
export const OFFLINE_SHOW_MS = 2000;
export const ONLINE_STABLE_MS = 4000;
export const BACK_ONLINE_MS = 3000;

/** The banner's state at page load: offline at load shows at once. */
export function offlineStart(online, nowMs) {
  return { online, sinceMs: nowMs, shown: !online };
}

/** What the banner shows: 'offline', 'back' or 'hidden'. */
export function offlineView(s, nowMs) {
  const held = nowMs - s.sinceMs;
  if (!s.online) return s.shown || held >= OFFLINE_SHOW_MS ? 'offline' : 'hidden';
  if (!s.shown) return 'hidden';
  if (held < ONLINE_STABLE_MS) return 'offline';
  return held < ONLINE_STABLE_MS + BACK_ONLINE_MS ? 'back' : 'hidden';
}

/** The state after the browser reports online or offline at nowMs. */
export function offlineStep(s, online, nowMs) {
  if (online === s.online) return s;
  return { online, sinceMs: nowMs, shown: offlineView(s, nowMs) !== 'hidden' };
}

/** The next time offlineView can change on its own, or null. */
export function offlineNextMs(s, nowMs) {
  const at = !s.online
    ? (s.shown ? [] : [s.sinceMs + OFFLINE_SHOW_MS])
    : (s.shown ? [s.sinceMs + ONLINE_STABLE_MS, s.sinceMs + ONLINE_STABLE_MS + BACK_ONLINE_MS] : []);
  return at.find((t) => t > nowMs) ?? null;
}
