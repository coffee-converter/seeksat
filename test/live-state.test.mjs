import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveState, liveAvailable, clockText, tuneMode } from '../lib/live/live-state.mjs';
import { readFileSync } from 'node:fs';

const s = (tMs, azDeg, elDeg, dopplerHz = 0, rangeM = 1_000_000) => ({ tMs, azDeg, elDeg, dopplerHz, dopplerRateHzPerSec: dopplerHz == null ? null : -1, rangeM });
const pass = [s(0, 200, 10, 1000), s(1000, 210, 20, 0), s(2000, 220, 30, -1000)];

test('liveState interpolates during a pass', () => {
  const r = liveState(pass, 500);
  assert.equal(r.phase, 'during');
  assert.equal(r.elDeg, 15);
  assert.equal(r.azDeg, 205);
  assert.equal(r.dopplerHz, 500);
  assert.equal(r.rateHzPerSec, -1);
  assert.equal(r.rangeKm, 1000);
  assert.equal(r.msToSet, 1500);
});

test('azimuth crosses north the short way', () => {
  const r = liveState([s(0, 350, 10), s(1000, 10, 12)], 500);
  assert.ok(Math.abs(r.azDeg) < 1e-9 || Math.abs(r.azDeg - 360) < 1e-9, `az ${r.azDeg}`);
});

test('before and after', () => {
  const b = liveState(pass, -4000);
  assert.equal(b.phase, 'before');
  assert.equal(b.msToRise, 4000);
  assert.equal(b.azDeg, 200);
  const a = liveState(pass, 2500);
  assert.equal(a.phase, 'after');
  assert.equal(a.azDeg, null);
  assert.equal(a.elDeg, null);
  assert.equal(a.dopplerHz, null);
});

test('peak', () => {
  const p = [s(0, 0, 10), s(1000, 90, 60), s(2000, 180, 10)];
  const r = liveState(p, 200);
  assert.equal(r.peakElDeg, 60);
  assert.equal(r.peakAzDeg, 90);
  assert.equal(r.msToPeak, 800);
  assert.equal(liveState(p, 1500).msToPeak, null);
});

test('no frequency', () => {
  const r = liveState([s(0, 0, 10, null), s(1000, 10, 20, null)], 500);
  assert.equal(r.dopplerHz, null);
  assert.equal(r.rateHzPerSec, null);
});

test('liveAvailable', () => {
  const p = { startMs: 31 * 60_000, endMs: 40 * 60_000 };
  assert.equal(liveAvailable(p, 0), false);
  assert.equal(liveAvailable(p, 60_000), true);
  assert.equal(liveAvailable(p, 35 * 60_000), true);
  assert.equal(liveAvailable(p, 40 * 60_000), false);
});

test('clockText', () => {
  assert.equal(clockText(5000), '0:05');
  assert.equal(clockText(245000), '4:05');
  assert.equal(clockText(3723000), '1:02:03');
  assert.equal(clockText(-1), '0:00');
});

test('tuneMode says what the radio block shows in each phase', () => {
  assert.equal(tuneMode(null, 437.8e6), 'none');
  assert.equal(tuneMode({ phase: 'during', dopplerHz: 100 }, null), 'pick');
  assert.equal(tuneMode({ phase: 'during', dopplerHz: 100 }, 437.8e6), 'tune');
  assert.equal(tuneMode({ phase: 'before', dopplerHz: 100 }, 437.8e6), 'tune');
  assert.equal(tuneMode({ phase: 'before', dopplerHz: null }, 437.8e6), 'waiting');
  assert.equal(tuneMode({ phase: 'after', dopplerHz: null }, 437.8e6), 'over');
});

test('LiveView handles Esc before the page does, and announces only the phase', () => {
  const src = readFileSync(new URL('../components/live/LiveView.tsx', import.meta.url), 'utf8');
  assert.match(src, /addEventListener\("keydown", onKey, \{ capture: true \}\)/);
  assert.doesNotMatch(src, /className="live-view__status" aria-live/);
  assert.match(src, /className="sr-only" aria-live="polite">\{phaseText\}/);
});
