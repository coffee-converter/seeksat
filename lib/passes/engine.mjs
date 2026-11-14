// lib/passes/engine.mjs - the one pass engine: a Track plus observers in,
// a pass list, a fixed GEO pointing, or "unavailable" out.

import { findWindowsFromPredicate } from '../pass-finder/search.js';
import { observerSeesSat } from '../pass-finder/observer-pass.js';
import { bestMomentMs, peakStepMsFor } from '../pass-finder/window-scoring.js';
import { satAltitudeDeg, satAltAzDeg, satIlluminated, sunAltitudeDeg, sunlitFraction } from '../pass-finder/visibility.js';
import { sunPositionEcef } from '../pass-finder/sun.js';
import { magnitudeAt } from '../pass-finder/ratings.js';
import { apparentAltDeg } from '../refraction.js';
import { extinctionMag } from '../sky/visual-rating.mjs';

export const DEFAULT_SEARCH_DAYS = 10;
export const ACCURACY_WARNING_DAYS = 3;

const DAY_MS = 86_400_000;
const STATIONARY_STEP_MS = 10 * 60_000;
const STATIONARY_SAMPLES = 145; // 24 h inclusive
const TWILIGHT_SUN_ALT_DEG = -6;
const MAG_STEP_MS = 10_000;
/** Passes peaking lower than this are not listed (see findPasses). */
const MIN_PASS_PEAK_DEG = 1;
const ABOVE_STEP_MS = 10_000;

export function searchStepMsFor(orbitClass) {
  return orbitClass === 'leo' ? 60_000 : 120_000;
}

const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

/** A cautious standard magnitude for a satellite whose brightness is not
 *  known: about what a small satellite gives. Far or small objects then read
 *  as too faint rather than rated on height alone. */
export const UNKNOWN_STD_MAG = 6;

/** Brightest extinction-corrected magnitude for observers[0] over [startMs, endMs],
 *  sampled every 10 s, counting only moments when the satellite is sunlit and
 *  every observer's Sun is at or below the twilight threshold. The Sun altitude
 *  and elevation are observers[0]'s at that sample. A track with no
 *  standardMag uses UNKNOWN_STD_MAG and is marked peakMagEstimated. All null
 *  when no sample qualifies. */
export function peakMagnitude(track, observers, startMs, endMs) {
  const none = { peakMag: null, peakMagSunAltDeg: null, peakMagElDeg: null };
  if (observers.length === 0) return none;
  const estimated = !Number.isFinite(track.standardMag);
  const stdMag = estimated ? UNKNOWN_STD_MAG : track.standardMag;
  const obs = observers[0];
  let best = null;
  for (let t = startMs; t <= endMs; t += MAG_STEP_MS) {
    const d = new Date(t);
    const satEcef = track.ecefAt(d);
    if (!satEcef) continue;
    const sunDir = sunPositionEcef(d);
    const lit = sunlitFraction(satEcef, sunDir);
    if (lit <= 0) continue;
    const sunAlts = observers.map((o) => sunAltitudeDeg(o, d));
    if (sunAlts.some((a) => a > TWILIGHT_SUN_ALT_DEG)) continue;
    const m = magnitudeAt(obs, satEcef, sunDir, stdMag, lit);
    if (m == null) continue;
    const elDeg = satAltitudeDeg(obs, satEcef);
    const mag = m + extinctionMag(elDeg, obs.elevM ?? 0);
    if (best === null || mag < best.mag) best = { mag, elDeg, sunAltDeg: sunAlts[0] };
  }
  if (best === null) return none;
  return {
    peakMag: round2(best.mag), peakMagSunAltDeg: round1(best.sunAltDeg), peakMagElDeg: round1(best.elDeg),
    ...(estimated && { peakMagEstimated: true }),
  };
}

/** Milliseconds in [startMs, endMs] with every observer at or above each
 *  threshold, sampled every 10 s: { msAbove10, msAbove30 }. */
export function timeAbove(observers, ecefAt, startMs, endMs) {
  let n10 = 0, n30 = 0;
  for (let t = startMs; t <= endMs; t += ABOVE_STEP_MS) {
    const e = ecefAt(new Date(t));
    if (!e) continue;
    const el = Math.min(...observers.map((o) => satAltitudeDeg(o, e)));
    if (el >= 10) n10++;
    if (el >= 30) n30++;
  }
  return { msAbove10: n10 * ABOVE_STEP_MS, msAbove30: n30 * ABOVE_STEP_MS };
}

/** Where a geosynchronous satellite sits over a day, per observer: the
 *  pointing at startMs, and the elevation and azimuth ranges. Azimuths are
 *  measured as offsets from the first, so a range across north does not wrap. */
