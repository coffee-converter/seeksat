import test from 'node:test';
import assert from 'node:assert/strict';
import { naturalSkyLimMag } from '../lib/pass-finder/sky-helpers.js';
import { SKY_TYPES, DEFAULT_SKY, limitingMag, extinctionMag, visualQuality, formatMag } from '../lib/sky/visual-rating.mjs';

const known = (peakMag, peakMagSunAltDeg = -30) => ({ peakMag, peakMagSunAltDeg, maxElevDeg: 50, peakSunAltDeg: peakMagSunAltDeg });
const city = { skyType: 'city', cloud: null };

test('sky types and default', () => {
  assert.deepEqual(SKY_TYPES.map((s) => s.limit), [3.5, 4.5, 5.5, 6.5]);
  assert.equal(DEFAULT_SKY, 'suburban');
});

test('limitingMag is capped by the sky type', () => {
  assert.equal(limitingMag(-12, 'city'), 3.5);
  assert.equal(limitingMag(-40, 'dark'), naturalSkyLimMag(-40));
  assert.equal(limitingMag(-40, 'nonsense'), 4.5);
});

test('extinctionMag floors elevation at 5 degrees', () => {
  assert.ok(Math.abs(extinctionMag(90)) < 1e-9);
  assert.equal(extinctionMag(1), extinctionMag(5));
  assert.ok(extinctionMag(30) > 0);
});

test('city ISS at full dark is Good, Hubble at sun -12 is OK', () => {
  assert.equal(visualQuality(known(-1.8), city).level, 'good');
  assert.equal(visualQuality(known(2.0, -12), city).level, 'ok');
});

test('headroom boundaries', () => {
  assert.equal(visualQuality(known(0.5), city).level, 'good');
  assert.equal(visualQuality(known(0.51), city).level, 'ok');
  assert.equal(visualQuality(known(2.0), city).level, 'ok');
  assert.equal(visualQuality(known(2.01), city).level, 'low');
});

test('unknown magnitude uses elevation and sky darkness', () => {
  const p = (maxElevDeg, peakSunAltDeg) => ({ peakMag: null, maxElevDeg, peakSunAltDeg });
  assert.equal(visualQuality(p(45, -15), city).level, 'good');
  assert.equal(visualQuality(p(45, -8), city).level, 'ok');
  assert.equal(visualQuality(p(15, -8), city).level, 'low');
});

test('a missing Sun altitude is no evidence of darkness', () => {
  const p = (peakSunAltDeg) => ({ peakMag: null, maxElevDeg: 45, peakSunAltDeg });
  for (const alt of [null, undefined, NaN, Infinity, '-20']) {
    assert.equal(visualQuality(p(alt), city).level, 'ok', String(alt));
  }
  const noSun = { maxElevDeg: 45 };
  assert.equal(visualQuality(noSun, city).level, 'ok');
});

test('a known magnitude with no Sun altitude falls back to the unknown path', () => {
  for (const alt of [null, undefined, NaN]) {
    const q = visualQuality({ peakMag: -1.8, peakMagSunAltDeg: alt, maxElevDeg: 45, peakSunAltDeg: -30 }, city);
    assert.equal(q.level, 'good', String(alt));
    assert.equal(q.reason, 'Brightness unknown, so this is rated on height and sky darkness.');
  }
  const bright = visualQuality({ peakMag: -1.8, peakMagSunAltDeg: undefined, maxElevDeg: 45, peakSunAltDeg: -8 }, city);
  assert.equal(bright.level, 'ok');
});

test('cloud caps or steps the rating', () => {
  const c = (level) => ({ skyType: 'city', cloud: { level } });
  assert.equal(visualQuality(known(-1.8), c('cloudy')).level, 'low');
  assert.equal(visualQuality(known(-1.8), c('some')).level, 'ok');
  assert.equal(visualQuality(known(2.0, -12), c('some')).level, 'low');
  assert.equal(visualQuality(known(-1.8), c('clear')).level, 'good');
  assert.equal(visualQuality(known(-1.8), { skyType: 'city' }).level, 'good');
});

test('reason strings', () => {
  assert.equal(
    visualQuality(known(-2.1), { skyType: 'suburban', cloud: null }).reason,
    'Peak mag −2.1, about 7 magnitudes brighter than the faintest stars you can see.',
  );
  assert.equal(
    visualQuality(known(2.0, -12), { skyType: 'city', cloud: { level: 'some' } }).reason,
    'Peak mag 2.0, about 2 magnitudes brighter than the faintest stars you can see. Some cloud forecast.',
  );
  assert.match(visualQuality(known(2.5, -12), city).reason, /about 1 magnitude brighter/);
  const unk = { peakMag: null, maxElevDeg: 45, peakSunAltDeg: -15 };
  assert.equal(visualQuality(unk, city).reason, 'Brightness unknown, so this is rated on height and sky darkness.');
  assert.equal(
    visualQuality(unk, { skyType: 'city', cloud: { level: 'cloudy' } }).reason,
    'Brightness unknown, so this is rated on height and sky darkness. Cloudy forecast.',
  );
});

test('formatMag', () => {
  assert.equal(formatMag(-2.1), '−2.1');
  assert.equal(formatMag(0.5), '0.5');
});

test('reason wording near the faintest visible stars', () => {
  // City sky at full dark: the faintest stars you can see are mag 3.5.
  assert.equal(visualQuality(known(3.1), city).reason,
    'Peak mag 3.1, about as bright as the faintest stars you can see.');
  assert.equal(visualQuality(known(3.5), city).reason,
    'Peak mag 3.5, no brighter than the faintest stars you can see.');
  assert.equal(visualQuality(known(4.0), city).reason,
    'Peak mag 4.0, no brighter than the faintest stars you can see.');
  assert.match(visualQuality(known(2.9), city).reason, /about 1 magnitude brighter/);
});
