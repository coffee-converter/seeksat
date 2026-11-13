// lib/map/pass-arc.mjs - A pass's whole arc over the observer, for the map.
// A visual pass is only the part you can see (sunlit, in a dark sky), so its
// times can start or stop mid-sky. The map draws the whole arc, rise to set
// above the lowest pass setting, and pauses where it comes closest.
import { satAltitudeDeg, satIlluminated } from '../pass-finder/visibility.js';
import { sunPositionEcef } from '../pass-finder/sun.js';
import { apparentAltDeg } from '../refraction.js';

const STEP_MS = 10_000;
/** How far past the pass's own times to look for the rise and set. */
const REACH_MS = 45 * 60_000;
/** Passes longer than this (high orbits) are drawn as they are. */
const LONG_MS = 3 * 3600_000;

/**
 * { riseMs, setMs, closestMs } for a pass: rise and set where the elevation
 * crosses minElevDeg (to a second, at most REACH_MS past the pass's times),
 * and the moment of highest elevation between them (the closest approach).
 * ecefAt(date) gives the satellite's ECEF position, or null.
 */
export function passArc(ecefAt, observer, pass, minElevDeg = 0) {
  // Apparent (refracted) elevation, as the pass search counts it, so the
  // rise and set match the rows' times.
  const el = (ms) => {
    const e = ecefAt(new Date(ms));
    return e ? apparentAltDeg(satAltitudeDeg(observer, e)) : -90;
  };
  const above = (ms) => el(ms) >= minElevDeg;
  if (pass.endMs - pass.startMs > LONG_MS) {
    return { riseMs: pass.startMs, setMs: pass.endMs, closestMs: pass.peakMs };
  }
  // Walk out in steps while still above, then narrow the crossing to a second.
  const edge = (fromMs, dir) => {
    let inMs = fromMs;
    const limit = fromMs + dir * REACH_MS;
    while (dir * (limit - inMs) >= STEP_MS && above(inMs + dir * STEP_MS)) inMs += dir * STEP_MS;
    let outMs = inMs + dir * STEP_MS;
    if (dir * (outMs - limit) > 0) return inMs;
    while (Math.abs(outMs - inMs) > 1000) {
      const mid = Math.round((inMs + outMs) / 2);
      if (above(mid)) inMs = mid;
      else outMs = mid;
    }
    return inMs;
  };
  const riseMs = Math.min(pass.startMs, edge(pass.startMs, -1));
  const setMs = Math.max(pass.endMs, edge(pass.endMs, 1));
  // Highest point: a coarse scan, then a fine one around the best step.
  let bestMs = pass.peakMs;
  let best = el(bestMs);
  for (let t = riseMs; t <= setMs; t += 5000) {
    const e = el(t);
    if (e > best) { best = e; bestMs = t; }
  }
  for (let t = Math.max(riseMs, bestMs - 5000); t <= Math.min(setMs, bestMs + 5000); t += 500) {
    const e = el(t);
    if (e > best) { best = e; bestMs = t; }
  }
  return { riseMs, setMs, closestMs: bestMs };
}

/**
 * A pass line (geometry.mjs passLine, with times) split where the satellite
 * enters or leaves Earth's shadow: { sunlit, shadow } MultiLineStrings. A
 * change between two samples breaks the line at the later one, which both
 * pieces share, so no gap shows.
 */
export function splitBySun(line, ecefAt) {
  const sunlit = [];
  const shadow = [];
  line.coordinates.forEach((coords, li) => {
    const times = line.times?.[li] ?? [];
    let run = null;
    let runLit = null;
    coords.forEach((pt, i) => {
      const ms = times[i];
      const e = ms == null ? null : ecefAt(new Date(ms));
      const lit = e ? satIlluminated(e, sunPositionEcef(new Date(ms))) : (runLit ?? true);
      if (run && lit !== runLit) {
        run.push(pt);
        (runLit ? sunlit : shadow).push(run);
        run = [pt];
      } else if (!run) {
        run = [pt];
      } else {
        run.push(pt);
      }
      runLit = lit;
    });
    if (run && run.length >= 2) (runLit ? sunlit : shadow).push(run);
  });
  return {
    sunlit: { type: 'MultiLineString', coordinates: sunlit },
    shadow: { type: 'MultiLineString', coordinates: shadow },
  };
}

/** The geometric elevation that refraction lifts to `apparentDeg`: the
 *  visibility circle uses it, so its edge meets the rise and set points
 *  (about half a degree below the horizon for 0). */
export function geometricElevFor(apparentDeg) {
  let e = apparentDeg;
  for (let i = 0; i < 4; i++) e = apparentDeg - (apparentAltDeg(e) - e);
  return e;
}