export function stationaryPointing(track, observers, startMs) {
  return observers.map((obs) => {
    let elMin = Infinity, elMax = -Infinity, elDeg = null, azDeg = null, seen = false;
    let dAzMin = 0, dAzMax = 0;
    for (let i = 0; i < STATIONARY_SAMPLES; i++) {
      const ecef = track.ecefAt(new Date(startMs + i * STATIONARY_STEP_MS));
      if (!ecef) continue;
      const { alt, az } = satAltAzDeg(obs, ecef);
      const el = apparentAltDeg(alt);
      if (!seen) { elDeg = el; azDeg = az; seen = true; }
      if (el < elMin) elMin = el;
      if (el > elMax) elMax = el;
      const dAz = az - azDeg - 360 * Math.round((az - azDeg) / 360);
      if (dAz < dAzMin) dAzMin = dAz;
      if (dAz > dAzMax) dAzMax = dAz;
    }
    if (!seen) return { obsId: obs.id, azDeg: null, elDeg: null, elMinDeg: null, elMaxDeg: null, azMinDeg: null, azMaxDeg: null };
    const wrap = (a) => ((a % 360) + 360) % 360;
    return {
      obsId: obs.id, azDeg: round1(azDeg), elDeg: round1(elDeg), elMinDeg: round1(elMin), elMaxDeg: round1(elMax),
      azMinDeg: round1(wrap(azDeg + dAzMin)), azMaxDeg: round1(wrap(azDeg + dAzMax)),
    };
  });
}

export function findPasses({
  track, observers, mode = 'radio', minElevDeg = 10,
  startMs, endMs = startMs + DEFAULT_SEARCH_DAYS * DAY_MS,
}) {
  if (!track.ecefAt(new Date(startMs))) return { kind: 'unavailable', reason: 'propagation' };
  if (observers.length === 0) return { kind: 'passes', passes: [] };

  if (track.orbitClass === 'geo') {
    const pointing = stationaryPointing(track, observers, startMs);
    if (pointing.some((p) => p.elMinDeg === null)) return { kind: 'unavailable', reason: 'propagation' };
    if (pointing.every((p) => p.elMinDeg >= minElevDeg)) return { kind: 'stationary', visible: true, pointing };
    if (pointing.some((p) => p.elMaxDeg < minElevDeg)) return { kind: 'stationary', visible: false, pointing };
    // Inclined geosynchronous: crosses the threshold daily, so it has passes.
  }

  const ecefAt = (d) => track.ecefAt(d);
  const predicate = (ms) => {
    const d = new Date(ms);
    const ecef = ecefAt(d);
    return !!ecef && observers.every((obs) => observerSeesSat(obs, ecef, d, mode, minElevDeg));
  };
  const windows = findWindowsFromPredicate(predicate, startMs, endMs, searchStepMsFor(track.orbitClass));

  const passes = windows.flatMap((w) => {
    const peakMs = bestMomentMs(w, observers, ecefAt, peakStepMsFor(w.endMs - w.startMs));
    const peakDate = new Date(peakMs);
    const peakEcef = ecefAt(peakDate);
    if (!peakEcef) return []; // nothing in the window propagates
    // A window can end where propagation fails (a decaying object); read the
    // end bearing at the last second that still propagates.
    let endSampleMs = w.endMs;
    while (endSampleMs > w.startMs && !ecefAt(new Date(endSampleMs))) endSampleMs -= 1000;
    const maxElev = Math.min(...observers.map((o) => satAltitudeDeg(o, peakEcef)));
    // A pass that only grazes the horizon (peaking under 1°) is dropped: it
    // reads "0°", and whether the search finds it at all depends on where
    // its steps happen to fall, so it came and went between loads.
    if (maxElev < MIN_PASS_PEAK_DEG) return [];
    const azAt = (ms) => {
      const e = ecefAt(new Date(ms));
      return e ? round1(satAltAzDeg(observers[0], e).az) : null;
    };
    const elAt = (ms) => {
      const e = ecefAt(new Date(ms));
      return e ? round1(satAltitudeDeg(observers[0], e)) : null;
    };
    const visible = satIlluminated(peakEcef, sunPositionEcef(peakDate))
      && observers.every((o) => sunAltitudeDeg(o, peakDate) <= TWILIGHT_SUN_ALT_DEG);
    const pass = {
      startMs: w.startMs,
      endMs: w.endMs,
      peakMs,
      durationMs: w.endMs - w.startMs,
      maxElevDeg: round1(maxElev),
      startAzDeg: azAt(w.startMs),
      peakAzDeg: azAt(peakMs),
      endAzDeg: azAt(endSampleMs),
      startElevDeg: elAt(w.startMs),
      endElevDeg: elAt(endSampleMs),
      visible,
      inProgress: w.startMs === startMs,
      runsPastEnd: w.endMs === endMs,
    };
    if (mode !== 'visual') return [{ ...pass, ...timeAbove(observers, ecefAt, w.startMs, w.endMs) }];
    return [{
      ...pass,
      ...peakMagnitude(track, observers, w.startMs, w.endMs),
      peakSunAltDeg: round1(sunAltitudeDeg(observers[0], peakDate)),
    }];
  });
  return { kind: 'passes', passes };
}

export function accuracyNote(epochMs, passMs) {
  const ageDays = round1((passMs - epochMs) / DAY_MS);
  if (ageDays <= ACCURACY_WARNING_DAYS) return null;
  return { ageDays, text: `Elements are ${ageDays} days old at this pass, so times may be off by a minute or more.` };
}
