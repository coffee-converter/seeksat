// lib/mcp/passes.mjs - MCP pass computation + position, composed from
// the existing pure pass-finder modules. Single-observer; weather is
// neutralized (no network) by passing a () => null cloud lookup.

import { satIlluminated } from '../pass-finder/visibility.js';
import { peakMagnitudeInWindow, passSuccessProbability } from '../pass-finder/scoring.js';
import { sunPositionEcef } from '../pass-finder/sun.js';
import { ecefToGeodetic } from '../coords.js';
import { makeEcefSampler } from './ecef-sampler.mjs';
import { makeTrack } from '../sat/track.mjs';
import { findPasses as engineFindPasses } from '../passes/engine.mjs';

const round = (x, n = 2) => (x == null ? null : Number(x.toFixed(n)));
const iso = (ms) => new Date(ms).toISOString();

export function getPosition(record, jsDate) {
  const sampler = makeEcefSampler(record);
  const ecef = sampler(jsDate);
  if (!ecef) return null;
  const { latDeg, lonDeg, elevM } = ecefToGeodetic(ecef[0], ecef[1], ecef[2]);
  return {
    latDeg: round(latDeg, 4),
    lonDeg: round(lonDeg, 4),
    altitudeKm: round(elevM / 1000, 1),
    sunlit: satIlluminated(ecef, sunPositionEcef(jsDate)),
    time: jsDate.toISOString(),
  };
}

const NOTE_VISIBLE = 'Geostationary: it stays at this point in your sky.';
const NOTE_HIDDEN = 'Geostationary: it never rises above the minimum elevation here.';

function toRow(p, track, obs, mode, minElevDeg) {
  const win = { startMs: p.startMs, endMs: p.endMs };
  const peakEcef = track.ecefAt(new Date(p.peakMs));
  const sunlit = peakEcef ? satIlluminated(peakEcef, sunPositionEcef(new Date(p.peakMs))) : false;
  const quality = passSuccessProbability(win, [obs], {
    mode, minElevDeg, ecefAtFn: track.ecefAt, cloudForecastForObs: () => null,
  });
  // standardMag null means the brightness is unknown (synthesized,
  // non-curated entries): peakMagnitude is then null, never computed.
  return {
    rise: iso(p.startMs),
    peak: iso(p.peakMs),
    set: iso(p.endMs),
    peakElevationDeg: p.maxElevDeg,
    azimuthDeg: { rise: p.startAzDeg, peak: p.peakAzDeg, set: p.endAzDeg },
    durationSec: Math.round((p.endMs - p.startMs) / 1000),
    peakMagnitude: track.standardMag == null ? null : round(peakMagnitudeInWindow(win, [obs], track.ecefAt, track.standardMag), 1),
    sunlit,
    quality: round(quality, 3),
    inProgress: p.inProgress,
  };
}

export function findPasses({ record, entry = null, observer, startMs, windowHours = 48, minElevationDeg = 10, mode = 'visual', standardMag = null }) {
  const obs = { id: 'observer', latDeg: observer.latDeg, lonDeg: observer.lonDeg };
  const track = makeTrack(record, entry);
  track.standardMag = standardMag;
  const r = engineFindPasses({
    track, observers: [obs], mode, minElevDeg: minElevationDeg,
    startMs, endMs: startMs + windowHours * 3_600_000,
  });
  if (r.kind === 'unavailable') return { passes: [], stationary: null, unavailable: true };
  if (r.kind === 'stationary') {
    const pt = r.pointing[0];
    return {
      passes: [],
      stationary: { azimuthDeg: pt.azDeg, elevationDeg: pt.elDeg, visible: r.visible, note: r.visible ? NOTE_VISIBLE : NOTE_HIDDEN },
      unavailable: false,
    };
  }
  return { passes: r.passes.map((p) => toRow(p, track, obs, mode, minElevationDeg)), stationary: null, unavailable: false };
}

// Raw window + peak of the SOONEST pass of `mode` within the scan, for
// callers that need the window itself (e.g. chart rendering). Returns
// { win, peakMs } or null.
export function nextPassWindow({ record, entry = null, observer, startMs, windowHours = 72, minElevationDeg = 10, mode = 'visual' }) {
  const obs = { id: 'observer', latDeg: observer.latDeg, lonDeg: observer.lonDeg };
  const r = engineFindPasses({
    track: makeTrack(record, entry), observers: [obs], mode, minElevDeg: minElevationDeg,
    startMs, endMs: startMs + windowHours * 3_600_000,
  });
  if (r.kind !== 'passes' || !r.passes.length) return null;
  const p = r.passes[0];
  return { win: { startMs: p.startMs, endMs: p.endMs }, peakMs: p.peakMs };
}
