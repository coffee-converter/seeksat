// lib/mcp/freshness.mjs - how much to trust a prediction from one element
// set: the gap between its epoch and the time asked about, graded as the app
// grades element age (lib/sat/numbers.mjs: fresh, old after 7 days, stale
// after 14). Whole-sky tools leave out stale objects, and a time too far
// from the epoch is refused rather than answered with nonsense.

import { elementAge, STALE_AFTER_DAYS } from '../sat/numbers.mjs';

const DAY_MS = 86_400_000;
/** A time asked about further than this from the epoch is refused. */
export const MAX_EPOCH_GAP_DAYS = 30;

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * The element age at `atMs` (either side of the epoch) as { level, ageDays }
 * plus a short warning when it is old or stale. `asked`: atMs is a time the
 * caller asked about rather than now, which changes the wording.
 */
export function elementAgeAt(epochMs, atMs, { asked = false } = {}) {
  if (!Number.isFinite(epochMs)) {
    return { level: 'stale', ageDays: null, warning: 'The age of these elements is unknown, so positions and times may be well off.' };
  }
  const { level, ageDays } = elementAge(epochMs, epochMs + Math.abs(atMs - epochMs));
  if (level === 'fresh') return { level, ageDays };
  const gap = asked
    ? `The time asked about is ${ageDays} days from the elements' epoch (${day(epochMs)})`
    : `The elements are ${ageDays} days old`;
  const effect = level === 'stale'
    ? 'so positions and times may be well off (stale).'
    : 'so times may be off by a minute or more.';
  return { level, ageDays, warning: `${gap}, ${effect}` };
}

/** True when elements this far from `atMs` are past the app's stale line
 *  (or have no epoch), so a whole-sky tool should leave the object out. */
export function staleAt(epochMs, atMs) {
  return !Number.isFinite(epochMs) || Math.abs(atMs - epochMs) > STALE_AFTER_DAYS * DAY_MS;
}

/** Throws a clear error when a time asked about is too far from the epoch
 *  for a prediction to mean anything. */
export function assertNearEpoch(epochMs, atMs, name = 'time') {
  if (!Number.isFinite(epochMs)) return;
  const days = Math.abs(atMs - epochMs) / DAY_MS;
  if (days <= MAX_EPOCH_GAP_DAYS) return;
  throw new Error(`${name} ${new Date(atMs).toISOString()} is ${Math.round(days)} days from the orbital elements' epoch (${day(epochMs)}). Predictions that far from the epoch are not meaningful; ask about a time within ${MAX_EPOCH_GAP_DAYS} days of it.`);
}
