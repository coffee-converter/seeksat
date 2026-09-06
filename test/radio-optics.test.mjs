import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  angularRateDegPerSec, apparentDirEcef, relSignalDb, absoluteFsplDb,
} from '../lib/pass-finder/radio-optics.js';

const unit = (v) => { const n = Math.hypot(...v); return [v[0]/n, v[1]/n, v[2]/n]; };

test('angular rate is non-zero through the exact zenith', () => {
  // THE regression test for this module. Decomposing angular rate into
  // alt/az components returns 0.0000 deg/s at the zenith because azimuth is
  // singular there - on a perfect overhead pass, which is the single most
  // interesting pass. Unit vectors have no such singularity.
  const up = [1, 0, 0];
  const eps = 0.00894; // ~0.512 deg of travel
  const u1 = unit([1, -eps, 0]);
  const u2 = unit([1, +eps, 0]);
  const w = angularRateDegPerSec(u1, u2, 1.0);
  assert.ok(w > 0.5, `zenith angular rate must be non-zero, got ${w}`);
  assert.ok(Math.abs(w - 1.024) < 0.02, `expected ~1.024 deg/s, got ${w}`);
  // Sanity: the pair straddles the zenith.
  assert.ok(Math.abs(u1[0] - up[0]) < 1e-3);
});

test('angular rate is stable for very small angles', () => {
  // arccos(dot) loses precision near 1; atan2(|cross|, dot) does not.
  const u1 = unit([1, -1e-7, 0]);
  const u2 = unit([1, +1e-7, 0]);
  const w = angularRateDegPerSec(u1, u2, 1.0);
  const expected = (2e-7) * 180 / Math.PI;
  assert.ok(Math.abs(w - expected) / expected < 1e-3, `got ${w}, want ${expected}`);
});

test('apparentDirEcef raises a low object toward the zenith', () => {
  // Refraction makes objects appear HIGHER. At a geometric altitude of 1.5
  // deg the lift is roughly 0.3 deg.
  const up = [0, 0, 1];
  const geomAlt = 1.5 * Math.PI / 180;
  const dir = [Math.cos(geomAlt), 0, Math.sin(geomAlt)];
  const app = apparentDirEcef(dir, up);
  const appAlt = Math.asin(app[2]) * 180 / Math.PI;
  assert.ok(appAlt > 1.5, `must be raised, got ${appAlt}`);
  assert.ok(appAlt < 2.2, `raised too far, got ${appAlt}`);
  assert.ok(Math.abs(Math.hypot(...app) - 1) < 1e-12, 'must stay a unit vector');
});

test('apparentDirEcef leaves a zenith direction alone', () => {
  const up = [0, 0, 1];
  const app = apparentDirEcef([0, 0, 1], up);
  assert.ok(Math.abs(app[2] - 1) < 1e-9, `zenith must not move, got ${app}`);
});

test('apparentDirEcef preserves azimuth (refraction is purely vertical)', () => {
  const up = [0, 0, 1];
  const geomAlt = 10 * Math.PI / 180;
  const az = 1.1;
  const dir = [Math.cos(geomAlt) * Math.cos(az), Math.cos(geomAlt) * Math.sin(az), Math.sin(geomAlt)];
  const app = apparentDirEcef(dir, up);
  assert.ok(Math.abs(Math.atan2(app[1], app[0]) - az) < 1e-9);
});

test('relSignalDb is 0 at the peak and negative elsewhere', () => {
  assert.equal(relSignalDb(420000, 420000), 0);
  const edge = relSignalDb(1492000, 420000);
  assert.ok(edge < 0);
  // -20 log10(1492/420) = -11.0 dB
  assert.ok(Math.abs(edge + 11.0) < 0.1, `expected ~-11.0 dB, got ${edge}`);
});

test('absoluteFsplDb matches the standard free-space figure', () => {
  // 20 log10(4 pi r f / c) at 420 km on 437.8 MHz = 137.7 dB
  const v = absoluteFsplDb(420000, 437.8e6);
  assert.ok(Math.abs(v - 137.7) < 0.1, `expected ~137.7 dB, got ${v}`);
});
