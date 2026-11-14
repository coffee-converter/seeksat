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

test('visualQuality reports the cause of a reduced level', () => {
  const bright = { peakMag: -3, peakMagSunAltDeg: -20, maxElevDeg: 60 };
  assert.equal(visualQuality(bright).cause, null);
  assert.equal(visualQuality(bright, { cloud: { level: 'cloudy' } }).cause, 'cloudy');
  assert.equal(visualQuality(bright, { cloud: { level: 'some' } }).cause, 'some-cloud');
  assert.equal(visualQuality({ peakMag: 3, peakMagSunAltDeg: -20 }).cause, 'faint');
  assert.equal(visualQuality({ maxElevDeg: 60, peakSunAltDeg: -3 }).cause, 'twilight');
  assert.equal(visualQuality({ maxElevDeg: 5, peakSunAltDeg: -20 }).cause, 'low');
});

test('visualQuality gives 1 to 5 bars by headroom, inside its level', () => {
  const bars = (m, o = city) => visualQuality(known(m), o).bars;
  assert.equal(bars(-1.0), 5);
  assert.equal(bars(-0.99), 4);
  assert.equal(bars(0.5), 4);
  assert.equal(bars(0.51), 3);
  assert.equal(bars(2.0), 3);
  assert.equal(bars(2.01), 2);
  assert.equal(bars(3.0), 2);
  assert.equal(bars(3.01), 1);
});

test('cloud and twilight keep the bars inside the reduced level', () => {
  const c = (level) => ({ skyType: 'city', cloud: { level } });
  assert.equal(visualQuality(known(-1.8), c('cloudy')).bars, 1);
  assert.equal(visualQuality(known(-1.8), c('some')).bars, 3);
  assert.equal(visualQuality(known(2.0), c('some')).bars, 2);
  assert.equal(visualQuality(known(2.5), c('some')).bars, 2);
  const p = (maxElevDeg, peakSunAltDeg) => ({ peakMag: null, maxElevDeg, peakSunAltDeg });
  assert.equal(visualQuality(p(65, -15), city).bars, 5);
  assert.equal(visualQuality(p(65, -8), city).bars, 3);
  assert.equal(visualQuality(p(25, -8), city).bars, 2);
  assert.equal(visualQuality(p(5, -15), city).bars, 1);
});

test('an estimated magnitude never rates above Fair, and says it is a guess', async () => {
  const { visualQuality } = await import('../lib/sky/visual-rating.mjs');
  const bright = { peakMag: -3, peakMagSunAltDeg: -20, maxElevDeg: 80, peakSunAltDeg: -20 };
  assert.ok(visualQuality(bright).bars >= 4);
  const guess = visualQuality({ ...bright, peakMagEstimated: true });
  assert.ok(guess.bars <= 2);
  assert.equal(guess.label, 'Fair');
  assert.match(guess.reason, /^Estimated peak mag/);
});

test('a bright pass that stays low or is brief is capped', async () => {
  const { visualQuality } = await import('../lib/sky/visual-rating.mjs');
  // Mag 1.4 under a dark-enough suburban sky: Great on brightness alone.
  const bright = { peakMag: 1.4, peakMagSunAltDeg: -18, durationMs: 180_000 };
  assert.equal(visualQuality({ ...bright, maxElevDeg: 45 }).label, 'Great');
  const low = visualQuality({ ...bright, maxElevDeg: 12 });
  assert.equal(low.label, 'Fair');
  assert.equal(low.level, 'low');
  assert.equal(low.cause, 'low');
  assert.match(low.reason, /stays low \(12° at most\)/);
  const mid = visualQuality({ ...bright, maxElevDeg: 20 });
  assert.equal(mid.label, 'Good');
  assert.match(mid.reason, /fairly low \(20° at most\)/);
  const brief = visualQuality({ ...bright, peakMag: -3, maxElevDeg: 60, durationMs: 50_000 });
  assert.equal(brief.label, 'Good');
  assert.match(brief.reason, /only about 50 seconds/);
  // A faint pass is not lifted by being high.
  assert.equal(visualQuality({ peakMag: 4.2, peakMagSunAltDeg: -18, maxElevDeg: 80, durationMs: 300_000 }).label, 'Poor');
});
