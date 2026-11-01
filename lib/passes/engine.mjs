// lib/passes/engine.mjs - the one pass engine: a Track plus observers in,
// a pass list, a fixed GEO pointing, or "unavailable" out.

import { findWindowsFromPredicate } from '../pass-finder/search.js';
import { observerSeesSat } from '../pass-finder/observer-pass.js';
import { bestMomentMs, peakStepMsFor } from '../pass-finder/window-scoring.js';
import { satAltitudeDeg, satAltAzDeg, satIlluminated, sunAltitudeDeg } from '../pass-finder/visibility.js';
import { sunPositionEcef } from '../pass-finder/sun.js';
import { apparentAltDeg } from '../refraction.js';

export const DEFAULT_SEARCH_DAYS = 10;
export const ACCURACY_WARNING_DAYS = 3;

const DAY_MS = 86_400_000;
const STATIONARY_STEP_MS = 10 * 60_000;
const STATIONARY_SAMPLES = 145; // 24 h inclusive
const TWILIGHT_SUN_ALT_DEG = -6;

export function searchStepMsFor(orbitClass) {
  return orbitClass === 'leo' ? 60_000 : 120_000;
}

const round1 = (x) => Math.round(x * 10) / 10;

function stationaryPointing(track, observers, startMs) {
  return observers.map((obs) => {
    let elMin = Infinity, elMax = -Infinity, elDeg = null, azDeg = null;
    for (let i = 0; i < STATIONARY_SAMPLES; i++) {
      const ecef = track.ecefAt(new Date(startMs + i * STATIONARY_STEP_MS));
      if (!ecef) continue;
      const { alt, az } = satAltAzDeg(obs, ecef);
      const el = apparentAltDeg(alt);
      if (i === 0) { elDeg = el; azDeg = az; }
      if (el < elMin) elMin = el;
      if (el > elMax) elMax = el;
    }
    return { obsId: obs.id, azDeg, elDeg, elMinDeg: elMin, elMaxDeg: elMax };
  });
}

export function findPasses({
  track, observers, mode = 'radio', minElevDeg = 10,
  startMs, endMs = startMs + DEFAULT_SEARCH_DAYS * DAY_MS,
}) {
  if (!track.ecefAt(new Date(startMs))) return { kind: 'unavailable', reason: 'propagation' };

  if (track.orbitClass === 'geo') {
    const pointing = stationaryPointing(track, observers, startMs);
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

  const passes = windows.map((w) => {
    const peakMs = bestMomentMs(w, observers, ecefAt, peakStepMsFor(w.endMs - w.startMs));
    const peakDate = new Date(peakMs);
    const peakEcef = ecefAt(peakDate);
    const maxElev = Math.min(...observers.map((o) => satAltitudeDeg(o, peakEcef)));
    const azAt = (ms) => {
      const e = ecefAt(new Date(ms));
      return e ? round1(satAltAzDeg(observers[0], e).az) : null;
    };
    const visible = satIlluminated(peakEcef, sunPositionEcef(peakDate))
      && observers.every((o) => sunAltitudeDeg(o, peakDate) <= TWILIGHT_SUN_ALT_DEG);
    return {
      startMs: w.startMs,
      endMs: w.endMs,
      peakMs,
      durationMs: w.endMs - w.startMs,
      maxElevDeg: round1(maxElev),
      startAzDeg: azAt(w.startMs),
      peakAzDeg: azAt(peakMs),
      endAzDeg: azAt(w.endMs),
      visible,
      inProgress: w.startMs === startMs,
      runsPastEnd: w.endMs === endMs,
    };
  });
  return { kind: 'passes', passes };
}

export function accuracyNote(epochMs, passMs) {
  const ageDays = round1((passMs - epochMs) / DAY_MS);
  if (ageDays <= ACCURACY_WARNING_DAYS) return null;
  return { ageDays, text: `Elements are ${ageDays} days old at this pass, so times may be off by a minute or more.` };
}
