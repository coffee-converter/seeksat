import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cloudRange, bestMomentMs,
} from '../lib/pass-finder/window-scoring.js';

// ---- cloudRange: min/max cloud cover across observers -------------------

test('cloudRange: null when any observer has no forecast loaded', () => {
  const ms = Date.now();
  const observers = [{ id: 'a' }, { id: 'b' }];
  const cloudForecastFor = (id) => id === 'a' ? makeForecast(ms, [50]) : null;
  assert.equal(cloudRange(ms, observers, cloudForecastFor), null);
});

test('cloudRange: empty observers returns null', () => {
  assert.equal(cloudRange(Date.now(), [], () => null), null);
});

test('cloudRange: single observer — min and max equal', () => {
  const ms = Date.now();
  const observers = [{ id: 'a' }];
  const cloudForecastFor = () => makeForecast(ms, [42]);
  const out = cloudRange(ms, observers, cloudForecastFor);
  assert.deepEqual(out, { min: 42, max: 42 });
});

test('cloudRange: two observers — picks min and max', () => {
  const ms = Date.now();
  const observers = [{ id: 'a' }, { id: 'b' }];
  const cloudForecastFor = (id) =>
    id === 'a' ? makeForecast(ms, [20]) : makeForecast(ms, [80]);
  const out = cloudRange(ms, observers, cloudForecastFor);
  assert.deepEqual(out, { min: 20, max: 80 });
});

// Helper: build a minimal forecast shape that cloudAt understands.
// cloudAt looks up the hour bucket — startMs is the bucket start, hours[]
// is hourly percent values from there.
function makeForecast(atMs, hourValues) {
  return { startMs: atMs, hours: hourValues };
}

// ---- bestMomentMs: peak-of-min-altitude moment finder -------------------

test('bestMomentMs: returns startMs when issEcefAtFn always returns null', () => {
  const w = { startMs: 0, endMs: 60_000 };
  const out = bestMomentMs(w, [{ latDeg: 0, lonDeg: 0 }], () => null);
  assert.equal(out, 0);
});

test('bestMomentMs: picks instant where ISS is highest', () => {
  const w = { startMs: 0, endMs: 60_000 };
  const obs = { latDeg: 0, lonDeg: 0 };
  // Synthesize ISS positions: low altitude at start/end, peak at t=30_000.
  // Easiest: place ISS along observer's local zenith (above equator at
  // lon=0) at the peak moment, and offset horizontally before/after.
  const RADIUS = 6378137;
  const issEcefAtFn = (date) => {
    const t = date.getTime();
    if (t === 30_000) return [RADIUS + 400_000, 0, 0]; // overhead
    // Offset horizontally by ~1000 km at non-peak — lower altitude.
    return [RADIUS, 1_000_000, 0];
  };
  const out = bestMomentMs(w, [obs], issEcefAtFn);
  assert.equal(out, 30_000);
});

test('bestMomentMs: with two observers, finds best joint instant', () => {
  // Two observers at lon ±10. The "min altitude across observers" is
  // maximized when the ISS is roughly midway above them (lon 0).
  const w = { startMs: 0, endMs: 60_000 };
  const obsA = { latDeg: 0, lonDeg: -10 };
  const obsB = { latDeg: 0, lonDeg: 10 };
  const RADIUS = 6378137;
  // Construct a sequence where peak is at midpoint.
  const issEcefAtFn = (date) => {
    const t = date.getTime();
    // ISS at altitude 400km, longitude varies linearly from -90 to +90
    // across the window — passes overhead lon=0 at t=30_000.
    const lonDeg = -90 + 180 * (t / 60_000);
    const lonRad = lonDeg * Math.PI / 180;
    const r = RADIUS + 400_000;
    return [r * Math.cos(lonRad), r * Math.sin(lonRad), 0];
  };
  const out = bestMomentMs(w, [obsA, obsB], issEcefAtFn);
  // Should land near 30_000 (where lon=0 passes between observers).
  // The 5000ms step grid → answer is at the nearest 5000 multiple.
  assert.equal(out, 30_000);
});
