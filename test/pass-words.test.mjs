import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { findPasses } from '../lib/passes/engine.mjs';
import { visualQuality } from '../lib/sky/visual-rating.mjs';
import { passQuality } from '../lib/passes/quality.mjs';
import { ratingShort, passPath, bestPass, dopplerHzAt } from '../lib/passes/pass-words.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { EN52VE, recordFrom } from './fixtures/orbits.mjs';

const ISS = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
const T0 = Date.parse('2026-03-01T12:00:00Z');
const DAY = 86_400_000;

test('ratingShort: cloud, low elevation, Good', () => {
  // Cloud is left to the cloud badge beside it, so the card says it once.
  const cloudy = visualQuality({ peakMag: -3, peakMagSunAltDeg: -20, maxElevDeg: 60 }, { cloud: { level: 'cloudy' } });
  assert.equal(cloudy.cause, 'cloudy');
  assert.equal(ratingShort(cloudy, { maxElevDeg: 60 }, { mode: 'visual' }), null);
  const some = visualQuality({ peakMag: -3, peakMagSunAltDeg: -20 }, { cloud: { level: 'some' } });
  assert.equal(some.cause, 'some-cloud');
  assert.equal(ratingShort(some, {}, { mode: 'visual' }), null);
  const faint = visualQuality({ peakMag: 3.5, peakMagSunAltDeg: -20 });
  assert.equal(faint.label, 'Fair');
  assert.equal(ratingShort(faint, {}, { mode: 'visual' }), 'faint');
  const twi = visualQuality({ maxElevDeg: 25, peakSunAltDeg: -3 });
  assert.equal(twi.label, 'Fair');
  assert.equal(ratingShort(twi, {}, { mode: 'visual' }), 'twilight');
  // From Good (3 bars) up the badge is the word alone; the tooltip says why.
  const good3 = visualQuality({ maxElevDeg: 60, peakSunAltDeg: -3 });
  assert.equal(good3.label, 'Good');
  assert.equal(ratingShort(good3, {}, { mode: 'visual' }), null);
  const low = passQuality({ maxElevDeg: 3.4 });
  // Radio cards already print the max elevation, so a radio badge is just Low.
  assert.equal(ratingShort(low, { maxElevDeg: 3.4 }, { mode: 'radio' }), null);
  assert.equal(ratingShort(passQuality({ maxElevDeg: 20 }), { maxElevDeg: 20 }, { mode: 'radio' }), null);
  // A visual pass that is low in the sky still says how high.
  const lowVis = visualQuality({ maxElevDeg: 5, peakSunAltDeg: -30 });
  assert.equal(lowVis.cause, 'low');
  assert.equal(ratingShort(lowVis, { maxElevDeg: 5 }, { mode: 'visual' }), '5° up');
  const good = visualQuality({ peakMag: -3, peakMagSunAltDeg: -20 });
  assert.equal(good.cause, null);
  assert.equal(ratingShort(good, {}, { mode: 'visual' }), null);
  assert.equal(ratingShort(passQuality({ maxElevDeg: 70 }), { maxElevDeg: 70 }, { mode: 'radio' }), null);
});

const card = (id, passes) => ({ kind: 'pass', noradId: id, name: `S${id}`, passes });
const p = (startMs, maxElevDeg) => ({ startMs, maxElevDeg });
test('bestPass: level then elevation, null when soonest', () => {
  const rate = (c, pass) => passQuality(pass);
  const cards = [card(1, [p(1000, 25), p(5000, 30)]), card(2, [p(2000, 45), p(3000, 80)])];
  assert.equal(bestPass(cards, { rate }).pass.maxElevDeg, 80);
  const ok = [card(1, [p(1000, 25), p(5000, 30)])];
  assert.equal(bestPass(ok, { rate }).pass.startMs, 5000);
  assert.equal(bestPass([card(1, [p(1000, 80), p(2000, 30)])], { rate }), null);
  assert.equal(bestPass([], { rate }), null);
  // A best pass that still rates Low is not worth pointing at.
  assert.equal(bestPass([card(1, [p(1000, 5), p(5000, 8)])], { rate }), null);
});

const P = (over = {}) => ({
  startMs: 0, peakMs: 300_000, endMs: 600_000, startAzDeg: 225, peakAzDeg: 315, endAzDeg: 45,
  maxElevDeg: 31, startElevDeg: 0, endElevDeg: 0, ...over,
});

test('passPath: rises, peaks, sets, each with a compass point and time', () => {
  assert.deepEqual(passPath(P()).map((s) => [s.label, s.dir, s.ms]), [['Rises', 'SW', 0], ['Peaks', 'NW', 300_000], ['Sets', 'NE', 600_000]]);
});

test('passPath: minimum elevation, visual appear and fade, up now, peak at an edge', () => {
  assert.deepEqual(passPath(P(), { minElevDeg: 10 }).map((s) => s.label), ['Above 10°', 'Peaks', 'Below 10°']);
  assert.deepEqual(passPath(P({ startElevDeg: 20, endElevDeg: 15 }), { mode: 'visual' }).map((s) => s.label), ['Appears', 'Peaks', 'Fades']);
  assert.deepEqual(passPath(P({ inProgress: true })).map((s) => s.label), ['Peaks', 'Sets']);
  assert.deepEqual(passPath(P({ peakMs: 10_000 })).map((s) => s.label), ['Rises', 'Sets']);
});

test('passPath: given the time, a pass that has started has no first step, whatever the engine flag', () => {
  assert.deepEqual(passPath(P(), { nowMs: -1 }).map((s) => s.label), ['Rises', 'Peaks', 'Sets']);
  assert.deepEqual(passPath(P(), { nowMs: 1 }).map((s) => s.label), ['Peaks', 'Sets']);
  assert.deepEqual(passPath(P({ inProgress: true }), { nowMs: -1 }).map((s) => s.label), ['Peaks', 'Sets']);
});

test('dopplerHzAt: positive approaching at rise, negative receding at set, under 12 kHz at 437.8 MHz', () => {
  const pass = findPasses({ track: ISS, observers: [EN52VE], mode: 'radio', startMs: T0, endMs: T0 + DAY }).passes.find((x) => !x.inProgress);
  const hz = 437_800_000;
  const rise = dopplerHzAt(ISS, EN52VE, pass.startMs, hz);
  assert.ok(rise > 0 && dopplerHzAt(ISS, EN52VE, pass.endMs - 1000, hz) < 0);
  assert.ok(rise < 12_000);
});
