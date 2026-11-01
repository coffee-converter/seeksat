// lib/pass-finder/window-scoring.js - small scoring/aggregation
// helpers used by the windows-list renderer to summarize each pass
// at a glance.
//
// Pure given their inputs; the scene threads the observer list +
// cloud-forecast lookup + ecefAt sampler where needed.

import { cloudAt } from "./weather.js";
import { satAltitudeDeg } from "./visibility.js";

// Cloud cover range across observers at a given ms: returns
// { min, max } (each 0-100), or null if any observer's forecast
// isn't loaded yet. `cloudForecastForObs(obsId)` lets the caller
// inject its scene-level cache lookup.
export function cloudRange(ms, observers, cloudForecastForObs) {
  let min = Infinity, max = -Infinity;
  for (const obs of observers) {
    const f = cloudForecastForObs(obs.id);
    const c = cloudAt(f, ms);
    if (c == null) return null;
    if (c < min) min = c;
    if (c > max) max = c;
  }
  if (!Number.isFinite(min)) return null;
  return { min, max };
}

// Best moment in a window = where the MINIMUM altitude across all
// observers is MAXIMIZED. That's the instant when every observer
// simultaneously sees the satellite as high as it gets given the
// geometry.
export function bestMomentMs(w, observers, ecefAtFn, stepMs = 5000) {
  let bestMs = w.startMs;
  let bestMinAlt = -Infinity;
  for (let t = w.startMs; t <= w.endMs; t += stepMs) {
    const satEcef = ecefAtFn(new Date(t));
    if (!satEcef) continue;
    let minAlt = Infinity;
    for (const obs of observers) {
      const a = satAltitudeDeg(obs, satEcef);
      if (a < minAlt) minAlt = a;
    }
    if (minAlt > bestMinAlt) {
      bestMinAlt = minAlt;
      bestMs = t;
    }
  }
  return bestMs;
}

// Sampling step for bestMomentMs: 5 s for short passes, coarser for
// multi-hour ones so the scan stays around 2000 samples.
export function peakStepMsFor(durationMs) {
  return Math.max(5000, Math.ceil(durationMs / 2000));
}
