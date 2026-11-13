// lib/mcp/visual-scan.mjs - "the best naked-eye pass of anything bright",
// for best_pass in visual mode with no satellite named. The same two stages
// as the radio scan (radio-scan.mjs):
//   1. the coarse sweep (radio-scan.mjs coarsePasses) per satellite for rough
//      passes, then each rough pass sampled on the same 60 s grid for the
//      moments it is sunlit while the observer's sky is dark, with the height,
//      the Sun's depth and a rough magnitude at each. Passes never seen by eye
//      are dropped here.
//   2. the real engine only on the best few, scored from the same factors the
//      engine's visual quality uses (height, sky darkness, length, clouds).
// Stage 1 does not depend on the weather, so it is cached per area and hour
// like the radio sweep; the rough scores are worked out per ask.

import * as sat from 'satellite.js';
import { coarsePasses, COARSE_STEP_MS } from './radio-scan.mjs';
import { ecefAt, observerFrame, brightnessAt } from './sky.mjs';
import { sunPositionEcef } from '../pass-finder/sun.js';
import { satIlluminated, sunAltitudeDeg } from '../pass-finder/visibility.js';
import { apparentAltDeg } from '../refraction.js';
import { twilightFactor, altitudeFactor, coordinationFactor } from '../pass-finder/ratings.js';
import { visualQuality } from '../sky/visual-rating.mjs';

/** The engine counts a sky as dark with the Sun this far down
 *  (visibility.js isVisibleAtAll). Stage 1 runs for the middle of a cell, so
 *  it allows half a degree more. */
const DARK_SUN_ALT_DEG = -6;
const COARSE_SUN_SLACK_DEG = 0.5;
/** The quality a pass with a guessed magnitude can reach at most (passes.mjs
 *  ESTIMATED_QUALITY_CAP, repeated here to keep this module free of it). */
const ESTIMATED_CAP = 0.4;

/**
 * Stage 1 over many satellites: [{ noradId, satrec, standardMag }] in. Every
 * rough pass with at least one moment that could be seen by eye comes out as
 * { noradId, firstMs, lastMs, peakElevDeg, estimated, seen: [{ ms, elDeg,
 * sunAltDeg, mag }] }, plus the ids whose elements would not propagate.
 */
export function coarseVisualScan(sats, observer, startMs, endMs, minElevDeg) {
  const look = observerFrame(observer);
  const passes = [];
  const unavailable = [];
  // The Sun's altitude per grid point, shared by every satellite.
  const sunAt = new Map();
  const sunAlt = (ms) => {
    let v = sunAt.get(ms);
    if (v === undefined) {
      v = apparentAltDeg(sunAltitudeDeg(observer, new Date(ms)));
      sunAt.set(ms, v);
    }
    return v;
  };
  for (const { noradId, satrec, standardMag } of sats) {
    const r = coarsePasses(satrec, observer, startMs, endMs, minElevDeg);
    if (r.unavailable) { unavailable.push(noradId); continue; }
    const s = { satrec, epochJd: satrec.jdsatepoch + (satrec.jdsatepochF ?? 0), standardMag };
    for (const run of r.runs) {
      const seen = [];
      for (let t = run.firstMs; t <= run.lastMs; t += COARSE_STEP_MS) {
        const sunAltDeg = sunAlt(t);
        if (sunAltDeg > DARK_SUN_ALT_DEG + COARSE_SUN_SLACK_DEG) continue;
        const d = new Date(t);
        const ecef = ecefAt(s, t, sat.gstime(d));
        if (!ecef || !satIlluminated(ecef, sunPositionEcef(d))) continue;
        const { elDeg } = look(ecef);
        if (elDeg < minElevDeg) continue;
        const b = brightnessAt(s, observer, ecef, t, elDeg);
        seen.push({ ms: t, elDeg, sunAltDeg, mag: b.magnitude });
      }
      if (!seen.length) continue;
      passes.push({
        noradId, firstMs: run.firstMs, lastMs: run.lastMs, peakElevDeg: run.peakElevDeg,
        estimated: !Number.isFinite(standardMag), seen,
      });
    }
  }
  return { passes, unavailable };
}

/**
 * A rough pass's visual score, as the engine scores the real one
 * (scoring.js passSuccessProbability): the best moment's sky darkness times
 * height times clear-sky odds, times a factor for how long it can be seen,
 * capped like the row's quality when the magnitude is a guess. pClearAt(ms)
 * gives the clear-sky odds (0.5 with no forecast).
 * @returns {{ score: number, mag: number | null }}
 */
export function roughVisualScore(pass, pClearAt = () => 0.5) {
  let best = 0;
  let mag = null;
  let magSunAltDeg = null;
  for (const s of pass.seen) {
    const f = twilightFactor(s.sunAltDeg) * altitudeFactor(s.elDeg) * pClearAt(s.ms);
    if (f > best) best = f;
    if (s.mag != null && (mag == null || s.mag < mag)) { mag = s.mag; magSunAltDeg = s.sunAltDeg; }
  }
  let score = best * coordinationFactor((pass.seen.length * COARSE_STEP_MS) / 1000);
  if (pass.estimated) {
    const bars = mag == null ? 0 : visualQuality({ peakMag: mag, peakMagSunAltDeg: magSunAltDeg, peakMagEstimated: true }).bars;
    score = Math.min(score, ESTIMATED_CAP, bars / 5);
  }
  return { score, mag };
}

/** Rough visual passes in the order the real ones are ranked (tools.mjs
 *  byQuality): score, then a known brightness before a guess, then the
 *  brighter, then the sooner. */
export function byRoughVisual(a, b) {
  return (b.score - a.score)
    || (Number(a.estimated) - Number(b.estimated))
    || ((a.mag ?? Infinity) - (b.mag ?? Infinity))
    || (a.firstMs - b.firstMs);
}
