// lib/mcp/passes.mjs - MCP pass computation + position, composed from
// the existing pure pass-finder modules. Single-observer; weather is
// neutralized (no network) by passing a () => null cloud lookup.

import { geoMotion } from '../passes/geo-motion.mjs';
import { satIlluminated } from '../pass-finder/visibility.js';
import { peakMagnitudeInWindow, passSuccessProbability } from '../pass-finder/scoring.js';
import { sunPositionEcef } from '../pass-finder/sun.js';
import { ecefToGeodetic } from '../coords.js';
import { makeEcefSampler } from './ecef-sampler.mjs';
import { makeTrack } from '../sat/track.mjs';
import { findPasses as engineFindPasses } from '../passes/engine.mjs';
import { passArc } from '../map/pass-arc.mjs';
import { findWindowsFromPredicate } from '../pass-finder/search.js';
import { observerSeesSat } from '../pass-finder/observer-pass.js';

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

// What a geosynchronous satellite's pointing means here (geo-motion.mjs).
const NOTES = {
  fixed: 'Geostationary: it stays at this point in your sky.',
  nearly: 'Nearly geostationary: it drifts a degree or two around this point over a day.',
  moving: 'Geosynchronous but inclined: always above the horizon here, but it moves through these ranges each day, so a dish has to follow it.',
};
const NOTE_HIDDEN = 'Geosynchronous: it never rises above the minimum elevation here.';

// Sampling step for the light and shadow edges inside one pass; each edge is
// then narrowed to a whole second (findWindowsFromPredicate), so the step only
// bounds how short a lit or dark stretch can be and still be seen.
const LIGHT_STEP_MS = 10_000;
const LONG_LIGHT_STEP_MS = 60_000;
const LONG_PASS_MS = 30 * 60_000;

/**
 * When a pass can actually be seen by eye, and where it crosses the edge of
 * Earth's shadow, between rising above and dropping below minElevDeg.
 *
 * A visual pass's own times are already the seen part (sunlit, in a dark
 * sky), so they can start or stop mid-sky; the whole arc above minElevDeg is
 * found the way the map draws it (pass-arc.mjs passArc) and the shadow edges
 * are looked for along all of it. A radio pass is the whole arc already.
 * The predicates are the app's own: observerSeesSat for "seen", and
 * satIlluminated (as splitBySun uses for the map's sunlit and shadow parts).
 *
 * Returns ms or null for { visibleFromMs, visibleUntilMs, leavesShadowMs,
 * entersShadowMs }. The seen stretch is the one holding the pass's peak, else
 * the span of every seen stretch.
 */
export function passLight(track, obs, p, mode, minElevDeg) {
  let fromMs = p.startMs;
  let toMs = p.endMs;
  if (mode === 'visual') {
    const arc = passArc(track.ecefAt, obs, p, minElevDeg);
    // passArc gives the first and last moments above to a tenth of a second,
    // or the pass's own edge when it is already the horizon. Pass edges are
    // whole seconds (the first one in view, the first one out of view), so
    // round the same way to keep a horizon-limited edge equal to the row's.
    fromMs = Math.min(p.startMs, Math.ceil(arc.riseMs / 1000) * 1000);
    if (arc.setMs > p.endMs) toMs = Math.floor(arc.setMs / 1000) * 1000 + 1000;
  }
  const stepMs = toMs - fromMs > LONG_PASS_MS ? LONG_LIGHT_STEP_MS : LIGHT_STEP_MS;
  const seenAt = (ms) => {
    const d = new Date(ms);
    const e = track.ecefAt(d);
    return !!e && observerSeesSat(obs, e, d, 'visual', minElevDeg);
  };
  const litAt = (ms) => {
    const d = new Date(ms);
    const e = track.ecefAt(d);
    return !!e && satIlluminated(e, sunPositionEcef(d));
  };
  const seen = findWindowsFromPredicate(seenAt, fromMs, toMs, stepMs);
  const lit = findWindowsFromPredicate(litAt, fromMs, toMs, stepMs);
  const atPeak = seen.find((w) => w.startMs <= p.peakMs && p.peakMs <= w.endMs);
  const visibleFromMs = atPeak ? atPeak.startMs : seen.length ? seen[0].startMs : null;
  const visibleUntilMs = atPeak ? atPeak.endMs : seen.length ? seen[seen.length - 1].endMs : null;
  // A lit stretch that starts after the arc does is the satellite leaving the
  // shadow while up; one that ends before the arc does is it going in.
  const leaves = lit.find((w) => w.startMs > fromMs);
  const enters = lit.find((w) => w.endMs < toMs);
  return {
    visibleFromMs,
    visibleUntilMs,
    leavesShadowMs: leaves ? leaves.startMs : null,
    entersShadowMs: enters ? enters.endMs : null,
  };
}

const isoOrNull = (ms) => (ms == null ? null : iso(ms));

function toRow(p, track, obs, mode, minElevDeg) {
  const win = { startMs: p.startMs, endMs: p.endMs };
  const peakEcef = track.ecefAt(new Date(p.peakMs));
  const sunlit = peakEcef ? satIlluminated(peakEcef, sunPositionEcef(new Date(p.peakMs))) : false;
  const quality = passSuccessProbability(win, [obs], {
    mode, minElevDeg, ecefAtFn: track.ecefAt, cloudForecastForObs: () => null,
  });
  const light = passLight(track, obs, p, mode, minElevDeg);
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
    // Sunlit at the peak only; kept for older callers. The fields after it
    // say when it can really be seen.
    sunlit,
    // Null when it is never seen by eye on this pass (daylight, or in shadow
    // the whole time it is up).
    visibleFrom: isoOrNull(light.visibleFromMs),
    visibleUntil: isoOrNull(light.visibleUntilMs),
    // When it crosses the edge of Earth's shadow while above minElevation:
    // leaving it (appears mid-sky) or entering it (fades mid-sky). Null when
    // that does not happen on this pass.
    leavesShadow: isoOrNull(light.leavesShadowMs),
    entersShadow: isoOrNull(light.entersShadowMs),
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
    const motion = geoMotion(pt);
    return {
      passes: [],
      stationary: {
        azimuthDeg: pt.azDeg, elevationDeg: pt.elDeg, visible: r.visible, motion,
        azimuthRangeDeg: [pt.azMinDeg, pt.azMaxDeg], elevationRangeDeg: [pt.elMinDeg, pt.elMaxDeg],
        note: r.visible ? NOTES[motion] : NOTE_HIDDEN,
      },
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
