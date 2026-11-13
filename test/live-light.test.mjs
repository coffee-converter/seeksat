import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightTimeline, lightAt } from '../lib/live/light.mjs';
import { dopplerCurve } from '../lib/live/doppler-curve.mjs';
import { sunPositionEcef } from '../lib/pass-finder/sun.js';

const L = (tMs, lit, mag) => ({ tMs, lit, mag });

test('lightAt: sunlit, interpolated magnitude, and when it fades', () => {
  const tl = [L(0, 1, -2), L(2000, 1, -3), L(4000, 1, -2), L(6000, 0, null), L(8000, 0, null)];
  const r = lightAt(tl, 1000);
  assert.equal(r.lit, true);
  assert.equal(r.mag, -2.5);
  // The shadow starts between 4 s and 6 s: called the middle.
  assert.equal(r.msToShadow, 4000);
});

test('lightAt: in shadow has no magnitude and no fade', () => {
  const tl = [L(0, 1, -2), L(2000, 0, null), L(4000, 0, null)];
  assert.deepEqual(lightAt(tl, 3000), { lit: false, mag: null, msToShadow: null });
});

test('lightAt: lit to the end has no fade; outside the pass is null', () => {
  const tl = [L(0, 1, -1), L(2000, 1, -1)];
  assert.equal(lightAt(tl, 1000).msToShadow, null);
  assert.equal(lightAt(tl, -1), null);
  assert.equal(lightAt(tl, 2001), null);
  assert.equal(lightAt([], 0), null);
});

test('lightAt: lit without a standard magnitude', () => {
  const tl = [L(0, 1, null), L(2000, 1, null)];
  assert.deepEqual(lightAt(tl, 500), { lit: true, mag: null, msToShadow: null });
});

test('lightTimeline: sunlit on the Sun side, shadowed behind Earth', () => {
  const T = Date.UTC(2026, 10, 13, 0, 33);
  const obs = { latDeg: 41.88, lonDeg: -87.63, elevM: 180 };
  // Toward the Sun for the first 4 s, then straight behind Earth.
  const track = {
    standardMag: -1.8,
    ecefAt: (d) => {
      const s = sunPositionEcef(d);
      const k = d.getTime() - T < 4000 ? 6_800_000 : -6_800_000;
      return [s[0] * k, s[1] * k, s[2] * k];
    },
  };
  const tl = lightTimeline(track, obs, T, T + 9000);
  assert.deepEqual(tl.map((p) => p.tMs - T), [0, 2000, 4000, 6000, 8000, 9000]);
  assert.equal(tl[0].lit, 1);
  assert.equal(tl[3].lit, 0);
  assert.equal(tl[3].mag, null);
  assert.equal(lightTimeline({ ...track, standardMag: null }, obs, T, T + 2000)[0].mag, null);
});

const D = (tMs, dopplerHz) => ({ tMs, dopplerHz });

test('dopplerCurve: zero across the middle, scaled to the largest shift', () => {
  const c = dopplerCurve([D(0, 1000), D(500, 0), D(1000, -500)], { width: 100, height: 40, pad: 0 });
  assert.equal(c.points, '0.0,0.0 50.0,20.0 100.0,30.0');
  assert.equal(c.maxHz, 1000);
  assert.equal(c.zeroY, 20);
  assert.deepEqual(c.at(250), { x: 25, y: 10 });
  assert.deepEqual(c.at(1000), { x: 100, y: 30 });
});

test('dopplerCurve: no now marker outside the pass, null without Doppler', () => {
  const c = dopplerCurve([D(0, 1), D(10, -1)], { width: 10, height: 10 });
  assert.equal(c.at(20), null);
  assert.equal(c.at(-1), null);
  assert.equal(dopplerCurve([D(0, null), D(10, null)], { width: 10, height: 10 }), null);
  assert.equal(dopplerCurve([D(0, 0), D(10, 0)], { width: 10, height: 10 }), null);
});

test('dopplerCurve: thins a long pass to about 120 points', () => {
  const many = Array.from({ length: 900 }, (_, i) => D(i * 1000, 3000 - i * 6));
  const c = dopplerCurve(many, { width: 200, height: 40 });
  const n = c.points.split(' ').length;
  assert.ok(n <= 121 && n >= 100, `${n}`);
  assert.ok(c.points.endsWith('200.0,' + (20 - ((3000 - 899 * 6) / 3000) * 18).toFixed(1)));
});
