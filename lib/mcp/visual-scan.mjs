// lib/mcp/visual-scan.mjs - "the best naked-eye pass of anything bright",
// for best_pass in visual mode with no satellite named. The same two stages
// as the radio scan (radio-scan.mjs):
//   1. the coarse sweep (radio-scan.mjs coarsePasses) per satellite for rough
//      passes, then each rough pass sampled on the same 60 s grid for the
//      moments it is sunlit while the observer's sky is dark, with the height,
//      the Sun's depth and a rough magnitude at each. Passes never seen by eye
//      are dropped here.
//   2. the real engine only on the best few, rated as the app rates a pass
//      (brightness against the sky's darkness, then clouds).
// Stage 1 does not depend on the weather, so it is cached per area and hour
// like the radio sweep; the rough scores are worked out per ask.

import * as sat from 'satellite.js';
import { coarsePasses, COARSE_STEP_MS } from './radio-scan.mjs';
import { ecefAt, observerFrame, brightnessAt } from './sky.mjs';
import { sunPositionEcef } from '../pass-finder/sun.js';
import { satIlluminated, sunAltitudeDeg } from '../pass-finder/visibility.js';
import { apparentAltDeg } from '../refraction.js';
import { visualQuality, limitingMag, DEFAULT_SKY } from '../sky/visual-rating.mjs';

/** The engine counts a sky as dark with the Sun this far down
 *  (visibility.js isVisibleAtAll). Stage 1 runs for the middle of a cell, so
 *  it allows half a degree more. */
const DARK_SUN_ALT_DEG = -6;
const COARSE_SUN_SLACK_DEG = 0.5;

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
 * A rough pass's rating, as the app rates the real one (visual-rating.mjs
 * visualQuality): its brightest moment's magnitude against how dark the sky
 * is then for `skyType`, stepped down by the cloud badge there
 * (badgeAt(ms), cloud-badge.mjs, null with no forecast), and no higher than
 * Fair for a guessed magnitude. `score` orders rough passes the way the rows
 * rank (tools.mjs byVisualRating): bars first, then a known brightness
 * before a guess, then headroom (how much brighter than the faintest star it
 * gets), squeezed into one number so refineWindows can keep everything
 * within a little of the last place asked for.
 * @returns {{ score: number, bars: number, headroom: number | null, mag: number | null }}
 */
export function roughVisualScore(pass, { skyType = DEFAULT_SKY, badgeAt = () => null } = {}) {
  let best = null;
  let top = pass.seen[0];
  for (const s of pass.seen) {
    if (s.elDeg > top.elDeg) top = s;
    if (s.mag != null && (best == null || s.mag < best.mag)) best = s;
  }
  const at = best ?? top;
  const { bars } = visualQuality({
    peakMag: best ? best.mag : null,
    peakMagSunAltDeg: best ? best.sunAltDeg : null,
    peakMagEstimated: pass.estimated === true,
    maxElevDeg: pass.peakElevDeg,
    peakSunAltDeg: at?.sunAltDeg ?? null,
  }, { skyType, cloud: at ? badgeAt(at.ms) : null });
  const headroom = best ? limitingMag(best.sunAltDeg, skyType) - best.mag : null;
  const h = Math.min(HEADROOM_SPAN, Math.max(-HEADROOM_FLOOR, headroom ?? -HEADROOM_FLOOR));
  const score = bars + (pass.estimated ? 0 : KNOWN_BONUS) + h / HEADROOM_SCALE;
  return { score, bars, headroom, mag: best ? best.mag : null };
}

/** How the parts of a rough score fit in one number: a known brightness adds
 *  half a bar, and headroom (clamped to -5 .. +10 magnitudes) at most a
 *  quarter, so a whole bar always outweighs both. */
const KNOWN_BONUS = 0.5;
const HEADROOM_FLOOR = 5;
const HEADROOM_SPAN = 10;
const HEADROOM_SCALE = 40;

/** Rough visual passes best first (score, see roughVisualScore), then the sooner. */
export function byRoughVisual(a, b) {
  return (b.score - a.score) || (a.firstMs - b.firstMs);
}
