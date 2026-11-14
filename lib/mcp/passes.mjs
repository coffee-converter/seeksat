// lib/mcp/passes.mjs - MCP pass computation + position, composed from
// the existing pure pass-finder modules. Single-observer. No network here:
// a caller that has a cloud forecast passes it in (`cloud`), else the
// cloud factor of a visual quality is the engine's neutral 0.5.

import { geoMotion } from '../passes/geo-motion.mjs';
import { satIlluminated } from '../pass-finder/visibility.js';
import { peakMagnitudeInWindow, passSuccessProbability } from '../pass-finder/scoring.js';
import { sunPositionEcef } from '../pass-finder/sun.js';
import { ecefToGeodetic, geodeticToEcef } from '../coords.js';
import { compass } from '../sat/pass-rows.mjs';
import { makeEcefSampler } from './ecef-sampler.mjs';
import { makeTrack } from '../sat/track.mjs';
import { findPasses as engineFindPasses, UNKNOWN_STD_MAG } from '../passes/engine.mjs';
import { visualQuality } from '../sky/visual-rating.mjs';
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

/** Distance in metres from an observer (at sea level) to an Earth-fixed point. */
function rangeM(obs, ecef) {
  const o = geodeticToEcef(obs.latDeg, obs.lonDeg, obs.elevM ?? 0);
  return Math.hypot(ecef[0] - o[0], ecef[1] - o[1], ecef[2] - o[2]);
}

/** Brightness note for a pass whose magnitude is a guess. */
export const ESTIMATED_MAG_NOTE = `Brightness estimated: this satellite's size isn't known, so it assumes a small one (standard magnitude ${UNKNOWN_STD_MAG}). Treat it as a rough guide.`;
const ESTIMATED_VISUAL_NOTE = `${ESTIMATED_MAG_NOTE} Like the app's rating, quality stops at Fair (0.4) because of that.`;

/** The quality a visual pass with a guessed magnitude can reach at most: the
 *  app rates such a pass no higher than Fair, 2 of its 5 bars. */
export const ESTIMATED_QUALITY_CAP = 0.4;

/**
 * Peak magnitude for a row, and whether it is a guess. A satellite with no
 * known standard magnitude gets the engine's cautious one (UNKNOWN_STD_MAG,
 * a small satellite), so a dim object never reads as bright for want of a
 * number. In visual mode that guess is the engine's own (what the app shows
 * as "est. mag"); radio passes are not limited to dark skies, so there it is
 * the same in-window magnitude a known satellite gets.
 */
function rowMagnitude(p, track, obs, mode, win) {
  const estimated = !Number.isFinite(track.standardMag);
  if (estimated && mode === 'visual' && Number.isFinite(p.peakMag)) return { mag: round(p.peakMag, 1), estimated };
  const m = peakMagnitudeInWindow(win, [obs], track.ecefAt, estimated ? UNKNOWN_STD_MAG : track.standardMag);
  return { mag: m == null ? null : round(m, 1), estimated };
}

/** Quality, capped for a visual pass with a guessed magnitude the way the app
 *  caps its rating (visual-rating.mjs: no higher than Fair, and Poor when
 *  even the guess is faint): bars / 5. */
function cappedQuality(quality, p, mode, estimated) {
  if (!estimated || mode !== 'visual') return quality;
  const { bars } = visualQuality(p);
  return Math.min(quality, ESTIMATED_QUALITY_CAP, bars / 5);
}

/** A radio pass's quality as its row will give it (radio quality has no
 *  brightness cap), rounded the same way: for ranking engine passes before
 *  paying for their full rows. */
export function radioPassQuality(p, track, obs, minElevDeg) {
  return round(passSuccessProbability({ startMs: p.startMs, endMs: p.endMs }, [obs], {
    mode: 'radio', minElevDeg, ecefAtFn: track.ecefAt, cloudForecastForObs: () => null,
  }), 3);
}

