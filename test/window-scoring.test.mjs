import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localTimeScore, worstLocalTimeScore, cloudRange, bestMomentMs,
} from '../lib/pass-finder/window-scoring.js';

const close = (a, b, eps) => Math.abs(a - b) < eps;

// ---- localTimeScore: time-of-day preference curve -----------------------

test('localTimeScore: prime evening (7-11pm) is 1.0', () => {
  assert.equal(localTimeScore(19), 1.0);
  assert.equal(localTimeScore(20), 1.0);
  assert.equal(localTimeScore(22.99), 1.0);
});

test('localTimeScore: ramps from 1.0 → 0.7 between 11pm and midnight', () => {
  assert.equal(localTimeScore(23), 1.0);
  assert.ok(close(localTimeScore(23.5), 1.0 - 0.5 * 0.3, 1e-9));
});

test('localTimeScore: dead-of-night trough (4-5am) is 0.25', () => {
  assert.equal(localTimeScore(4), 0.25);
  assert.equal(localTimeScore(4.5), 0.25);
});

test('localTimeScore: dawn ramp (5 → 6.99am) climbs from 0.25 toward 0.7', () => {
  assert.equal(localTimeScore(5), 0.25);
  // Branch is `h >= 5 && h < 7` (exclusive at 7); h=6.99 sits just below
  // the cap. h=7 itself falls through to the daytime default (0.5).
  assert.ok(close(localTimeScore(6.99), 0.25 + 1.99 * 0.225, 0.001));
  assert.equal(localTimeScore(7), 0.5);
});

test('localTimeScore: dusk (6-7pm) reads as 0.85', () => {
  assert.equal(localTimeScore(18), 0.85);
});

test('localTimeScore: handles negative hours (wraps mod 24)', () => {
  assert.equal(localTimeScore(-1), localTimeScore(23));
  assert.equal(localTimeScore(-24), localTimeScore(0));
});

test('localTimeScore: handles hours > 24 (wraps mod 24)', () => {
  assert.equal(localTimeScore(25), localTimeScore(1));
  assert.equal(localTimeScore(43), localTimeScore(19));
});

// ---- worstLocalTimeScore: worst-observer aggregation --------------------

test('worstLocalTimeScore: empty observers returns 1.0', () => {
  assert.equal(worstLocalTimeScore(Date.now(), []), 1.0);
});

test('worstLocalTimeScore: single observer at prime evening returns 1.0', () => {
  // Pick UTC moment where observer at lon=0 sees 20:00 local.
  // utcHour + lon/15 = local. lon=0 → local = utcHour. Want local=20.
  const d = new Date(Date.UTC(2025, 0, 1, 20, 0, 0));
  const score = worstLocalTimeScore(d.getTime(), [{ lonDeg: 0 }]);
  assert.equal(score, 1.0);
});

test('worstLocalTimeScore: two observers — east + west — worst wins', () => {
  // UTC=23:00. Observer at lon=0 sees 23:00 (score ≈ 1.0).
  // Observer at lon=-75 (US East-ish) sees ~18:00 (score 0.85).
  // Worst = 0.85.
  const d = new Date(Date.UTC(2025, 0, 1, 23, 0, 0));
  const score = worstLocalTimeScore(d.getTime(), [
    { lonDeg: 0 },
    { lonDeg: -75 },
  ]);
  assert.equal(score, 0.85);
});

test('worstLocalTimeScore: 3am observer drags the joint score down', () => {
  // UTC=03:00 → observer at lon=0 is at 3am local. The 1-4am branch
  // descends 0.5 → 0.25, so at h=3: 0.5 - (3-1)*0.083 ≈ 0.334.
  // Add an evening observer at lon=-105 → local = -4 → wraps to 20 (1.0).
  const d = new Date(Date.UTC(2025, 0, 1, 3, 0, 0));
  const score = worstLocalTimeScore(d.getTime(), [
    { lonDeg: 0 },
    { lonDeg: -105 },
  ]);
  assert.ok(close(score, 0.5 - (3 - 1) * 0.083, 0.01), `score=${score}`);
});

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
