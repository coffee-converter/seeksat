// lib/reception/collect.mjs - the reception collector, run by the cron
// (app/api/refresh-reception). Each unit of work is one UTC day of one
// status (good or bad observations) from SatNOGS Network, newest first, over
// the last BACKFILL_DAYS settled days. A run does units until RUN_BUDGET_MS
// is spent. A unit counts only once its sweep finished (or stopped at the
// page cap); a failed one is dropped whole and retried on the next run, so
// nothing is ever counted twice.
import { emptyTally, addObservations, pruneTally } from './tally.mjs';

/** Days of history the collector fills in (a first run starts here). */
export const BACKFILL_DAYS = 7;
/** Time a run may spend sweeping, under the route's 300 s limit. */
export const RUN_BUDGET_MS = 200_000;
/** A day is swept this long after it ends, once SatNOGS has rated (vetted)
 *  most of its observations good or bad. */
export const SETTLE_MS = 12 * 3_600_000;

const DAY_MS = 86_400_000;
const STATUSES = ['good', 'bad'];
const dayIso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Units not swept yet: the last BACKFILL_DAYS UTC days that have settled,
 *  newest first, good before bad. */
export function pendingUnits(tally, nowMs) {
  const lastDayStart = Math.floor((nowMs - SETTLE_MS) / DAY_MS) * DAY_MS - DAY_MS;
  const out = [];
  for (let i = 0; i < BACKFILL_DAYS; i++) {
    const day = dayIso(lastDayStart - i * DAY_MS);
    for (const status of STATUSES) if (!tally.swept?.[`${day}:${status}`]) out.push({ day, status });
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
  for (const { day, status } of pendingUnits(tally, startMs)) {
    if (now() > deadlineMs) break;
    const dayStart = Date.parse(`${day}T00:00:00Z`);
    const r = await sweep({
      status,
      startIso: `${day}T00:00:00Z`,
      endIso: new Date(dayStart + DAY_MS).toISOString().replace('.000Z', 'Z'),
      deadlineMs,
    });
    if (!r.complete && !r.truncated) {
      failed = `${day}:${status}: ${r.error ?? 'unfinished'}`;
      break;
    }
    addObservations(tally, r.observations, status);
    tally.swept[`${day}:${status}`] = { pages: r.pages, count: r.observations.length, truncated: Boolean(r.truncated) };
    units++;
    observations += r.observations.length;
    if (r.truncated) truncated++;
  }
  if (!units) return { units, observations, truncated, failed, written: false };
  pruneTally(tally, now());
  await store.write(tally);
  return { units, observations, truncated, failed, written: true };
}
