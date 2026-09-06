import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C_LIGHT, retardedState, dopplerHz } from '../lib/pass-finder/doppler.js';
import { observerTemeAt } from '../lib/pass-finder/sat-state.js';

const F = 437.8e6;
const OBS = { r: [6378137, 0, 0], v: [0, 465.1, 0] };

test('approaching satellite gives a HIGHER received frequency', () => {
  // Satellite directly overhead, moving straight at the observer.
  const r = [6378137 + 420000, 0, 0];
  const v = [-7500, 0, 0];
  const d = dopplerHz(r, v, { r: [6378137, 0, 0], v: [0, 0, 0] }, F);
  assert.ok(d > 0, `approaching must be positive, got ${d}`);
  // f * v / c = 437.8e6 * 7500 / 299792458 = 10953 Hz
  assert.ok(Math.abs(d - 10953) < 30, `expected ~10953 Hz, got ${d.toFixed(0)}`);
});

test('receding satellite gives a LOWER received frequency', () => {
  const r = [6378137 + 420000, 0, 0];
  const v = [7500, 0, 0];
  const d = dopplerHz(r, v, { r: [6378137, 0, 0], v: [0, 0, 0] }, F);
  assert.ok(d < 0, `receding must be negative, got ${d}`);
});

test('zero range rate still shows the constant relativistic offset', () => {
  // Purely transverse motion: no first-order Doppler, but time dilation
  // and gravitational potential remain. Net is a small redshift for LEO.
  const r = [6378137 + 420000, 0, 0];
  const v = [0, 7660, 0];
  const d = dopplerHz(r, v, { r: [6378137, 0, 0], v: [0, 0, 0] }, F);
  assert.ok(Math.abs(d) < 1, `should be sub-Hz, got ${d}`);
  assert.ok(d < 0, `LEO net relativistic term is a redshift, got ${d}`);
});

test('exact ratio differs from the first-order linear form by ~0.2 Hz', () => {
  const r = [6378137 + 420000, 0, 0];
  const v = [-7500, 0, 0];
  const exact = dopplerHz(r, v, { r: [6378137, 0, 0], v: [0, 0, 0] }, F);
  const linear = F * (7500 / C_LIGHT);
  const diff = Math.abs(exact - linear);
  assert.ok(diff > 0.05 && diff < 1.0, `expected ~0.2-0.3 Hz, got ${diff}`);
});

test('retardedState converges and returns a light time of the right order', () => {
  // Fake sampler: satellite moving at constant velocity in a straight line.
  const R0 = [6378137 + 420000, 0, 0];
  const V = [0, 7500, 0];
  const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);
  const stateAt = (d) => {
    const dt = (d.getTime() - T0) / 1000;
    return {
      rTeme: [R0[0] + V[0] * dt, R0[1] + V[1] * dt, R0[2] + V[2] * dt],
      vTeme: [...V],
    };
  };
  const out = retardedState(stateAt, T0, [6378137, 0, 0], 0);
  assert.ok(out, 'retardedState returned null');
  // 420 km / c = 1.401 ms
  assert.ok(
    Math.abs(out.tauSec - 420000 / C_LIGHT) < 2e-6,
    `expected ~1.401 ms, got ${(out.tauSec * 1000).toFixed(4)} ms`,
  );
  // The retarded position is BEHIND the instantaneous one along the track.
  assert.ok(out.rTeme[1] < R0[1] + 1e-9, 'retarded position must lag');
});

test('retardedState is not defeated by integer-millisecond Date rounding', () => {
  // JS Date is integer ms, but light time is ~1.4 ms. Naively doing
  // new Date(tMs - tau*1000) truncates 1.4 ms to 1 ms - a 0.4 ms epoch
  // error, ~0.065 m/s of range rate, ~0.095 Hz. The implementation must
  // sample on the ms grid and correct the sub-ms remainder with velocity.
  const R0 = [6378137 + 420000, 0, 0];
  const V = [0, 7500, 0];
  const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);
  const calls = [];
  const stateAt = (d) => {
    calls.push(d.getTime());
    const dt = (d.getTime() - T0) / 1000;
    return {
      rTeme: [R0[0], R0[1] + V[1] * dt, R0[2]],
      vTeme: [...V],
    };
  };
  const out = retardedState(stateAt, T0, [6378137, 0, 0], 0);
  assert.ok(calls.every(Number.isInteger), 'must only sample integer ms');
  // Exact answer: y = -7500 * 1.401e-3 = -10.507 m
  const expectedY = -V[1] * (420000 / C_LIGHT);
  assert.ok(
    Math.abs(out.rTeme[1] - expectedY) < 0.01,
    `sub-ms correction missing: expected y=${expectedY.toFixed(3)}, got ${out.rTeme[1].toFixed(3)}`,
  );
});
