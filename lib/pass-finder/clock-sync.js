// pass-finder/clock-sync.js -- estimate the user's clock skew from
// HTTP `Date` response headers so a wrong-by-minutes browser clock
// doesn't silently produce useless pass forecasts.
//
// Strategy: every TLE response we already fetch carries a server-set
// `Date:` header (mandated by RFC 9110 §6.6.1; ~all production HTTP
// stacks emit one). Treating that timestamp as ground truth at the
// instant the response left the server, we compute
//   offset = serverMs - clientMs
// and stash it module-locally. `trueNow()` returns
// `Date.now() + offset`, which any code path that wants
// human-meaningful UTC can use instead of `new Date()`.
//
// The offset will always include the network round-trip latency
// (server `Date` is "when sent," client `Date.now()` is "when
// received"), so trueNow() is biased a few hundred ms in the past
// of actual server time. That's fine for our use case: we're
// catching clock-set-wrong-by-MINUTES users, not aligning sub-second.

let offsetMs = 0;
let lastSampleAt = 0;

/** Pull the Date header off a fetch Response and update the offset.
 *  Safe to call on every response; only adjusts when the header is
 *  present and parses to a valid date. */
export function syncFromResponse(response) {
  try {
    const dateStr = response?.headers?.get?.("date") || response?.headers?.get?.("Date");
    if (!dateStr) return;
    const serverMs = Date.parse(dateStr);
    if (!Number.isFinite(serverMs)) return;
    const clientMs = Date.now();
    offsetMs = serverMs - clientMs;
    lastSampleAt = clientMs;
  } catch (_) {
    // Headers API can throw in some edge cases; ignore - we just
    // continue using whatever offset we had (0 by default = trust
    // the client clock).
  }
}

/** Current best-estimate UTC, in ms since the Unix epoch. Falls
 *  through to Date.now() until the first server-Date sample lands. */
export function trueNow() {
  return Date.now() + offsetMs;
}

/** Offset in ms (server time MINUS client time). Positive → client
 *  clock is running slow; negative → client clock is running fast.
 *  Used by the UI to surface a "your clock looks off by N minutes"
 *  warning when the magnitude exceeds a threshold. */
export function getClockSkewMs() {
  return offsetMs;
}

/** Has any server-Date sample been seen since the page loaded? */
export function hasClockSyncSample() {
  return lastSampleAt > 0;
}
