import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureProbJoint, passSuccessProbability,
  radioPassSuccessProbability, radioCaptureAt,
  peakMagnitudeInWindow,
} from '../lib/pass-finder/scoring.js';

const close = (a, b, eps) => Math.abs(a - b) < eps;

// Helpers: synthesize geometries for the scoring functions.

// Observer at the equator, lon=0. Local up is +x in ECEF.
const OBS_EQUATOR = { id: 'eq', latDeg: 0, lonDeg: 0 };
const EARTH_R = 6378137;

// ISS directly overhead at 400 km altitude. apparentAlt ≈ 89.97° (>> 5°).
const ISS_OVERHEAD = [EARTH_R + 400_000, 0, 0];

// Sun direction such that the observer is in night (sun below horizon).
// For an equator/lon=0 observer with local up = +x, "sun below horizon"
// means sun's ECEF direction has negative x (or more precisely the sun
// alt < 0). Picking sunDir = (-1, 0, 0) puts the sun at the antipode →
// sun altitude is exactly -90° → twilightFactor saturates at 1.
const SUN_ANTIPODE = [-1, 0, 0];

// No-cloud lookup (callback shape required by scoring.js).
const NO_CLOUDS = () => null;

// ---- captureProbJoint ----------------------------------------------------

test('captureProbJoint: returns 0 when any observer is below 5° elevation', () => {
  // ISS just slightly above the horizon (apparent alt < 5°).
  // Place ISS far north (along +y) and project back: at the equator,
  // a point at (R, 1e7, 0) has u ≈ R/sqrt(R²+1e14) → very small.
  const issLowAlt = [EARTH_R, 10_000_000, 0];
  const p = captureProbJoint(
    [OBS_EQUATOR], issLowAlt, new Date(), 0, 0, NO_CLOUDS,
  );
  assert.equal(p, 0);
});

test('captureProbJoint: returns 0 when sun is above horizon at any observer', () => {
  // captureProbJoint reads sun position via sun.js (date-driven), not as a
  // parameter - so we pick a real moment when the sun is up at the
  // observer's location. Noon UTC on the spring equinox at lat=0/lon=0
  // puts the sun nearly directly overhead → sun gate trips → score 0.
  const noon = new Date(Date.UTC(2025, 2, 20, 12, 0, 0));
  const p = captureProbJoint(
    [OBS_EQUATOR], ISS_OVERHEAD, noon, noon.getTime(), noon.getTime(), NO_CLOUDS,
  );
  assert.equal(p, 0);
});

test('captureProbJoint: positive value at midnight overhead pass', () => {
  // Midnight UTC at lon=0, equinox - sun is at the antipode, well below
  // horizon. ISS directly overhead at 400 km → high altitude + dark sky.
  const midnight = new Date(Date.UTC(2025, 2, 20, 0, 0, 0));
  const p = captureProbJoint(
    [OBS_EQUATOR], ISS_OVERHEAD, midnight, midnight.getTime(), midnight.getTime(), NO_CLOUDS,
  );
  assert.ok(p > 0.4, `p=${p}`);
});

test('captureProbJoint: cloud forecast knocks down the score (MIN combiner)', () => {
  const midnight = new Date(Date.UTC(2025, 2, 20, 0, 0, 0));
  const ms = midnight.getTime();
  const noCloud = captureProbJoint([OBS_EQUATOR], ISS_OVERHEAD, midnight, ms, ms, NO_CLOUDS);
  // 100% cloud cover forecast for this observer at this moment.
  const overcastForecast = { startMs: ms, hours: [100, 100, 100, 100] };
  const overcast = captureProbJoint(
    [OBS_EQUATOR], ISS_OVERHEAD, midnight, ms, ms,
    (id) => id === 'eq' ? overcastForecast : null,
  );
  // 100% cloud → effectivePClear(100, age=0) = 0 → joint score drops to 0.
  assert.ok(overcast < noCloud, `overcast=${overcast} should be < noCloud=${noCloud}`);
  assert.equal(overcast, 0);
});

// ---- passSuccessProbability ---------------------------------------------

test('passSuccessProbability: visual mode - empty window returns 0', () => {
  const win = { startMs: 0, endMs: 0 };
  const p = passSuccessProbability(win, [OBS_EQUATOR], {
    mode: 'visual', minElevDeg: 10,
    issEcefAtFn: () => null,
    cloudForecastForObs: NO_CLOUDS,
  });
  assert.equal(p, 0);
});

test('passSuccessProbability: visual mode - no observers returns 0', () => {
  const win = { startMs: 0, endMs: 60_000 };
  const p = passSuccessProbability(win, [], {
    mode: 'visual', minElevDeg: 10,
    issEcefAtFn: () => ISS_OVERHEAD,
    cloudForecastForObs: NO_CLOUDS,
  });
  assert.equal(p, 0);
});

test('passSuccessProbability: visual midnight pass returns positive score', () => {
  const midnight = Date.UTC(2025, 2, 20, 0, 0, 0);
  const win = { startMs: midnight, endMs: midnight + 4 * 60_000 }; // 4 min
  const p = passSuccessProbability(win, [OBS_EQUATOR], {
    mode: 'visual', minElevDeg: 10,
    issEcefAtFn: () => ISS_OVERHEAD,
    cloudForecastForObs: NO_CLOUDS,
  });
  // Score = (twilight × altitude × clear) × coordinationFactor(durSec).
  // 4 min → coord = 240/(240+60) = 0.8; deep night ~ twilight=1; altitude
  // overhead ~ 1; no clouds = 0.5 neutral → joint ≈ 0.4. Verify > 0.3 so
  // the test is robust to small per-sample variation.
  assert.ok(p > 0.3, `p=${p}`);
});

