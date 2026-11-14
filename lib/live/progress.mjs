// lib/live/progress.mjs - the live view's pass progress bar: where rise,
// peak, set and now sit along one line.

const PEAK_EDGE = 0.05;
const PEAK_LABEL_MIN = 0.22;
const PEAK_LABEL_MAX = 0.78;

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** The bar's left end. A pass found while already up starts at the search
 *  time, so its real rise is `riseMs` when known; without it the bar starts
 *  at "Up" with no time. `firstMs` is the first sampled moment of the pass. */
export function barStart(pass, firstMs) {
  if (!pass?.inProgress) return { label: 'Rise', ms: firstMs };
  if (Number.isFinite(pass.riseMs)) return { label: 'Rise', ms: pass.riseMs };
  return { label: 'Up', ms: null };
}

/** Positions along the bar, 0 (left) to 1 (right): now (clamped to the
 *  ends), the peak, and where the peak's label goes (pulled in from the ends
 *  so it does not run into the Rise and Set labels; null when the peak is at
 *  an end, where its label would repeat one of them). */
export function barPositions({ startMs, peakMs, endMs, nowMs }) {
  const span = endMs - startMs;
  const at = (t) => (span > 0 ? clamp01((t - startMs) / span) : 0);
  const nowFrac = at(nowMs);
  const peakFrac = Number.isFinite(peakMs) ? at(peakMs) : null;
  const peakLabelFrac = peakFrac == null || peakFrac <= PEAK_EDGE || peakFrac >= 1 - PEAK_EDGE
    ? null
    : Math.min(PEAK_LABEL_MAX, Math.max(PEAK_LABEL_MIN, peakFrac));
  return { nowFrac, peakFrac, peakLabelFrac };
}
