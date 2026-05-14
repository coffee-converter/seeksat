import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bennettRefractionArcmin, correctRefraction } from '../refraction.js';

const close = (a, b, eps) => Math.abs(a - b) < eps;
const DEG = Math.PI / 180;

test('bennett: zenith refraction is essentially zero', () => {
  const r = bennettRefractionArcmin(90);
  assert.ok(close(r, 0, 0.01), `r=${r}`);
});

test('bennett: 45° altitude ~ 0.96 arcmin (Nautical Almanac)', () => {
  const r = bennettRefractionArcmin(45);
  assert.ok(close(r, 0.96, 0.05), `r=${r}`);
});

test('bennett: 10° altitude ~ 5.3 arcmin', () => {
  const r = bennettRefractionArcmin(10);
  assert.ok(close(r, 5.3, 0.2), `r=${r}`);
});

test('bennett: horizon (0°) ~ 34 arcmin', () => {
  const r = bennettRefractionArcmin(0);
  assert.ok(close(r, 34, 1), `r=${r}`);
});

test('correctRefraction: zenith direction returns unchanged', () => {
  const up = [0, 0, 1];
  const dir = [0, 0, 1];
  const out = correctRefraction(dir, up);
  assert.ok(close(out[0], 0, 1e-9));
  assert.ok(close(out[1], 0, 1e-9));
  assert.ok(close(out[2], 1, 1e-9));
});

test('correctRefraction: 45° apparent altitude is lowered by ~0.96 arcmin', () => {
  const up = [0, 0, 1];
  // dir at altitude 45° in +x direction
  const dir = [Math.cos(45*DEG), 0, Math.sin(45*DEG)];
  const out = correctRefraction(dir, up);
  const newAlt = Math.asin(out[2]) / DEG;
  const expected = 45 - 0.96/60;
  assert.ok(close(newAlt, expected, 0.005), `newAlt=${newAlt}, expected=${expected}`);
});

test('correctRefraction: 10° apparent altitude lowered by ~5.3 arcmin', () => {
  const up = [0, 0, 1];
  const dir = [Math.cos(10*DEG), 0, Math.sin(10*DEG)];
  const out = correctRefraction(dir, up);
  const newAlt = Math.asin(out[2]) / DEG;
  const expected = 10 - 5.3/60;
  assert.ok(close(newAlt, expected, 0.01), `newAlt=${newAlt}, expected=${expected}`);
});

test('correctRefraction: output is unit length', () => {
  const up = [0, 0, 1];
  const dir = [Math.cos(30*DEG), 0, Math.sin(30*DEG)];
  const out = correctRefraction(dir, up);
  const len = Math.hypot(out[0], out[1], out[2]);
  assert.ok(close(len, 1, 1e-9), `len=${len}`);
});
