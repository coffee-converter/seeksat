import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunPositionEci, sunPositionEcef } from '../pass-finder/sun.js';

const close = (a, b, eps) => Math.abs(a - b) < eps;

test('sunPositionEci: vernal equinox 2026 has declination ~0 and RA ~0', () => {
  // March 20 2026 ~14:46 UTC — boreal equinox
  const v = sunPositionEci(new Date(Date.UTC(2026, 2, 20, 14, 46, 0)));
  const len = Math.hypot(v[0], v[1], v[2]);
  // Declination = asin(z/len)
  const decDeg = Math.asin(v[2] / len) * 180 / Math.PI;
  assert.ok(close(decDeg, 0, 0.5), `dec=${decDeg}`);
  // RA = atan2(y, x), should be near 0 at equinox
  const raDeg = Math.atan2(v[1], v[0]) * 180 / Math.PI;
  assert.ok(close(raDeg, 0, 1), `ra=${raDeg}`);
});

test('sunPositionEci: June solstice declination ~+23.4°', () => {
  // June 21 2026 ~02:25 UTC
  const v = sunPositionEci(new Date(Date.UTC(2026, 5, 21, 2, 25, 0)));
  const len = Math.hypot(v[0], v[1], v[2]);
  const decDeg = Math.asin(v[2] / len) * 180 / Math.PI;
  assert.ok(close(decDeg, 23.44, 0.5), `dec=${decDeg}`);
});

test('sunPositionEci: December solstice declination ~-23.4°', () => {
  const v = sunPositionEci(new Date(Date.UTC(2026, 11, 21, 16, 0, 0)));
  const len = Math.hypot(v[0], v[1], v[2]);
  const decDeg = Math.asin(v[2] / len) * 180 / Math.PI;
  assert.ok(close(decDeg, -23.44, 0.5), `dec=${decDeg}`);
});

test('sunPositionEci: returned vector is unit-length (or close to 1 AU)', () => {
  const v = sunPositionEci(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
  const len = Math.hypot(v[0], v[1], v[2]);
  // Returned in unit form (direction)
  assert.ok(close(len, 1, 1e-6), `len=${len}`);
});

test('sunPositionEcef: differs from ECI by a Z-axis rotation', () => {
  // Same time, ECI and ECEF should be related by R_z(GMST)
  const d = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
  const eci = sunPositionEci(d);
  const ecef = sunPositionEcef(d);
  // Z component is invariant under rotation around Z
  assert.ok(close(eci[2], ecef[2], 1e-9));
  // Horizontal magnitudes preserved
  const horizEci = Math.hypot(eci[0], eci[1]);
  const horizEcef = Math.hypot(ecef[0], ecef[1]);
  assert.ok(close(horizEci, horizEcef, 1e-9));
});
