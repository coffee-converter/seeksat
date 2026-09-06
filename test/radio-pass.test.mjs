import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radioPassSamples, interpolateMinimum } from '../lib/pass-finder/radio-pass.js';
import { geodeticToEcef } from '../lib/coords.js';

// Fixture at the North Pole, not the equator (per task-4-brief correction).
//
// The fake satStateAt returns gmst: 0, so observerTemeAt correctly gives the
// observer a velocity of omega x r ~= 465 m/s along +y at the equator - the
// same axis as the fake satellite's velocity in the original fixture. That
// would contaminate the relative velocity against which the closed-form
// expectations below are checked. At the pole, omega x r is ~2.8e-14 m/s,
// so the observer is effectively stationary and the closed form is exact.
const OBS = { latDeg: 90, lonDeg: 0 };
const OBS_ECEF = geodeticToEcef(90, 0, 0); // ~[0, 0, 6356752.3]
const UP = [0, 0, 1];
const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);

// Straight-line target: closest approach d at t = T0, speed v along +x.
// Closed-form range r(t) = sqrt(d^2 + v^2 t^2), so every output is checkable.
// At TCA the satellite sits directly overhead at range d.
function straightLineTarget(d, v) {
  return (date) => {
    const t = (date.getTime() - T0) / 1000;
    const p = [v * t, 0, OBS_ECEF[2] + d];
    return { rTeme: [...p], vTeme: [v, 0, 0], rEcef: [...p], gmst: 0 };
  };
}

test('interpolateMinimum recovers a parabola vertex exactly', () => {
  // y = 3 (x - 0.4)^2 + 5, sampled at x = -1, 0, 1
  const f = (x) => 3 * (x - 0.4) ** 2 + 5;
  const out = interpolateMinimum(f(-1), f(0), f(1), 1);
  assert.ok(Math.abs(out.offsetSec - 0.4) < 1e-12, `offset ${out.offsetSec}`);
  assert.ok(Math.abs(out.value - 5) < 1e-9, `value ${out.value}`);
});

test('closest approach is interpolated, not snapped to a sample', () => {
  // Offset the grid so TCA falls between samples. At 2 s spacing with an
  // ISS-like second derivative, snapping to the nearest sample is 54.6 m
  // out; interpolation brings that to 0.038 m.
  const d = 420000, v = 7500;
  const stateAt = straightLineTarget(d, v);
  const { summary } = radioPassSamples(
    OBS,
    { startMs: T0 - 200000 + 700, endMs: T0 + 200000 + 700 },
    { satStateAt: stateAt, obsEcef: OBS_ECEF, upEcef: UP },
    { freqHz: 437.8e6, stepMs: 2000 },
  );
  assert.ok(
    Math.abs(summary.closestRangeM - d) < 1.0,
    `closest range ${summary.closestRangeM} vs ${d}`,
  );
  assert.ok(
    Math.abs(summary.tcaMs - T0) < 50,
    `TCA off by ${summary.tcaMs - T0} ms`,
  );
});

test('Doppler extremes match the closed form and are signed correctly', () => {
  const d = 420000, v = 7500, F = 437.8e6;
  const stateAt = straightLineTarget(d, v);
  const half = 400000;
  const { samples, summary } = radioPassSamples(
    OBS,
    { startMs: T0 - half, endMs: T0 + half },
    { satStateAt: stateAt, obsEcef: OBS_ECEF, upEcef: UP },
    { freqHz: F, stepMs: 2000 },
  );
  const tEnd = half / 1000;
  const rdotEnd = (v * v * tEnd) / Math.sqrt(d * d + v * v * tEnd * tEnd);
  const expected = F * rdotEnd / 299792458;
  assert.ok(Math.abs(summary.dopplerMaxHz - expected) < 5,
    `max ${summary.dopplerMaxHz} vs ${expected}`);
  assert.ok(summary.dopplerMinHz < 0, 'must go negative');
  // First sample is approaching -> positive.
  assert.ok(samples[0].dopplerHz > 0, 'pass must start high');
  assert.ok(samples[samples.length - 1].dopplerHz < 0, 'pass must end low');
});

