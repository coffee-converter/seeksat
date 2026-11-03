import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { findPasses } from '../lib/passes/engine.mjs';
import { visualQuality } from '../lib/sky/visual-rating.mjs';
import { passQuality } from '../lib/passes/quality.mjs';
import { timeFormat } from '../lib/home/view.mjs';
import { ratingShort, passWords, bestPass, riseDopplerHz } from '../lib/passes/pass-words.mjs';
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

// 2026-03-01 18:27 CST = 00:27Z next day
const base = {
  startMs: Date.parse('2026-03-02T00:27:00Z'), peakMs: Date.parse('2026-03-02T00:29:00Z'), endMs: Date.parse('2026-03-02T00:31:00Z'),
  startAzDeg: 315, peakAzDeg: 225, endAzDeg: 135, maxElevDeg: 25.6, startElevDeg: 0, endElevDeg: 20,
};
test('passWords: fades, sets and drops below', () => {
  const clock = (ms, tz) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(ms);
  const z = { timeZone: 'America/Chicago', clock };
  assert.equal(passWords(base, { ...z, mode: 'visual' }),
    'Rises NW 6:27 PM · peaks 26° SW 6:29 PM · fades in the SE 6:31 PM');
  assert.match(passWords({ ...base, endElevDeg: 0.3 }, { ...z, mode: 'radio' }), /· sets SE 6:31 PM$/);
  assert.match(passWords({ ...base, endElevDeg: 20 }, { ...z, mode: 'radio' }), /· sets SE/);
  assert.match(passWords({ ...base, endElevDeg: 10 }, { ...z, mode: 'radio', minElevDeg: 10 }), /· drops below 10° SE 6:31 PM$/);
  assert.match(passWords({ ...base, runsPastEnd: true }, { ...z, mode: 'visual' }), /· sets SE/);
});
test('passWords: a visual pass that starts mid-sky appears there', () => {
  const clock = (ms, tz) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(ms);
  const z = { timeZone: 'America/Chicago', clock };
  assert.equal(passWords({ ...base, startElevDeg: 14.6 }, { ...z, mode: 'visual' }),
    'Appears 15° NW 6:27 PM · peaks 26° SW 6:29 PM · fades in the SE 6:31 PM');
  // Within 1° of the minimum elevation it still rises (above it); radio always rises.
  assert.match(passWords({ ...base, startElevDeg: 10.8 }, { ...z, mode: 'visual', minElevDeg: 10 }), /^Rises above 10° NW 6:27 PM · /);
  assert.match(passWords({ ...base, startElevDeg: 14.6 }, { ...z, mode: 'radio' }), /^Rises NW 6:27 PM · /);
});
test('passWords: no "peaks" clause when the peak is the start', () => {
  const clock = (ms, tz) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(ms);
  const z = { timeZone: 'America/Chicago', clock, mode: 'visual' };
  // Brightest at shadow exit: the peak time is the start.
  assert.equal(passWords({ ...base, startElevDeg: 25.6, peakMs: base.startMs + 20_000 }, z),
    'Appears 26° NW 6:27 PM · fades in the SE 6:31 PM');
  // Or the peak elevation is within 1° of the start elevation.
  assert.equal(passWords({ ...base, startElevDeg: 25 }, z),
    'Appears 25° NW 6:27 PM · fades in the SE 6:31 PM');
});
test('passWords: a pass already up leads with "Up now"', () => {
  const clock = (ms, tz) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(ms);
  const z = { timeZone: 'America/Chicago', clock };
  // The card's meta line already says "Up now, until 6:31 PM", so the words
  // skip the lead and the end time.
  assert.equal(passWords({ ...base, inProgress: true, startElevDeg: 12 }, { ...z, mode: 'visual' }),
    'peaks 26° SW 6:29 PM · fades in the SE');
  assert.equal(passWords({ ...base, inProgress: true, startElevDeg: 12, endElevDeg: 0 }, { ...z, mode: 'radio' }),
    'peaks 26° SW 6:29 PM · sets SE');
  assert.equal(passWords({ ...base, inProgress: true, startElevDeg: 12, endElevDeg: 5 }, { ...z, mode: 'radio', minElevDeg: 10 }),
    'peaks 26° SW 6:29 PM · drops below 10° SE');
  // Past the peak, the engine's peak is the clamped start: no peak clause.
  assert.equal(passWords({ ...base, inProgress: true, startElevDeg: 25.6, peakMs: base.startMs, endElevDeg: 0 }, { ...z, mode: 'radio' }),
    'sets SE');
});
test('passWords: a minimum elevation start is the cutoff, not the horizon', () => {
  const clock = (ms, tz) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(ms);
  const z = { timeZone: 'America/Chicago', clock };
  assert.equal(passWords({ ...base, endElevDeg: 10 }, { ...z, mode: 'radio', minElevDeg: 10 }),
    'Rises above 10° NW 6:27 PM · peaks 26° SW 6:29 PM · drops below 10° SE 6:31 PM');
  assert.match(passWords(base, { ...z, mode: 'radio', minElevDeg: 0 }), /^Rises NW /);
});
test('passWords: no "peaks" clause when the peak is the end', () => {
  const clock = (ms, tz) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(ms);
  const z = { timeZone: 'America/Chicago', clock, mode: 'radio' };
  assert.equal(passWords({ ...base, peakMs: base.endMs - 20_000 }, z), 'Rises NW 6:27 PM · sets SE 6:31 PM');
  assert.match(passWords({ ...base, peakMs: base.endMs - 60_000 }, z), /peaks/);
});
test('passWords: a pass that rises from the horizon is unchanged', () => {
  const clock = (ms, tz) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(ms);
  assert.equal(passWords({ ...base, endElevDeg: 0 }, { timeZone: 'America/Chicago', clock, mode: 'radio' }),
    'Rises NW 6:27 PM · peaks 26° SW 6:29 PM · sets SE 6:31 PM');
});
test('passWords default clock matches the home cards', () => {
  const out = passWords(base, { timeZone: 'America/Chicago', locale: 'en-US' });
  const f = timeFormat('en-US', 'America/Chicago');
  assert.ok(out.startsWith(`Rises NW ${f.format(base.startMs)} · peaks 26° SW ${f.format(base.peakMs)}`));
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

test('riseDopplerHz: positive for a rising ISS pass, under 12 kHz at 437.8 MHz', () => {
  const r = findPasses({ track: ISS, observers: [EN52VE], mode: 'radio', startMs: T0, endMs: T0 + DAY });
  const pass = r.passes.find((x) => !x.inProgress);
  const hz = riseDopplerHz(ISS, EN52VE, pass, 437.8e6);
  assert.ok(hz > 0 && hz < 12_000, String(hz));
});

test('passWords: startTime false leaves the start time to the Starts column', () => {
  const clock = (ms, tz) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(ms);
  const z = { timeZone: 'America/Chicago', clock, startTime: false };
  assert.equal(passWords({ ...base, startElevDeg: 15 }, { ...z, mode: 'visual' }),
    'Appears 15° NW · peaks 26° SW 6:29 PM · fades in the SE 6:31 PM');
  assert.equal(passWords({ ...base, endElevDeg: 0.3 }, { ...z, mode: 'radio' }),
    'Rises NW · peaks 26° SW 6:29 PM · sets SE 6:31 PM');
  assert.match(passWords(base, { ...z, mode: 'radio', minElevDeg: 10 }), /^Rises above 10° NW · /);
});

test('passWords: startTime false says a pass that appears at its peak does so, not the Max column again', () => {
  const clock = (ms, tz) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(ms);
  const z = { timeZone: 'America/Chicago', clock, mode: 'visual' };
  const atPeak = { ...base, startElevDeg: 35, maxElevDeg: 35, peakMs: base.startMs, peakAzDeg: 135, startAzDeg: 135 };
  assert.equal(passWords(atPeak, { ...z, startTime: false }), 'Appears at its peak · fades in the SE 6:31 PM');
  // With its start time (the satellite page's old rows), it keeps the full clause.
  assert.equal(passWords(atPeak, z), 'Appears 35° SE 6:27 PM · fades in the SE 6:31 PM');
});