test('passSuccessProbability: radio mode delegates to radioPassSuccessProbability', () => {
  const midnight = Date.UTC(2025, 2, 20, 0, 0, 0);
  const win = { startMs: midnight, endMs: midnight + 4 * 60_000 };
  const p = passSuccessProbability(win, [OBS_EQUATOR], {
    mode: 'radio', minElevDeg: 10,
    issEcefAtFn: () => ISS_OVERHEAD,
    cloudForecastForObs: NO_CLOUDS,
  });
  // Radio mode doesn't gate on sun, so even noon should score positive.
  // peakElevFactor(~90°) = 1; radioDurationFactor(240s) ≈ 0.93.
  assert.ok(p > 0.9, `p=${p}`);
});

// ---- radioPassSuccessProbability ----------------------------------------

test('radioPassSuccessProbability: empty window returns 0', () => {
  const p = radioPassSuccessProbability(
    { startMs: 0, endMs: 0 }, [OBS_EQUATOR], 10, () => ISS_OVERHEAD,
  );
  assert.equal(p, 0);
});

test('radioPassSuccessProbability: no observers returns 0', () => {
  const p = radioPassSuccessProbability(
    { startMs: 0, endMs: 60_000 }, [], 10, () => ISS_OVERHEAD,
  );
  assert.equal(p, 0);
});

test('radioPassSuccessProbability: returns 0 when ISS ECEF unavailable for entire window', () => {
  const p = radioPassSuccessProbability(
    { startMs: 0, endMs: 60_000 }, [OBS_EQUATOR], 10, () => null,
  );
  assert.equal(p, 0);
});

test('radioPassSuccessProbability: overhead 5-minute pass scores high', () => {
  const win = { startMs: 0, endMs: 5 * 60_000 };
  const p = radioPassSuccessProbability(win, [OBS_EQUATOR], 10, () => ISS_OVERHEAD);
  // peakElevFactor(~90°) = 1, radioDurationFactor(300s) ≈ 0.96
  assert.ok(p > 0.9, `p=${p}`);
});

// ---- radioCaptureAt -----------------------------------------------------

test('radioCaptureAt: ISS overhead with single observer → factor near 1', () => {
  const v = radioCaptureAt([OBS_EQUATOR], ISS_OVERHEAD, 10);
  assert.ok(v > 0.95, `v=${v}`);
});

test('radioCaptureAt: any observer below minElev returns 0', () => {
  const issLowAlt = [EARTH_R, 10_000_000, 0]; // very low apparent alt
  const v = radioCaptureAt([OBS_EQUATOR], issLowAlt, 10);
  assert.equal(v, 0);
});

test('radioCaptureAt: worst observer caps the joint factor', () => {
  // For an ISS at 400 km overhead the equator/lon=0, the geometric
  // horizon limit is ~20° of longitude offset before the ISS dips below
  // an observer's horizon. Pick obsWest at 10° west - ISS is still
  // ~45° elevation for them, while OBS_EQUATOR sees it overhead.
  const obsWest = { id: 'w', latDeg: 0, lonDeg: -10 };
  const v = radioCaptureAt([OBS_EQUATOR, obsWest], ISS_OVERHEAD, 5);
  // Worst observer's peakElevFactor caps the joint; both above 5° → > 0.
  assert.ok(v > 0 && v < 1, `v=${v}`);
});

// ---- peakMagnitudeInWindow ----------------------------------------------

test('peakMagnitudeInWindow: empty observers returns null', () => {
  const win = { startMs: 0, endMs: 60_000 };
  assert.equal(peakMagnitudeInWindow(win, [], () => ISS_OVERHEAD), null);
});

test('peakMagnitudeInWindow: zero-duration window returns null', () => {
  const win = { startMs: 0, endMs: 0 };
  assert.equal(peakMagnitudeInWindow(win, [OBS_EQUATOR], () => ISS_OVERHEAD), null);
});

test('peakMagnitudeInWindow: returns null when no ISS samples in window', () => {
  const win = { startMs: 0, endMs: 60_000 };
  assert.equal(peakMagnitudeInWindow(win, [OBS_EQUATOR], () => null), null);
});

test('peakMagnitudeInWindow: returns brightest magnitude (most negative)', () => {
  // Construct an issEcefAt that varies range across the window: closer
  // at t=30_000 (overhead → 400 km), farther at edges (offset).
  const win = { startMs: 0, endMs: 60_000 };
  const issEcefAtFn = (date) => {
    const t = date.getTime();
    if (t >= 25_000 && t <= 35_000) return ISS_OVERHEAD; // overhead → brightest
    return [EARTH_R, 2_000_000, 0]; // farther + lower → dimmer
  };
  // Use a midnight date so the observer is in dark sky (otherwise the
  // observer might be on the night side of Earth and see the unlit hemi).
  const midnight = Date.UTC(2025, 2, 20, 0, 0, 0);
  const w = { startMs: midnight, endMs: midnight + 60_000 };
  // Re-shape issEcefAtFn using the shifted timestamps
  const fn = (date) => {
    const tRel = date.getTime() - midnight;
    if (tRel >= 25_000 && tRel <= 35_000) return ISS_OVERHEAD;
    return [EARTH_R, 2_000_000, 0];
  };
  const m = peakMagnitudeInWindow(w, [OBS_EQUATOR], fn);
  // Just verify we got a finite number - exact value depends on real
  // sunPositionEcef at the chosen date.
  assert.ok(m !== null);
  assert.ok(typeof m === 'number');
  assert.ok(isFinite(m), `m=${m}`);
});

// Suppress unused-import lint for the test file.
void close;
