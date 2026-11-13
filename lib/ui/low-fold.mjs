// lib/ui/low-fold.mjs - a day's very low passes fold into one line at the
// end of the day, on the home list and the satellite page.
import { underWay } from '../passes/under-way.mjs';

/** Passes whose peak is under this many degrees fold away. */
export const LOW_FOLD_DEG = 5;

/**
 * Split a day's rows (each `{ pass }`) into those shown and those folded.
 * Order is kept within each side. A pass under way is never folded.
 * @template {{ pass: { maxElevDeg: number, startMs: number, endMs: number } }} R
 * @param {R[]} rows
 * @param {number} nowMs
 * @param {number} [thresholdDeg]
 * @returns {{ shown: R[], folded: R[] }}
 */
export function splitLowRows(rows, nowMs, thresholdDeg = LOW_FOLD_DEG) {
  const shown = [];
  const folded = [];
  for (const row of rows) {
    const low = row.pass.maxElevDeg < thresholdDeg && !underWay(row.pass, nowMs);
    (low ? folded : shown).push(row);
  }
  return { shown, folded };
}

/** "3 low passes (under 5°)", or "1 low pass (under 5°)". */
export function lowFoldLabel(count, thresholdDeg = LOW_FOLD_DEG) {
  return `${count} low ${count === 1 ? 'pass' : 'passes'} (under ${thresholdDeg}°)`;
}
