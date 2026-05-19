// lib/pass-finder/observer-pass.js — mode-aware "can this observer
// see / hear the ISS right now?" predicate + a backward/forward walk
// from a given moment that returns the full sighting window for that
// observer.
//
// Pure given (obs, issEcef, jsDate) and the mode/minElev settings.
// `issEcefAt` is a callback so this module stays satrec-free; the
// scene threads its own sampler in. The per-observer pass cache
// itself stays in the scene because it's per-session UI state, not
// pure computation.

import { isVisibleAtAll, isRadioReachable } from "./visibility.js";

const PASS_EDGE_STEP_MS = 1000;
// Real ISS passes top out around 10 min for an overhead pass, so a
// 15 min cap on each side is plenty of slack while still bounding
// the walk for the degenerate "permanently visible" cases (which
// shouldn't ever occur for the ISS but make a safe sentinel).
const PASS_EDGE_MAX_MS = 15 * 60 * 1000;

// Mode-aware "can this observer see/hear the ISS at this instant?"
// Visual: ISS sunlit + observer in twilight + apparent alt ≥ minElevDeg.
// Radio:  apparent alt ≥ minElevDeg, no sun/illumination gate.
export function observerSeesIss(obs, issEcef, jsDate, mode, minElevDeg) {
  if (mode === "radio") {
    return isRadioReachable([obs], issEcef, jsDate, { minIssAltDeg: minElevDeg });
  }
  return isVisibleAtAll([obs], issEcef, jsDate, { minIssAltDeg: minElevDeg });
}

// Walk backward/forward from `anchorMs` in 1-second steps until the
// observer no longer sees the ISS (apparent alt < minElev + mode
// gates). Returns null when the observer can't see the ISS at the
// anchor moment. Caps the walk at PASS_EDGE_MAX_MS on each side.
export function passWindowAtMsForObserver(obs, anchorMs, mode, minElevDeg, issEcefAtFn) {
  const anchorD = new Date(anchorMs);
  const anchorEcef = issEcefAtFn(anchorD);
  if (!anchorEcef || !observerSeesIss(obs, anchorEcef, anchorD, mode, minElevDeg)) {
    return null;
  }
  let startMs = anchorMs;
  let endMs = anchorMs;
  for (let t = anchorMs - PASS_EDGE_STEP_MS; t >= anchorMs - PASS_EDGE_MAX_MS; t -= PASS_EDGE_STEP_MS) {
    const d = new Date(t);
    const e = issEcefAtFn(d);
    if (!e || !observerSeesIss(obs, e, d, mode, minElevDeg)) break;
    startMs = t;
  }
  for (let t = anchorMs + PASS_EDGE_STEP_MS; t <= anchorMs + PASS_EDGE_MAX_MS; t += PASS_EDGE_STEP_MS) {
    const d = new Date(t);
    const e = issEcefAtFn(d);
    if (!e || !observerSeesIss(obs, e, d, mode, minElevDeg)) break;
    endMs = t;
  }
  return { startMs, endMs };
}
