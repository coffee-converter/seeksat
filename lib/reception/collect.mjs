// lib/reception/collect.mjs - the reception collector, run by the cron
// (app/api/refresh-reception). Each unit of work is one WINDOW_HOURS window
// of one status (good or bad observations) from SatNOGS Network, newest
// first, over the last BACKFILL_DAYS settled days: small enough (about 20
// pages) to finish well inside a run. A run does units until RUN_BUDGET_MS is
// spent, and starts none with less than MIN_UNIT_BUDGET_MS left. A unit
// counts only once its sweep finished (or stopped at the page cap); a failed
// one is dropped whole and retried on the next run, so nothing is ever
// counted twice.
import { emptyTally, addObservations, pruneTally } from './tally.mjs';

/** Days of history the collector fills in (a first run starts here). */
export const BACKFILL_DAYS = 7;
/** Time a run may spend sweeping, under the route's 300 s limit. */
export const RUN_BUDGET_MS = 200_000;
/** A unit is not started with less than this left of the budget. */
export const MIN_UNIT_BUDGET_MS = 45_000;
/** A window is swept this long after it ends, once SatNOGS has rated
 *  (vetted) most of its observations good or bad. */
export const SETTLE_MS = 12 * 3_600_000;
/** Hours in one unit's window; divides a day. */
export const WINDOW_HOURS = 6;
/** Observations last minutes (rarely near an hour), so a window is asked
 *  for this far past its end. */
export const OVERHANG_MS = 3_600_000;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_MS = WINDOW_HOURS * HOUR_MS;
const STATUSES = ['good', 'bad'];
const isoZ = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

/** Units not swept yet: every WINDOW_HOURS window of the last BACKFILL_DAYS
 *  days that has settled, newest first, good before bad. A unit's key
 *  is its start ('YYYY-MM-DDTHH') and status. */
export function pendingUnits(tally, nowMs) {
  // The latest window to have ended SETTLE_MS ago, back BACKFILL_DAYS.
  const lastEnd = Math.floor((nowMs - SETTLE_MS) / WINDOW_MS) * WINDOW_MS;
  const firstStart = lastEnd - BACKFILL_DAYS * DAY_MS;
  const out = [];
  for (let start = lastEnd - WINDOW_MS; start >= firstStart; start -= WINDOW_MS) {
    const startIso = isoZ(start);
    for (const status of STATUSES) {
      const key = `${startIso.slice(0, 13)}:${status}`;
      if (!tally.swept?.[key]) out.push({ key, status, startIso, endIso: isoZ(start + WINDOW_MS) });
    }
  }
  return out;
}

/**
 * One collector run. `sweep` is lib/reception/satnogs-network.mjs
 * sweepObservations (injected for tests).
 * @returns {Promise<{ units: number, observations: number, truncated: number,
 *   failed: string|null, written: boolean }>}
 */
export async function collectReception({ store, sweep, now = Date.now, budgetMs = RUN_BUDGET_MS }) {
  const startMs = now();
  const deadlineMs = startMs + budgetMs;
  const tally = (await store.read()) ?? emptyTally();
  tally.swept ??= {};
  let units = 0, observations = 0, truncated = 0, failed = null;
  for (const { key, status, startIso, endIso } of pendingUnits(tally, startMs)) {
    if (deadlineMs - now() < MIN_UNIT_BUDGET_MS) break;
    // SatNOGS returns observations that start and end inside the asked span,
    // so ask to OVERHANG_MS past the window: each one then counts once, in
    // the window where it starts.
    const r = await sweep({ status, startIso, endIso: isoZ(Date.parse(endIso) + OVERHANG_MS), deadlineMs });
    if (!r.complete && !r.truncated) {
      failed = `${key}: ${r.error ?? 'unfinished'}`;
      // Throttled, failing or out of time: stop. Bad data on this window
      // only: skip it (it is tried again next run) and go on.
      if (r.stopRun === false) continue;
      break;
    }
    addObservations(tally, r.observations, status);
    tally.swept[key] = { pages: r.pages, count: r.observations.length, truncated: Boolean(r.truncated) };
    units++;
    observations += r.observations.length;
    if (r.truncated) truncated++;
  }
  if (!units) return { units, observations, truncated, failed, written: false };
  pruneTally(tally, now());
  await store.write(tally);
  return { units, observations, truncated, failed, written: true };
}

/** One log line for a run: what it swept, whether it saved, where it stopped. */
export function runSummary({ units, observations, truncated, failed, written }) {
  const cut = truncated ? ` (${truncated} cut short)` : '';
  const stop = failed ? `; stopped at ${failed}` : '';
  return `refresh-reception: ${units} windows${cut}, ${observations} observations, ${written ? 'saved' : 'not saved'}${stop}`;
}
