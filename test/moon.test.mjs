import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  moonPositionEci, moonPositionEcef,
  moonPhaseAngle, moonIlluminatedFraction,
} from '../lib/pass-finder/moon.js';

const close = (a, b, eps) => Math.abs(a - b) < eps;
const unitLen = (v) => Math.hypot(v[0], v[1], v[2]);

// ---- moonPositionEci/Ecef: shape sanity ---------------------------------

test('moonPositionEci: returns a 3-element array', () => {
  const v = moonPositionEci(new Date('2025-06-15T00:00:00Z'));
  assert.equal(v.length, 3);
  for (const c of v) assert.equal(typeof c, 'number');
});

test('moonPositionEci: returns approximately a unit vector', () => {
  // The function projects (cos lat × cos lon, cos lat × sin lon, sin lat)
  // through the ecliptic→equatorial rotation, both length-preserving. Any
  // deviation from 1 reflects accumulated float error, not real distance.
  const v = moonPositionEci(new Date('2025-06-15T00:00:00Z'));
  assert.ok(close(unitLen(v), 1, 1e-9), `len=${unitLen(v)}`);
});

test('moonPositionEci: deterministic for same input', () => {
  const d = new Date('2025-03-21T12:00:00Z');
  const a = moonPositionEci(d);
  const b = moonPositionEci(d);
  assert.deepEqual(a, b);
});

test('moonPositionEcef: returns a unit vector', () => {
  const v = moonPositionEcef(new Date('2025-06-15T00:00:00Z'));
  assert.ok(close(unitLen(v), 1, 1e-9), `len=${unitLen(v)}`);
});

test('moonPositionEcef: differs from ECI (GMST rotation applied)', () => {
  // ECEF and ECI agree only when GMST = 0. For nearly any real date they
  // should differ noticeably (the moon moves ~15°/day in RA, Earth rotates
  // ~360°/day, so the two frames diverge in x/y).
  const d = new Date('2025-06-15T12:00:00Z'); // noon UT, GMST ~ 4h
  const eci = moonPositionEci(d);
  const ecef = moonPositionEcef(d);
  const dx = Math.abs(eci[0] - ecef[0]);
  const dy = Math.abs(eci[1] - ecef[1]);
  assert.ok(dx + dy > 0.01, `dx+dy=${dx + dy}`);
});

// ---- moonPhaseAngle: full-moon / new-moon checkpoints -------------------

// Phase angle definition:
//   0   → full moon (sun behind earth/observer)
//   π/2 → quarter
//   π   → new moon (sun behind moon)

test('moonPhaseAngle: returns [0, π]', () => {
  for (const ms of [
    Date.UTC(2025, 0, 1),
    Date.UTC(2025, 5, 15),
    Date.UTC(2025, 9, 30),
    Date.UTC(2026, 2, 14),
  ]) {
    const i = moonPhaseAngle(new Date(ms));
    assert.ok(i >= 0 && i <= Math.PI, `${new Date(ms).toISOString()}: i=${i}`);
  }
});

test('moonPhaseAngle: 2024-06-22 (full moon) phase angle near 0', () => {
  // NASA: full moon at 2024-06-22 01:08 UTC.
  const d = new Date('2024-06-22T01:08:00Z');
  const i = moonPhaseAngle(d);
  // Low-precision ephemeris - accept within ~5° (≈ 0.087 rad).
  assert.ok(i < 0.09, `phase angle ${i} rad should be near 0 for full moon`);
});

test('moonPhaseAngle: 2024-07-05 (new moon) phase angle near π', () => {
  // NASA: new moon at 2024-07-05 22:57 UTC.
  const d = new Date('2024-07-05T22:57:00Z');
  const i = moonPhaseAngle(d);
  assert.ok(Math.PI - i < 0.09, `phase angle ${i} rad should be near π for new moon`);
});

test('moonPhaseAngle: 2024-07-13 (first quarter) phase angle near π/2', () => {
  // NASA: first quarter at 2024-07-13 22:48 UTC.
  const d = new Date('2024-07-13T22:48:00Z');
  const i = moonPhaseAngle(d);
  assert.ok(Math.abs(i - Math.PI / 2) < 0.09,
    `phase angle ${i} rad should be near π/2 for first quarter`);
});

// ---- moonIlluminatedFraction: 0..1 paired with phase --------------------

test('moonIlluminatedFraction: full moon ≈ 1', () => {
  const f = moonIlluminatedFraction(new Date('2024-06-22T01:08:00Z'));
  assert.ok(f > 0.99, `f=${f}`);
});

test('moonIlluminatedFraction: new moon ≈ 0', () => {
  const f = moonIlluminatedFraction(new Date('2024-07-05T22:57:00Z'));
  assert.ok(f < 0.01, `f=${f}`);
});

test('moonIlluminatedFraction: first quarter ≈ 0.5', () => {
  const f = moonIlluminatedFraction(new Date('2024-07-13T22:48:00Z'));
  assert.ok(Math.abs(f - 0.5) < 0.05, `f=${f}`);
});

test('moonIlluminatedFraction: monotonic from new to full', () => {
  // Sample the lunar cycle from new (2024-07-05) toward full (2024-07-21).
  // Illumination should monotonically rise (within ephemeris noise).
  const newMoon = new Date('2024-07-05T22:57:00Z').getTime();
  const samples = [];
  for (let i = 0; i <= 8; i++) {
    const t = newMoon + i * 2 * 86400_000; // every 2 days
    samples.push(moonIlluminatedFraction(new Date(t)));
  }
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i] >= samples[i - 1] - 0.02,
      `non-monotonic at sample ${i}: ${samples[i - 1]} → ${samples[i]}`);
  }
  // First sample is the new moon (~0), last is approaching full (>0.9).
  assert.ok(samples[0] < 0.05);
  assert.ok(samples[samples.length - 1] > 0.9);
});

test('moonIlluminatedFraction: deterministic for same input', () => {
  const d = new Date('2025-09-15T03:14:00Z');
  assert.equal(moonIlluminatedFraction(d), moonIlluminatedFraction(d));
});
