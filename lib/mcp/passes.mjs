// lib/mcp/passes.mjs - MCP pass computation + position, composed from
// the existing pure pass-finder modules. Single-observer. No network here:
// a caller that has a cloud forecast passes it in (`cloud`), else the
// cloud factor of a capture probability is the engine's neutral 0.5 and a
// visual rating has no cloud step.

import { geoMotion } from '../passes/geo-motion.mjs';
import { satIlluminated, satAltitudeDeg, sunlitFraction } from '../pass-finder/visibility.js';
import { passSuccessProbability } from '../pass-finder/scoring.js';
import { magnitudeAt } from '../pass-finder/ratings.js';
import { sunPositionEcef } from '../pass-finder/sun.js';
import { ecefToGeodetic, geodeticToEcef } from '../coords.js';
import { compass } from '../sat/pass-rows.mjs';
import { makeEcefSampler } from './ecef-sampler.mjs';
import { makeTrack } from '../sat/track.mjs';
import { findPasses as engineFindPasses, UNKNOWN_STD_MAG } from '../passes/engine.mjs';
import { visualQuality, limitingMag, extinctionMag, DEFAULT_SKY } from '../sky/visual-rating.mjs';
import { radioQuality, barWord } from '../passes/quality.mjs';

/** A probably silent satellite's radio passes rate no higher than this (Fair). */
export const SILENT_MAX_BARS = 2;
import { cloudBadge } from '../sky/cloud-badge.mjs';
import { cloudAt } from '../pass-finder/weather.js';
import { passArc } from '../map/pass-arc.mjs';
import { findWindowsFromPredicate } from '../pass-finder/search.js';
import { observerSeesSat } from '../pass-finder/observer-pass.js';

const round = (x, n = 2) => (x == null ? null : Number(x.toFixed(n)));
const iso = (ms) => new Date(ms).toISOString();
const DAY_MS = 86_400_000;

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
const ESTIMATED_VISUAL_NOTE = `${ESTIMATED_MAG_NOTE} Like the app, its rating stops at Fair because of that.`;

/**
 * The brightest magnitude over a window for one observer, sampled as
 * scoring.js peakMagnitudeInWindow samples it, with the atmosphere's dimming
 * at each moment's elevation (visual-rating.mjs extinctionMag, as the engine
 * adds it, from the observer's site elevation when known). Unlike the
 * engine's peakMagnitude it does not wait for a dark sky, since a radio pass
 * can be in daylight. Null when it is never lit.
 */
export function windowMagnitude(win, obs, ecefAt, stdMag) {
  const totalMs = win.endMs - win.startMs;
  if (totalMs < 0) return null;
  const stepMs = Math.max(1_000, Math.min(5_000, totalMs / 30));
  let best = null;
  for (let t = win.startMs; t <= win.endMs; t += stepMs) {
    const d = new Date(t);
    const e = ecefAt(d);
    if (!e) continue;
    const sunDir = sunPositionEcef(d);
    const m = magnitudeAt(obs, e, sunDir, stdMag, sunlitFraction(e, sunDir));
    if (m == null) continue;
    const mag = m + extinctionMag(satAltitudeDeg(obs, e), obs.elevM ?? 0);
    if (best == null || mag < best) best = mag;
  }
  return best;
}

/**
 * Peak magnitude for a row, and whether it is a guess. A satellite with no
 * known standard magnitude gets the engine's cautious one (UNKNOWN_STD_MAG,
 * a small satellite), so a dim object never reads as bright for want of a
 * number. In visual mode it is the engine's own peak magnitude (what the app
 * shows, with the atmosphere's dimming), known or guessed; radio passes are
 * not limited to dark skies, so there it is the window's brightest moment
 * with the same dimming (windowMagnitude), as is a visual pass the engine
 * found no dark-sky magnitude for.
 */
function rowMagnitude(p, track, obs, mode, win) {
  const estimated = !Number.isFinite(track.standardMag);
  if (mode === 'visual' && Number.isFinite(p.peakMag)) return { mag: round(p.peakMag, 1), estimated };
  const m = windowMagnitude(win, obs, track.ecefAt, estimated ? UNKNOWN_STD_MAG : track.standardMag);
  return { mag: m == null ? null : round(m, 1), estimated };
}

/** The engine's observer: the place, with its height above sea level when
 *  known (it thins the air a satellite's light passes through). */
function engineObserver(observer) {
  return {
    id: 'observer', latDeg: observer.latDeg, lonDeg: observer.lonDeg,
    ...(Number.isFinite(observer.elevM) && { elevM: observer.elevM }),
  };
}