/** What a visual pass's row will rank on (tools.mjs byQuality), computed as
 *  passRow computes it: for ranking engine passes before paying for their
 *  full rows. `cloud` is a forecast (weather.js) or null. */
export function visualRankKey(p, track, obs, minElevDeg, cloud = null) {
  const win = { startMs: p.startMs, endMs: p.endMs };
  const { mag, estimated } = rowMagnitude(p, track, obs, 'visual', win);
  const quality = cappedQuality(passSuccessProbability(win, [obs], {
    mode: 'visual', minElevDeg, ecefAtFn: track.ecefAt, cloudForecastForObs: () => cloud,
  }), p, 'visual', estimated);
  return { quality: round(quality, 3), peakMagnitude: mag, peakMagnitudeEstimated: estimated };
}

/** The MCP row for one engine pass (see findPasses). `cloud` is a forecast
 *  (weather.js) a visual quality folds in, or null. */
export function passRow(p, track, obs, mode, minElevDeg, { cloud = null } = {}) {
  const win = { startMs: p.startMs, endMs: p.endMs };
  const peakEcef = track.ecefAt(new Date(p.peakMs));
  const sunlit = peakEcef ? satIlluminated(peakEcef, sunPositionEcef(new Date(p.peakMs))) : false;
  const { mag, estimated } = rowMagnitude(p, track, obs, mode, win);
  const quality = cappedQuality(passSuccessProbability(win, [obs], {
    mode, minElevDeg, ecefAtFn: track.ecefAt, cloudForecastForObs: () => cloud,
  }), p, mode, estimated);
  const light = passLight(track, obs, p, mode, minElevDeg);
  const word = (az) => (az == null ? null : compass(az));
  return {
    rise: iso(p.startMs),
    peak: iso(p.peakMs),
    set: iso(p.endMs),
    peakElevationDeg: p.maxElevDeg,
    // Straight-line distance from the observer at the peak.
    peakRangeKm: peakEcef ? Math.round(rangeM(obs, peakEcef) / 1000) : null,
    azimuthDeg: { rise: p.startAzDeg, peak: p.peakAzDeg, set: p.endAzDeg },
    direction: { rise: word(p.startAzDeg), peak: word(p.peakAzDeg), set: word(p.endAzDeg) },
    durationSec: Math.round((p.endMs - p.startMs) / 1000),
    peakMagnitude: mag,
    // True when the magnitude is a guess from an assumed size (see brightnessNote).
    peakMagnitudeEstimated: estimated,
    ...(estimated && { brightnessNote: mode === 'visual' ? ESTIMATED_VISUAL_NOTE : ESTIMATED_MAG_NOTE }),
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

export function findPasses({ record, entry = null, observer, startMs, windowHours = 48, minElevationDeg = 10, mode = 'visual', standardMag = null, cloud = null }) {
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
  return { passes: r.passes.map((p) => passRow(p, track, obs, mode, minElevationDeg, { cloud })), stationary: null, unavailable: false };
}

/** The engine's passes of one satellite in `mode`, with the track and
 *  observer passRow needs: for a caller that ranks many passes and builds
 *  rows only for the winners. Empty for a satellite that does not pass
 *  (fixed in the sky, or elements that do not propagate). */
export function enginePasses({ record, entry = null, observer, startMs, windowHours, minElevationDeg = 10, standardMag = null, mode = 'radio' }) {
  const obs = { id: 'observer', latDeg: observer.latDeg, lonDeg: observer.lonDeg };
  const track = makeTrack(record, entry);
  track.standardMag = standardMag;
  const r = engineFindPasses({
    track, observers: [obs], mode, minElevDeg: minElevationDeg,
    startMs, endMs: startMs + windowHours * 3_600_000,
  });
  return { track, obs, passes: r.kind === 'passes' ? r.passes : [] };
}

/** enginePasses in radio mode. */
export function radioEnginePasses(args) {
  return enginePasses({ ...args, mode: 'radio' });
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
