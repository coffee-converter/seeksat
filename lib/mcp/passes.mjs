// lib/mcp/passes.mjs — MCP pass computation + position, composed from
// the existing pure pass-finder modules. Single-observer; weather is
// neutralized (no network) by passing a () => null cloud lookup.

import { findWindowsFromPredicate } from '../pass-finder/search.js';
import { observerSeesIss } from '../pass-finder/observer-pass.js';
import { issAltAzDeg, issIlluminated } from '../pass-finder/visibility.js';
import { peakMagnitudeInWindow, passSuccessProbability } from '../pass-finder/scoring.js';
import { sunPositionEcef } from '../pass-finder/sun.js';
import { ecefToGeodetic } from '../coords.js';
import { makeEcefSampler } from './ecef-sampler.mjs';

const round = (x, n = 2) => (x == null ? null : Number(x.toFixed(n)));
const iso = (ms) => new Date(ms).toISOString();

export function getPosition(line1, line2, jsDate) {
  const sampler = makeEcefSampler(line1, line2);
  const ecef = sampler(jsDate);
  if (!ecef) return null;
  const { latDeg, lonDeg, elevM } = ecefToGeodetic(ecef[0], ecef[1], ecef[2]);
  return {
    latDeg: round(latDeg, 4),
    lonDeg: round(lonDeg, 4),
    altitudeKm: round(elevM / 1000, 1),
    sunlit: issIlluminated(ecef, sunPositionEcef(jsDate)),
    time: jsDate.toISOString(),
  };
}

function summarizePass(win, observer, sampler, mode, minElevDeg, stdMag = -1.8) {
  const STEP = 1000;
  let peakAlt = -Infinity;
  let peakMs = win.startMs;
  for (let t = win.startMs; t <= win.endMs; t += STEP) {
    const e = sampler(new Date(t));
    if (!e) continue;
    const { alt } = issAltAzDeg(observer, e);
    if (alt > peakAlt) { peakAlt = alt; peakMs = t; }
  }
  if (peakAlt === -Infinity) return null;
  const azAt = (ms) => {
    const e = sampler(new Date(ms));
    return e ? round(issAltAzDeg(observer, e).az, 1) : null;
  };
  const peakEcef = sampler(new Date(peakMs));
  const sunlit = peakEcef ? issIlluminated(peakEcef, sunPositionEcef(new Date(peakMs))) : false;
  const quality = passSuccessProbability(win, [observer], {
    mode, minElevDeg, issEcefAtFn: sampler, cloudForecastForObs: () => null,
  });
  return {
    rise: iso(win.startMs),
    peak: iso(peakMs),
    set: iso(win.endMs),
    peakElevationDeg: round(peakAlt, 1),
    azimuthDeg: { rise: azAt(win.startMs), peak: azAt(peakMs), set: azAt(win.endMs) },
    durationSec: Math.round((win.endMs - win.startMs) / 1000),
    peakMagnitude: round(peakMagnitudeInWindow(win, [observer], sampler, stdMag), 1),
    sunlit,
    quality: round(quality, 3),
  };
}

export function findPasses({ line1, line2, observer, startMs, windowHours = 48, minElevationDeg = 10, mode = 'visual', standardMag = -1.8 }) {
  const obs = { id: 'observer', latDeg: observer.latDeg, lonDeg: observer.lonDeg };
  const sampler = makeEcefSampler(line1, line2);
  const endMs = startMs + windowHours * 3_600_000;
  const predicate = (ms) => {
    const e = sampler(new Date(ms));
    if (!e) return false;
    return observerSeesIss(obs, e, new Date(ms), mode, minElevationDeg);
  };
  const windows = findWindowsFromPredicate(predicate, startMs, endMs, 60_000);
  return windows
    .map(w => summarizePass(w, obs, sampler, mode, minElevationDeg, standardMag))
    .filter(Boolean);
}