/** The cloud badge the app shows on a pass (CloudBadge.tsx passCloud): the
 *  forecast at its peak, graded by how far ahead it is. Null without a
 *  forecast, or for a pass further ahead than the app badges. */
export function passCloudBadge(forecast, peakMs, nowMs) {
  if (!forecast) return null;
  return cloudBadge(cloudAt(forecast, peakMs), (peakMs - nowMs) / DAY_MS);
}

/**
 * The rating the app shows on an engine pass (NextUpList.tsx passRating):
 * in visual mode visual-rating.mjs visualQuality (brightness against how dark
 * the sky is for `skyType`, stepped down by the forecast cloud badge, and no
 * higher than Fair for a guessed magnitude); in radio mode quality.mjs
 * radioQuality (elevation bars, less one per 6 dB of extra path loss beyond
 * 2,000 km at the peak: `rangeKm`; the app's own bars have no range step
 * yet). { word, bars (1-5), level (low, ok, good),
 * reason }, and in visual mode headroomMag: how many magnitudes brighter
 * than the faintest star in that sky it gets (null when its brightness is
 * unknown).
 */
export function passRating(p, mode, { skyType = DEFAULT_SKY, cloud = null, nowMs = Date.now(), rangeKm = null, silent = null } = {}) {
  if (mode !== 'visual') {
    // Radio: height, less a bar per 6 dB of extra path loss when far away.
    const q = radioQuality(p, rangeKm);
    // Probably silent (SatNOGS stations tried and heard nothing): no higher
    // than Fair. `silent` is that reception, with its failed count.
    if (silent) {
      const bars = Math.min(q.bars, SILENT_MAX_BARS);
      const why = `${q.reason} SatNOGS stations tried ${silent.failedLast30d} times in 30 days and heard nothing.`;
      return { word: barWord(bars), bars, level: bars < q.bars ? 'low' : q.level, reason: why };
    }
    return { word: q.label, bars: q.bars, level: q.level, reason: q.reason };
  }
  const q = visualQuality(p, { skyType, cloud: passCloudBadge(cloud, p.peakMs, nowMs) });
  const known = Number.isFinite(p.peakMag) && Number.isFinite(p.peakMagSunAltDeg);
  return {
    word: q.label, bars: q.bars, level: q.level, reason: q.reason,
    headroomMag: known ? round(limitingMag(p.peakMagSunAltDeg, skyType) - p.peakMag, 2) : null,
  };
}

/** The chance (0-1) a camera captures the pass: the engine's capture
 *  probability (scoring.js passSuccessProbability). Visual: the best moment's
 *  sky darkness x height x clear-sky odds, times a factor for how long it
 *  lasts; brightness plays no part. Radio: peak height and length. */
function captureProbability(p, track, obs, mode, minElevDeg, cloud) {
  return round(passSuccessProbability({ startMs: p.startMs, endMs: p.endMs }, [obs], {
    mode, minElevDeg, ecefAtFn: track.ecefAt, cloudForecastForObs: () => cloud,
  }), 3);
}

const rangeKmAt = (obs, ecef) => (ecef ? Math.round(rangeM(obs, ecef) / 1000) : null);

/** Straight-line distance (km, whole) from the observer to the satellite at
 *  the pass's peak, as its row's peakRangeKm; null when it cannot be placed. */
export function peakRangeKm(p, track, obs) {
  return rangeKmAt(obs, track.ecefAt(new Date(p.peakMs)));
}

/**
 * What a pass's row ranks on (tools.mjs byVisualRating, byRadioRating),
 * worked out as passRow works it out: for ranking engine passes before
 * paying for their full rows. `cloud` is a forecast (weather.js) or null.
 */
export function rankKey(p, track, obs, mode, minElevDeg, { cloud = null, skyType = DEFAULT_SKY, nowMs = Date.now(), silent = null } = {}) {
  return {
    rating: passRating(p, mode, { skyType, cloud, nowMs, silent, rangeKm: mode === 'visual' ? null : peakRangeKm(p, track, obs) }),
    captureProbability: captureProbability(p, track, obs, mode, minElevDeg, mode === 'visual' ? cloud : null),
    peakMagnitudeEstimated: !Number.isFinite(track.standardMag),
    peakElevationDeg: p.maxElevDeg,
    durationSec: Math.round((p.endMs - p.startMs) / 1000),
    rise: iso(p.startMs),
  };
}

/** The MCP row for one engine pass (see findPasses). `cloud` is a forecast
 *  (weather.js) the visual rating and capture probability fold in, or null;
 *  `nowMs` ages it; `skyType` sets how dark the sky is for the visual rating. */
