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
// range rate is at the horizon, so a gated window stops short of it and the
// reported swing came out low with nothing to say so. The margin is ~1.5%
// for a zenith pass - see test/radio-window.test.mjs, which pins it. (The
// commonly quoted 92%/98% figures are fractions of the RELATIVE SPEED, not
// of each other. Peak |rdot| is 93.6% of orbital speed over the full window
// and 92.2% over a 10 deg one, so 92.2/93.6 = 98.5% - the ~1.5%.)

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
export function radioChartWindows(obs, anchorMs, minElevDeg, issEcefAtFn) {
  // Always the radio predicate, never the caller's current mode. In visual
  // mode observerSeesIss also gates on sunlit + twilight, so a 0 deg walk
  // would return the LIT window - the chart truncated by an illumination
  // condition, which is the same class of bug this module exists to fix.
  const mode = "radio";
  const full = passWindowAtMsForObserver(obs, anchorMs, mode, 0, issEcefAtFn);
  if (!full) return null;
  const workable = minElevDeg > 0
    ? passWindowAtMsForObserver(obs, anchorMs, mode, minElevDeg, issEcefAtFn)
    : null;
  return { full, workable };
}
