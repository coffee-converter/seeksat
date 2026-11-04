// lib/pass-finder/observer-pass.js - mode-aware "can this observer
// see / hear the satellite right now?" predicate + a backward/forward walk
// from a given moment that returns the full sighting window for that
// observer.
//
// Pure given (obs, satEcef, jsDate) and the mode/minElev settings.
// `ecefAt` is a callback so this module stays satrec-free; the
// scene threads its own sampler in. The per-observer pass cache
// itself stays in the scene because it's per-session UI state, not
// pure computation.

import { isVisibleAtAll, isRadioReachable } from "./visibility.js";

const PASS_EDGE_STEP_MS = 1000;
// Real satellite passes top out around 10 min for an overhead pass, so a
// 15 min cap on each side is plenty of slack while still bounding
// the walk for the degenerate "permanently visible" cases (which
// shouldn't ever occur for the satellite but make a safe sentinel).
const PASS_EDGE_MAX_MS = 15 * 60 * 1000;

// Mode-aware "can this observer see/hear the satellite at this instant?"
// Visual: satellite sunlit + observer in twilight + apparent alt ≥ minElevDeg.
// Radio:  apparent alt ≥ minElevDeg, no sun/illumination gate.
export function observerSeesSat(obs, satEcef, jsDate, mode, minElevDeg) {
  if (mode === "radio") {
    return isRadioReachable([obs], satEcef, jsDate, { minSatAltDeg: minElevDeg });
  }
  return isVisibleAtAll([obs], satEcef, jsDate, { minSatAltDeg: minElevDeg });
}

// Walk backward/forward from `anchorMs` in 1-second steps until the
// observer no longer sees the satellite (apparent alt < minElev + mode
// gates). Returns null when the observer can't see the satellite at the
// anchor moment. Caps the walk at PASS_EDGE_MAX_MS on each side.
//
// Returns `{ startMs, endMs, clamped }`. `clamped` is true when a walk ran
// out of budget while the satellite was still in view, i.e. the edge is the
// cap rather than a real rise or set.
//
// The flag matters because callers state things about the window that stop
// being true when it is truncated: the radio chart labels its Doppler swing
// "horizon-to-horizon" and the CSV reports aos/los/duration from these
// bounds. Without it a clamped window is indistinguishable from a real
// pass, so those become confident and wrong - the same silent-understatement
// failure the chart's own window rule exists to remove.
export function passWindowAtMsForObserver(obs, anchorMs, mode, minElevDeg, ecefAtFn, opts = {}) {
  const maxEdgeMs = opts.maxEdgeMs ?? PASS_EDGE_MAX_MS;
  const stepMs = opts.coarseStepMs ?? PASS_EDGE_STEP_MS;
  const anchorD = new Date(anchorMs);
  const anchorEcef = ecefAtFn(anchorD);
  if (!anchorEcef || !observerSeesSat(obs, anchorEcef, anchorD, mode, minElevDeg)) {
    return null;
  }
  const inView = (t) => {
    const d = new Date(t);
    const e = ecefAtFn(d);
    return !!e && observerSeesSat(obs, e, d, mode, minElevDeg);
  };
  // Walk one side in `dir` (-1 back, +1 forward). On the first out-of-view
  // sample, bisect between it and the last in-view sample down to
  // PASS_EDGE_STEP_MS and return the last in-view time.
  const walk = (dir) => {
    let last = anchorMs;
    for (let off = stepMs; off <= maxEdgeMs; off += stepMs) {
      const t = anchorMs + dir * off;
      if (!inView(t)) {
        let lo = last, hi = t;
        while (Math.abs(hi - lo) > PASS_EDGE_STEP_MS) {
          const mid = Math.floor((lo + hi) / 2);
          if (inView(mid)) lo = mid; else hi = mid;
        }
        return { ms: lo, clamped: false };
      }
      last = t;
    }
    // Still in view with no budget left for another step: this edge is the
    // cap, not a set.
    return { ms: last, clamped: true };
  };
  const back = walk(-1);
  const fwd = walk(1);
  return { startMs: back.ms, endMs: fwd.ms, clamped: back.clamped || fwd.clamped };
}

// Walk budget per orbit class. LEO passes last minutes, so the fine 1 s walk
// with a 15 min cap is exact. Anything else (Molniya, GEO) can stay in view
// for hours, so walk up to one period in coarse steps and bisect the edge.
export function walkOptsForOrbit(orbitClass, periodMs) {
  if (orbitClass === "leo") return { maxEdgeMs: PASS_EDGE_MAX_MS, coarseStepMs: PASS_EDGE_STEP_MS };
  return { maxEdgeMs: periodMs, coarseStepMs: 30_000 };
}
