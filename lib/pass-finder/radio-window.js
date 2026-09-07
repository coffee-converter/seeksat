// lib/pass-finder/radio-window.js - which slice of time the radio chart and
// CSV cover.
//
// This is one decision, and it is load-bearing enough to live on its own
// where it can be tested: the scene that used to make it inline is not unit
// testable, so the rule was verified only by reading.
//
// The rule: chart the FULL geometric pass, horizon to horizon, and report
// the minimum-elevation threshold rather than applying it.
//
// minElevDeg is a search filter - "which passes are worth listing". The
// chart's numbers are measurements meant to be checked against a real
// capture, and a capture knows nothing about that filter. Gating the chart
// on it let a UI control silently change a physical quantity: the largest
// range rate is at the horizon, so a 10 deg cutoff sees only ~92% of the
// true maximum where 0 deg sees ~98%, and the reported Doppler swing came
// out several percent low with nothing to say so.

import { passWindowAtMsForObserver } from "./observer-pass.js";

/** Both windows the chart needs.
 *
 *  `full` is the pass from horizon to horizon and bounds everything drawn or
 *  exported. `workable` is the part above `minElevDeg`, drawn as a band so
 *  the practical window stays visible without bounding the physics; it is
 *  null when the threshold is 0 (nothing to mark) or when the walk fails.
 *
 *  Returns null when the observer cannot see the satellite at `anchorMs` at
 *  all, matching passWindowAtMsForObserver's own contract. */
export function radioChartWindows(obs, anchorMs, mode, minElevDeg, issEcefAtFn) {
  const full = passWindowAtMsForObserver(obs, anchorMs, mode, 0, issEcefAtFn);
  if (!full) return null;
  const workable = minElevDeg > 0
    ? passWindowAtMsForObserver(obs, anchorMs, mode, minElevDeg, issEcefAtFn)
    : null;
  return { full, workable };
}
