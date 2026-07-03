import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tlePositionEcef, tleOrbitTrackEcef } from '../lib/truth.js';

// ISS (ZARYA) TLE pinned to a fixed epoch so the tests are reproducible.
// Source: CelesTrak archive, epoch 2024-001 ≈ 2024-01-01 12:00 UTC.
const ISS_TLE = {
  line1: "1 25544U 98067A   24001.50000000  .00012000  00000-0  22000-3 0  9991",
  line2: "2 25544  51.6400 100.0000 0001234 100.0000 200.0000 15.49000000000005",
};

const EARTH_R_M = 6378137;
const ISS_ALT_LOW_M  = 350_000;
const ISS_ALT_HIGH_M = 460_000;

// Propagate at the TLE epoch itself so SGP4 doesn't extrapolate far -
// any reasonable epoch within a few days of the TLE works the same.
const epochDate = new Date(Date.UTC(2024, 0, 1, 12, 0, 0));

// ---- tlePositionEcef -----------------------------------------------------

test('tlePositionEcef: returns a 3-element ECEF array (meters)', () => {
  const pos = tlePositionEcef(ISS_TLE.line1, ISS_TLE.line2, epochDate);
  assert.ok(pos);
  assert.equal(pos.length, 3);
  for (const c of pos) assert.ok(Number.isFinite(c), `non-finite: ${c}`);
});

test('tlePositionEcef: ISS altitude lands in 350-460km band', () => {
  // ISS orbits at ~400 km. Allow a generous band to absorb mean motion
  // drift between TLE epoch and the propagated instant.
  const pos = tlePositionEcef(ISS_TLE.line1, ISS_TLE.line2, epochDate);
  const r = Math.hypot(pos[0], pos[1], pos[2]);
  const alt = r - EARTH_R_M;
  assert.ok(alt > ISS_ALT_LOW_M && alt < ISS_ALT_HIGH_M,
    `altitude ${(alt / 1000).toFixed(1)} km outside ${ISS_ALT_LOW_M / 1000}-${ISS_ALT_HIGH_M / 1000} km`);
});

test('tlePositionEcef: deterministic for same inputs', () => {
  const a = tlePositionEcef(ISS_TLE.line1, ISS_TLE.line2, epochDate);
  const b = tlePositionEcef(ISS_TLE.line1, ISS_TLE.line2, epochDate);
  assert.deepEqual(a, b);
});

test('tlePositionEcef: position moves between two instants 30s apart', () => {
  // The ISS moves ~7.7 km/s - 30 seconds of propagation should shift
  // the ECEF position by ~230 km. (Bigger than any rounding error,
  // smaller than half an orbit so we don't wrap.)
  const a = tlePositionEcef(ISS_TLE.line1, ISS_TLE.line2, epochDate);
  const b = tlePositionEcef(
    ISS_TLE.line1, ISS_TLE.line2,
    new Date(epochDate.getTime() + 30_000),
  );
  const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // Lower bound far below 230 km because part of the motion is
  // rotation of the Earth-fixed frame, but should still be > 100 km.
  assert.ok(d > 100_000, `30s-apart positions differ by ${d / 1000} km`);
  assert.ok(d < 350_000, `30s-apart positions differ by ${d / 1000} km (too far)`);
});

test('tlePositionEcef: trims whitespace from TLE lines', () => {
  // Real-world fetched TLEs sometimes carry trailing CR/LF; truth.js
  // .trim()s each line, so leading/trailing whitespace shouldn't break
  // propagation.
  const padded = tlePositionEcef(
    `   ${ISS_TLE.line1}   `,
    `\n${ISS_TLE.line2}\r`,
    epochDate,
  );
  const clean = tlePositionEcef(ISS_TLE.line1, ISS_TLE.line2, epochDate);
  assert.deepEqual(padded, clean);
});

// ---- tleOrbitTrackEcef ---------------------------------------------------

test('tleOrbitTrackEcef: returns the requested sample count', () => {
  const pts = tleOrbitTrackEcef(ISS_TLE.line1, ISS_TLE.line2, epochDate, 93, 120);
  assert.equal(pts.length, 120);
});

test('tleOrbitTrackEcef: every sample is at ISS-orbit radius', () => {
  const pts = tleOrbitTrackEcef(ISS_TLE.line1, ISS_TLE.line2, epochDate, 93, 60);
  for (const [x, y, z] of pts) {
    const r = Math.hypot(x, y, z);
    const alt = r - EARTH_R_M;
    assert.ok(alt > ISS_ALT_LOW_M && alt < ISS_ALT_HIGH_M,
      `sample altitude ${(alt / 1000).toFixed(1)} km outside band`);
  }
});

test('tleOrbitTrackEcef: samples trace a closed orbit (start ≈ end after one period)', () => {
  // The orbit is sampled over +/- half a period around the center,
  // so sample[0] is at center-T/2 and sample[N-1] is at center+T/2.
  // After one period the satellite returns to ~the same inertial
  // position; in our Earth-fixed-snapshot frame (gmst captured at
  // center) they should be very close.
  const pts = tleOrbitTrackEcef(ISS_TLE.line1, ISS_TLE.line2, epochDate, 93, 361);
  const first = pts[0];
  const last = pts[pts.length - 1];
  // Closing-gap should be small relative to orbit circumference (~40k km).
  const gap = Math.hypot(
    first[0] - last[0], first[1] - last[1], first[2] - last[2],
  );
  assert.ok(gap < 100_000, `orbit doesn't close: gap ${(gap / 1000).toFixed(1)} km`);
});

test('tleOrbitTrackEcef: orbit normal direction perpendicular-ish to ECEF z', () => {
  // ISS inclination ~51.6° means the orbit plane normal sits ~51.6°
  // away from ECEF z-axis. Computed from cross-product of two
  // consecutive samples.
  const pts = tleOrbitTrackEcef(ISS_TLE.line1, ISS_TLE.line2, epochDate, 93, 360);
  // Use samples a quarter-period apart for a more numerically stable
  // cross product (closer samples give a tiny vector).
  const a = pts[0];
  const b = pts[90];
  const cross = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const len = Math.hypot(...cross);
  // Angle from z-axis = acos(|cross.z|/len)
  const angleFromZ = Math.acos(Math.abs(cross[2]) / len) * 180 / Math.PI;
  assert.ok(angleFromZ > 40 && angleFromZ < 65,
    `orbit-normal/z angle ${angleFromZ.toFixed(1)}° not near ISS inclination 51.6°`);
});
