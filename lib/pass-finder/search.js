// pass-finder/search.js -- find windows in [startMs, endMs] where a
// boolean predicate(ms) holds. Walks at `stepMs` then refines each edge
// via bisection to ~1-second precision.

export function findWindowsFromPredicate(predicate, startMs, endMs, stepMs = 60_000) {
  const windows = [];
  let inWindow = predicate(startMs);
  let windowStart = inWindow ? startMs : null;

  for (let t = startMs + stepMs; t <= endMs; t += stepMs) {
    const v = predicate(t);
    if (v && !inWindow) {
      // ON transition between (t - stepMs) and t -> refine.
      const onAt = bisect(predicate, t - stepMs, t, false);
      windowStart = onAt;
      inWindow = true;
    } else if (!v && inWindow) {
      const offAt = bisect(predicate, t - stepMs, t, true);
      windows.push({ startMs: windowStart, endMs: offAt });
      inWindow = false;
      windowStart = null;
    }
  }
  if (inWindow) windows.push({ startMs: windowStart, endMs });
  return windows;
}

// Bisect to find the transition point between t0 and t1.
// `wasTrue` is the predicate value at t0 - we look for the first ms where it flips.
function bisect(predicate, t0, t1, wasTrue) {
  let lo = t0, hi = t1;
  while (hi - lo > 500) { // ~0.5 second precision
    const mid = Math.floor((lo + hi) / 2);
    const v = predicate(mid);
    if (v === wasTrue) lo = mid; else hi = mid;
  }
  // hi is now the first sample where the value has flipped
  return hi;
}

// Convenience: walk windows using the full predicate (observers, issEcef, date).
// This wires SGP4 + visibility together.
export function findVisibilityWindows(observers, satrec, isVisibleAtAll, satellite, startMs, endMs, stepMs = 60_000) {
  function pred(ms) {
    const d = new Date(ms);
    const pv = satellite.propagate(satrec, d);
    if (!pv || !pv.position) return false;
    const gmst = satellite.gstime(d);
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const issEcef = [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000];
    return isVisibleAtAll(observers, issEcef, d);
  }
  return findWindowsFromPredicate(pred, startMs, endMs, stepMs);
}
