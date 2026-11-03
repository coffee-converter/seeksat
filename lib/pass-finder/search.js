// pass-finder/search.js -- find windows in [startMs, endMs] where a
// boolean predicate(ms) holds. Walks at `stepMs` then refines each edge
// via bisection and snaps it to the first whole second past the change, so
// the same pass gets the same edges whatever the search start (callers key
// reminders, calendar UIDs and rows on startMs).

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
// `wasTrue` is the predicate value at t0. Returns the first whole second
// (ms multiple of 1000) where the value has flipped: the bisection narrows
// the bracket, then whole seconds inside it are tested in order. The result
// depends only on the predicate, not on where t0 and t1 fall.
function bisect(predicate, t0, t1, wasTrue) {
  let lo = t0, hi = t1;
  while (hi - lo > 500) {
    const mid = Math.floor((lo + hi) / 2);
    const v = predicate(mid);
    if (v === wasTrue) lo = mid; else hi = mid;
  }
  // The change is in (lo, hi]. Every whole second up to lo still has the old
  // value, so the answer is the first whole second after lo that has flipped;
  // if none before hi has, it is the first whole second at or after hi.
  let s = Math.floor(lo / 1000) * 1000 + 1000;
  while (s < hi && predicate(s) === wasTrue) s += 1000;
  return s;
}

// Convenience: walk windows using the full predicate (observers, satEcef, date).
// This wires SGP4 + visibility together.
export function findVisibilityWindows(observers, satrec, isVisibleAtAll, satellite, startMs, endMs, stepMs = 60_000) {
  function pred(ms) {
    const d = new Date(ms);
    const pv = satellite.propagate(satrec, d);
    if (!pv || !pv.position) return false;
    const gmst = satellite.gstime(d);
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const satEcef = [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000];
    return isVisibleAtAll(observers, satEcef, d);
  }
  return findWindowsFromPredicate(pred, startMs, endMs, stepMs);
}