test('peak-to-peak uses both edges independently, not 2x the maximum', () => {
  // Real passes are asymmetric - up to 4.88% measured on a grazing pass.
  const stateAt = straightLineTarget(420000, 7500);
  const { summary } = radioPassSamples(
    OBS,
    { startMs: T0 - 300000, endMs: T0 + 120000 }, // deliberately lopsided
    { satStateAt: stateAt, obsEcef: OBS_ECEF, upEcef: UP },
    { freqHz: 437.8e6, stepMs: 2000 },
  );
  const ptp = summary.dopplerMaxHz - summary.dopplerMinHz;
  assert.ok(Math.abs(summary.dopplerPeakToPeakHz - ptp) < 1e-9);
  assert.ok(
    Math.abs(summary.dopplerPeakToPeakHz - 2 * summary.dopplerMaxHz) > 100,
    'lopsided window must produce an asymmetric swing',
  );
});

test('signal envelope peaks at closest approach', () => {
  const stateAt = straightLineTarget(420000, 7500);
  const { samples } = radioPassSamples(
    OBS,
    { startMs: T0 - 200000, endMs: T0 + 200000 },
    { satStateAt: stateAt, obsEcef: OBS_ECEF, upEcef: UP },
    { freqHz: 437.8e6, stepMs: 2000 },
  );
  const best = samples.reduce((a, b) => (b.relSignalDb > a.relSignalDb ? b : a));
  // Tolerance widened from the brief's 1e-9 to 1e-6: light-time retardation
  // makes the received-range curve slightly asymmetric in reception time
  // (confirmed independent of the fixture correction - reproduces
  // identically under the brief's original equator fixture), so the
  // interpolated TCA range is a hair below any single raw sample's range.
  // The best sample here lands at -2.7e-9 dB, not exactly 0; 1e-6 still
  // rejects anything but this floating-point-scale residual.
  assert.ok(Math.abs(best.relSignalDb) < 1e-6, 'peak must be ~0 dB');
  assert.ok(samples[0].relSignalDb < -5, 'edges must be well below peak');
});

test('angular rate peaks at closest approach', () => {
  const d = 420000, v = 7500;
  const stateAt = straightLineTarget(d, v);
  const { samples } = radioPassSamples(
    OBS,
    { startMs: T0 - 200000, endMs: T0 + 200000 },
    { satStateAt: stateAt, obsEcef: OBS_ECEF, upEcef: UP },
    { freqHz: 437.8e6, stepMs: 2000 },
  );
  const peak = samples.reduce((a, b) =>
    (b.angRateDegPerSec > a.angRateDegPerSec ? b : a));
  assert.ok(Math.abs(peak.tMs - T0) < 3000, 'omega must peak at TCA');
  // omega_max = v/d = 7500/420000 rad/s = 1.0233 deg/s
  const expected = (v / d) * 180 / Math.PI;
  assert.ok(Math.abs(peak.angRateDegPerSec - expected) < 0.02,
    `expected ~${expected.toFixed(3)}, got ${peak.angRateDegPerSec.toFixed(3)}`);
});

test('a window too short to interpolate does not throw', () => {
  const stateAt = straightLineTarget(420000, 7500);
  const out = radioPassSamples(
    OBS,
    { startMs: T0, endMs: T0 + 1000 },
    { satStateAt: stateAt, obsEcef: OBS_ECEF, upEcef: UP },
    { freqHz: 437.8e6, stepMs: 2000 },
  );
  assert.ok(Array.isArray(out.samples));
  assert.ok(out.summary);
});

test('a null frequency still yields range-rate samples', () => {
  const stateAt = straightLineTarget(420000, 7500);
  const { samples } = radioPassSamples(
    OBS,
    { startMs: T0 - 60000, endMs: T0 + 60000 },
    { satStateAt: stateAt, obsEcef: OBS_ECEF, upEcef: UP },
    { freqHz: null, stepMs: 2000 },
  );
  assert.ok(samples.every((s) => s.dopplerHz === null));
  assert.ok(samples.every((s) => Number.isFinite(s.rangeRateMps)));
});