export function passRow(p, track, obs, mode, minElevDeg, { cloud = null, skyType = DEFAULT_SKY, nowMs = Date.now(), silent = null } = {}) {
  const win = { startMs: p.startMs, endMs: p.endMs };
  const peakEcef = track.ecefAt(new Date(p.peakMs));
  const sunlit = peakEcef ? satIlluminated(peakEcef, sunPositionEcef(new Date(p.peakMs))) : false;
  const { mag, estimated } = rowMagnitude(p, track, obs, mode, win);
  const capture = captureProbability(p, track, obs, mode, minElevDeg, mode === 'visual' ? cloud : null);
  const light = passLight(track, obs, p, mode, minElevDeg);
  const word = (az) => (az == null ? null : compass(az));
  return {
    rise: iso(p.startMs),
    peak: iso(p.peakMs),
    set: iso(p.endMs),
    peakElevationDeg: p.maxElevDeg,
    // Straight-line distance from the observer at the peak.
    peakRangeKm: rangeKmAt(obs, peakEcef),
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
    // The app's rating for this pass (passRating): what passes rank by.
    rating: passRating(p, mode, { skyType, cloud, nowMs, silent, rangeKm: mode === 'visual' ? null : rangeKmAt(obs, peakEcef) }),
    captureProbability: capture,
    // Deprecated: the old name of captureProbability, with its old cap at 0.4
    // (Fair) for an estimated brightness, so callers that sort on it still
    // rank as they did.
    quality: estimated ? Math.min(capture, 0.4) : capture,
    inProgress: p.inProgress,
  };
}

/** The engine's answer for one satellite: its passes (with the track and
 *  observer passRow needs), or where it sits when it never moves through the
 *  sky, or unavailable when its elements do not propagate. */
export function passSearch({ record, entry = null, observer, startMs, windowHours = 48, minElevationDeg = 10, mode = 'visual', standardMag = null }) {
  const obs = engineObserver(observer);
  const track = makeTrack(record, entry);
  track.standardMag = standardMag;
  const r = engineFindPasses({
    track, observers: [obs], mode, minElevDeg: minElevationDeg,
    startMs, endMs: startMs + windowHours * 3_600_000,
  });
  if (r.kind === 'unavailable') return { track, obs, passes: [], stationary: null, unavailable: true };
  if (r.kind === 'stationary') {
    const pt = r.pointing[0];
    const motion = geoMotion(pt);
    return {
      track, obs, passes: [], unavailable: false,
      stationary: {
        azimuthDeg: pt.azDeg, elevationDeg: pt.elDeg, visible: r.visible, motion,
        azimuthRangeDeg: [pt.azMinDeg, pt.azMaxDeg], elevationRangeDeg: [pt.elMinDeg, pt.elMaxDeg],
        note: r.visible ? NOTES[motion] : NOTE_HIDDEN,
      },
    };
  }
  return { track, obs, passes: r.passes, stationary: null, unavailable: false };
}

/** Rows for one satellite's passes in time order (all of them, or the first
 *  `limit`), or where it sits when it never moves through the sky. */
export function findPasses({ cloud = null, skyType = DEFAULT_SKY, nowMs = Date.now(), limit = Infinity, ...args }) {
  const { track, obs, passes, stationary, unavailable } = passSearch(args);
  const { mode = 'visual', minElevationDeg = 10 } = args;
  const rows = passes.slice(0, limit).map((p) => passRow(p, track, obs, mode, minElevationDeg, { cloud, skyType, nowMs }));
  return { passes: rows, stationary, unavailable };
}

/** The engine's passes of one satellite in `mode`, with the track and
 *  observer passRow needs: for a caller that ranks many passes and builds
 *  rows only for the winners. Empty for a satellite that does not pass
 *  (fixed in the sky, or elements that do not propagate). */
export function enginePasses({ mode = 'radio', ...args }) {
  const { track, obs, passes } = passSearch({ ...args, mode });
  return { track, obs, passes };
}

// Raw window + peak of the SOONEST pass of `mode` within the scan, for
// callers that need the window itself (e.g. chart rendering), with its peak
// magnitude as a row gives it (null when the brightness is unknown, no
// standardMag). Returns { win, peakMs, peakMag } or null.
export function nextPassWindow({ record, entry = null, observer, startMs, windowHours = 72, minElevationDeg = 10, mode = 'visual', standardMag = null }) {
  const { track, obs, passes } = passSearch({ record, entry, observer, startMs, windowHours, minElevationDeg, mode, standardMag });
  if (!passes.length) return null;
  const p = passes[0];
  const win = { startMs: p.startMs, endMs: p.endMs };
  const peakMag = Number.isFinite(standardMag) ? rowMagnitude(p, track, obs, mode, win).mag : null;
  return { win, peakMs: p.peakMs, peakMag };
}
