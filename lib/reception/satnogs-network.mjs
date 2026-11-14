// lib/reception/satnogs-network.mjs - one day (or any window) of SatNOGS
// Network observations, fetched politely: an identifying User-Agent, a pause
// between pages, backoff on 429 and 5xx, a page cap and a deadline. Server
// only. Data CC BY-SA 4.0 (https://network.satnogs.org).
import { SATNOGS_USER_AGENT } from '../mirror/satnogs.mjs';

export const SATNOGS_NETWORK_OBSERVATIONS_URL = 'https://network.satnogs.org/api/observations/';
/** Pages per sweep at most (25 observations a page): a 6-hour window is
 *  about 20, and 80 at PAGE_GAP_MS apart still fits inside a collector run. */
export const MAX_PAGES = 80;
/** Pause between pages. At 250 ms SatNOGS throttled the first run after
 *  about two minutes; a page every 1.5 s or so stays well under that. */
export const PAGE_GAP_MS = 1500;
/** Waits before each retry of a 429 or 5xx, when no Retry-After is given. */
const RETRY_WAITS_MS = [2000, 4000, 8000];
const REQUEST_TIMEOUT_MS = 30_000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One raw observation as the tally keeps it, or null when it lacks a
 *  transmitter, a satellite or an end time. */
export function slimObservation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const uuid = typeof raw.transmitter_uuid === 'string' ? raw.transmitter_uuid.trim() : '';
  const noradId = raw.norad_cat_id;
  const endMs = Date.parse(raw.end);
  if (!uuid || !Number.isInteger(noradId) || noradId <= 0 || !Number.isFinite(endMs)) return null;
  const low = Number(raw.transmitter_downlink_low);
  const high = Number(raw.transmitter_downlink_high);
  const lowHz = Number.isFinite(low) && low > 0 ? low : null;
  return { uuid, noradId, endMs, lowHz, highHz: Number.isFinite(high) && high > 0 ? high : lowHz };
}

/** The rel="next" URL of a Link header, or null. */
function nextLink(header) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (m) return m[1];
  }
  return null;
}

const BASE = new URL(SATNOGS_NETWORK_OBSERVATIONS_URL);

/** A next link we will follow: https, on SatNOGS Network, under the
 *  observations API. Anything else (a redirect elsewhere) is not fetched. */
function safeNext(link) {
  try {
    const u = new URL(link, BASE);
    return u.protocol === 'https:' && u.origin === BASE.origin && u.pathname.startsWith(BASE.pathname) ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Every observation with `status` (good or bad) in [startIso, endIso],
 * following the API's cursor pages. Never throws: a failure stops the sweep
 * with `error` set and `complete` false, so the caller can drop it and try
 * again later.
 * @returns {Promise<{ observations: Array<ReturnType<typeof slimObservation>>,
 *   pages: number, complete: boolean, truncated: boolean, error?: string, stopRun?: boolean }>}
 */
export async function sweepObservations({
  status, startIso, endIso, fetchImpl = globalThis.fetch, sleep = defaultSleep,
  deadlineMs = Infinity, now = Date.now, maxPages = MAX_PAGES, requestTimeoutMs = REQUEST_TIMEOUT_MS,
  token = null,
}) {
  // A SatNOGS API token (a free account's) raises the observation quota from
  // 60 to 240 requests an hour, and gives us a quota of our own.
  const headers = { 'User-Agent': SATNOGS_USER_AGENT, Accept: 'application/json', ...(token && { Authorization: `Token ${token}` }) };
  const params = new URLSearchParams({ format: 'json', status, start: startIso, end: endIso });
  let url = `${SATNOGS_NETWORK_OBSERVATIONS_URL}?${params}`;
  const observations = [];
  let pages = 0;
  // stopRun: SatNOGS is throttling, failing or unreachable (or time is up),
  // so the collector should stop for this run; false for bad data on one
  // window, which the collector skips and tries again next run.
  const fail = (error, stopRun = true) => ({ observations, pages, complete: false, truncated: false, error, stopRun });
  for (;;) {
    if (pages >= maxPages) return { observations, pages, complete: false, truncated: true };
    if (pages > 0) await sleep(PAGE_GAP_MS);
    let res = null;
    let body;
    for (let attempt = 0; ; attempt++) {
      if (now() > deadlineMs) return fail('passed the deadline');
      // One timer covers the headers and the body: a body that stalls
      // after the headers arrive would otherwise hang until the platform
      // kills the run.
      const ac = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`timed out after ${requestTimeoutMs} ms`);
          ac.abort(err);
          reject(err);
        }, requestTimeoutMs);
      });
      try {
        res = await Promise.race([fetchImpl(url, {
          signal: ac.signal,
          headers,
        }), timeout]);
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable) {
          if (!res.ok) return fail(`SatNOGS Network: HTTP ${res.status}`, false);
          try { body = await Promise.race([res.json(), timeout]); } catch (err) {
            if (/timed out/.test(err?.message ?? '')) throw err;
            return fail('SatNOGS Network: not JSON', false);
          }
          break;
        }
      } catch (err) {
        return fail(`SatNOGS Network: ${err?.message ?? err}`);
      } finally {
        clearTimeout(timer);
      }
      // The throttled answer's body is not wanted: free its connection.
      try { await res.body?.cancel(); } catch { /* already gone */ }
      if (attempt >= RETRY_WAITS_MS.length) return fail(`SatNOGS Network: HTTP ${res.status}`);
      const after = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(after) && after > 0 ? after * 1000 : RETRY_WAITS_MS[attempt];
      // A wait that would end past the deadline: stop now rather than be
      // cut off mid-sleep with the run's work unsaved.
      if (now() + waitMs > deadlineMs) {
        return fail(`SatNOGS Network: HTTP ${res.status}, asked to wait ${Math.round(waitMs / 1000)} s, past the deadline`);
      }
      await sleep(waitMs);
    }
    if (!Array.isArray(body)) return fail('SatNOGS Network: not a list', false);
    pages++;
    for (const raw of body) {
      const o = slimObservation(raw);
      if (o) observations.push(o);
    }
    const next = nextLink(res.headers.get('link'));
    if (next == null) break;
    url = safeNext(next);
    if (!url) return fail('SatNOGS Network: next link is not an observations page', false);
  }
  return { observations, pages, complete: true, truncated: false };
}
