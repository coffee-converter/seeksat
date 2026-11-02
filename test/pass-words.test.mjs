import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { findPasses } from '../lib/passes/engine.mjs';
import { visualQuality } from '../lib/sky/visual-rating.mjs';
import { passQuality } from '../lib/passes/quality.mjs';
import { ratingShort, passWords, bestPass, riseDopplerHz } from '../lib/passes/pass-words.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { EN52VE, recordFrom } from './fixtures/orbits.mjs';

const ISS = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
const T0 = Date.parse('2026-03-01T12:00:00Z');
const DAY = 86_400_000;

test('ratingShort: cloudy cap, low elevation, Good', () => {
  const cloudy = visualQuality({ peakMag: -3, peakMagSunAltDeg: -20, maxElevDeg: 60 }, { cloud: { level: 'cloudy' } });
  assert.equal(cloudy.cause, 'cloudy');
  assert.equal(ratingShort(cloudy, { maxElevDeg: 60 }, { mode: 'visual' }), 'cloudy');
  const some = visualQuality({ peakMag: -3, peakMagSunAltDeg: -20 }, { cloud: { level: 'some' } });
  assert.equal(ratingShort(some, {}, { mode: 'visual' }), 'some cloud');
  const faint = visualQuality({ peakMag: 3, peakMagSunAltDeg: -20 });
  assert.equal(ratingShort(faint, {}, { mode: 'visual' }), 'faint');
  const twi = visualQuality({ maxElevDeg: 60, peakSunAltDeg: -3 });
  assert.equal(ratingShort(twi, {}, { mode: 'visual' }), 'twilight');
  const low = passQuality({ maxElevDeg: 3.4 });
  assert.equal(ratingShort(low, { maxElevDeg: 3.4 }, { mode: 'radio' }), '3° up');
  const good = visualQuality({ peakMag: -3, peakMagSunAltDeg: -20 });
  assert.equal(good.cause, null);
  assert.equal(ratingShort(good, {}, { mode: 'visual' }), null);
  assert.equal(ratingShort(passQuality({ maxElevDeg: 70 }), { maxElevDeg: 70 }, { mode: 'radio' }), null);
});

// 2026-03-01 18:27 CST = 00:27Z next day
const base = {
  startMs: Date.parse('2026-03-02T00:27:00Z'), peakMs: Date.parse('2026-03-02T00:29:00Z'), endMs: Date.parse('2026-03-02T00:31:00Z'),
  startAzDeg: 315, peakAzDeg: 225, endAzDeg: 135, maxElevDeg: 25.6, startElevDeg: 0, endElevDeg: 20,
};
test('passWords: fades versus sets, exact string in Chicago', () => {
  const clock = (ms, tz) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(ms);
  assert.equal(passWords(base, { timeZone: 'America/Chicago', mode: 'visual', clock }),
    'Rises NW 6:27 PM · peaks 26° SW 6:29 · fades in the SE 6:31');
  assert.equal(passWords({ ...base, endElevDeg: 0.2 }, { timeZone: 'America/Chicago', mode: 'radio', clock }),
    'Rises NW 6:27 PM · peaks 26° SW 6:29 · sets SE 6:31');
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
});

test('riseDopplerHz: positive for a rising ISS pass, under 12 kHz at 437.8 MHz', () => {
  const r = findPasses({ track: ISS, observers: [EN52VE], mode: 'radio', startMs: T0, endMs: T0 + DAY });
  const pass = r.passes.find((x) => !x.inProgress);
  const hz = riseDopplerHz(ISS, EN52VE, pass, 437.8e6);
  assert.ok(hz > 0 && hz < 12_000, String(hz));
});
