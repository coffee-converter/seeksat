// lib/reception/tally.mjs - how often SatNOGS stations heard each transmitter.
//
// SatNOGS Network (https://network.satnogs.org, data CC BY-SA 4.0) records
// every observation its volunteer stations make, and whether the signal was
// there ("good") or not ("bad"). The collector (lib/reception/collect.mjs)
// adds a day's observations at a time; this keeps, per transmitter, the end
// time (whole minutes) of each one for the last KEEP_DAYS days, and reads
// back counts for a downlink. Pure, no I/O.
//
// Tally: { version: 1, tx: { [uuid]: { noradId, lowHz, highHz, good: number[],
//   bad: number[] } }, swept: { ['YYYY-MM-DD:good'|'...:bad']: { pages, count,
//   truncated } } }.
import { RECENCY } from './recency.mjs';

export { RECENCY };
/** Only failed observations, at least this many: probably silent. */
export const MIN_FAILED_FOR_SILENT = 3;
/** Days of observations kept. */
export const KEEP_DAYS = 30;
/** A downlink matches a transmitter within this much of its frequency span. */
export const FREQ_MATCH_HZ = 5_000;

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function emptyTally() {
  return { version: 1, tx: {}, swept: {} };
}

/** Observations ({ uuid, noradId, endMs, lowHz, highHz }) into the tally, as
 *  good or bad ones. Each counts once: two stations on one pass count twice. */
export function addObservations(tally, observations, status) {
  const key = status === 'bad' ? 'bad' : 'good';
  for (const o of observations ?? []) {
    if (!o?.uuid || !Number.isFinite(o.endMs)) continue;
    let t = tally.tx[o.uuid];
    if (!t) {
      t = { noradId: o.noradId, lowHz: o.lowHz ?? null, highHz: o.highHz ?? o.lowHz ?? null, good: [], bad: [] };
      tally.tx[o.uuid] = t;
    }
    t[key].push(Math.floor(o.endMs / MIN_MS));
  }
}

/** Drops times older than KEEP_DAYS, transmitters left with none, and the
 *  record of days swept before then. */
export function pruneTally(tally, nowMs) {
  const cutMin = Math.floor((nowMs - KEEP_DAYS * DAY_MS) / MIN_MS);
  for (const [uuid, t] of Object.entries(tally.tx)) {
    t.good = t.good.filter((m) => m >= cutMin);
    t.bad = t.bad.filter((m) => m >= cutMin);
    if (!t.good.length && !t.bad.length) delete tally.tx[uuid];
  }
  const cutDay = new Date(nowMs - KEEP_DAYS * DAY_MS).toISOString().slice(0, 10);
  for (const key of Object.keys(tally.swept)) if (key.slice(0, 10) < cutDay) delete tally.swept[key];
}

/** The tally with its transmitters listed per satellite, for receptionFor. */
export function indexTally(tally) {
  const byNorad = new Map();
  for (const [uuid, t] of Object.entries(tally?.tx ?? {})) {
    const list = byNorad.get(t.noradId) ?? [];
    list.push(uuid);
    byNorad.set(t.noradId, list);
  }
  return { tally, byNorad };
}

const UNKNOWN = Object.freeze({
  state: 'unknown', recency: RECENCY.UNKNOWN, heardLast48h: 0, heardLast7d: 0, heardLast30d: 0, failedLast30d: 0, lastHeard: null,
});

/** The transmitters a downlink is: its own uuid, plus every transmitter of
 *  that satellite whose span (within FREQ_MATCH_HZ) holds its frequency.
 *  SatNOGS often lists twins on one frequency, and the catalog keeps only
 *  one of their uuids, so a uuid alone could miss the twin that was heard. */
function matching(index, noradId, downlink) {
  const tx = index.tally.tx;
  const found = new Set();
  if (downlink?.uuid && tx[downlink.uuid]) found.add(downlink.uuid);
  const hz = downlink?.hz;
  if (Number.isFinite(hz)) {
    for (const u of index.byNorad.get(noradId) ?? []) {
      const t = tx[u];
      if (!Number.isFinite(t.lowHz)) continue;
      const high = Number.isFinite(t.highHz) && t.highHz > t.lowHz ? t.highHz : t.lowHz;
      if (hz >= t.lowHz - FREQ_MATCH_HZ && hz <= high + FREQ_MATCH_HZ) found.add(u);
    }
  }
  return [...found].map((u) => tx[u]);
}

/**
 * How recently SatNOGS stations heard a downlink, at nowMs: counts of good
 * observations in the last 48 hours, 7 and 30 days, failed ones in 30 days,
 * the last good one (ISO), and a state: heard (any good one), silent (none
 * good and at least MIN_FAILED_FOR_SILENT failed) or unknown (anything else,
 * including no match and no tally). `recency` ranks them (RECENCY).
 */
export function receptionFor(index, noradId, downlink, nowMs) {
  if (!index?.tally) return { ...UNKNOWN };
  const found = matching(index, noradId, downlink);
  if (!found.length) return { ...UNKNOWN };
  const nowMin = nowMs / MIN_MS;
  const since = (min, hours) => min >= nowMin - (hours * HOUR_MS) / MIN_MS && min <= nowMin;
  let h48 = 0, d7 = 0, d30 = 0, bad = 0, last = -Infinity;
  for (const t of found) {
    for (const m of t.good) {
      if (!since(m, 30 * 24)) continue;
      d30++;
      if (since(m, 7 * 24)) d7++;
      if (since(m, 48)) h48++;
      if (m > last) last = m;
    }
    for (const m of t.bad) if (since(m, 30 * 24)) bad++;
  }
  const counts = { heardLast48h: h48, heardLast7d: d7, heardLast30d: d30, failedLast30d: bad, lastHeard: d30 ? new Date(last * MIN_MS).toISOString() : null };
  if (d30) return { state: 'heard', recency: h48 ? RECENCY.H48 : d7 ? RECENCY.D7 : RECENCY.D30, ...counts };
  if (bad >= MIN_FAILED_FOR_SILENT) return { state: 'silent', recency: RECENCY.SILENT, ...counts };
  return { state: 'unknown', recency: RECENCY.UNKNOWN, ...counts };
}
