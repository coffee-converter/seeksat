import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { findPasses } from '../lib/passes/engine.mjs';
import { radioSeries, radioCsvText, chartStepMs, csvStepMs, passFileName } from '../lib/passes/charts.js';
import { CATALOG } from '../lib/catalog.mjs';
import { ISS_LINE1, ISS_LINE2, ISS_OMM } from './fixtures/omm-iss.mjs';
import { MOLNIYA_LINE1, MOLNIYA_LINE2, EN52VE, recordFrom } from './fixtures/orbits.mjs';

const ISS = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
const T0 = Date.parse('2026-03-01T12:00:00Z');
const DAY = 86_400_000;
const MOLNIYA = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M'));
const ISS_WITH_ENTRY = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'), CATALOG.find((c) => c.noradId === 25544));
const firstIssPeakMs = findPasses({ track: ISS, observers: [EN52VE], startMs: T0, endMs: T0 + DAY }).passes[0].peakMs;

test('radio series for an ISS pass keeps today\'s 2 s chart step and is not clamped', () => {
  const b = radioSeries({ track: ISS, obs: EN52VE, anchorMs: firstIssPeakMs, minElevDeg: 10, freqHz: 437_800_000 });
  assert.equal(b.clamped, false);
  const s = b.series.samples;
  assert.equal(s[1].tMs - s[0].tMs, 2000);
});
test('a Molniya radio series is the whole pass at a coarser step', () => {
  const b = radioSeries({ track: MOLNIYA, obs: EN52VE, anchorMs: Date.parse('2023-06-27T07:00:00Z'), minElevDeg: 10, freqHz: 1_000_000_000 });
  assert.equal(b.clamped, false);
  assert.ok(b.series.samples.length <= 1801);
});
test('csv step is 1 s for LEO passes', () => {
  assert.equal(csvStepMs(10 * 60_000), 1000);
  assert.equal(chartStepMs(10 * 60_000), 2000);
  assert.equal(chartStepMs(9 * 3_600_000), 18_000);
});
test('file names are unchanged for the ISS and generic for others', () => {
  const obs = { ...EN52VE, name: 'Home', tz: 'America/Chicago' };
  assert.match(passFileName(ISS_WITH_ENTRY, obs, firstIssPeakMs, 'sky'), /^iss-pass-home-/);
  assert.match(passFileName(ISS_WITH_ENTRY, obs, firstIssPeakMs, 'radio', 'csv'), /^radio-iss-home-.*\.csv$/);
  assert.match(passFileName(MOLNIYA, obs, firstIssPeakMs, 'sky'), /^m-pass-home-/);
});
test('CSV omits TLE lines for an OMM-only track', () => {
  const omm = makeTrack({ noradId: 25544, name: 'ISS', omm: ISS_OMM });
  const b = radioSeries({ track: omm, obs: EN52VE, anchorMs: firstIssPeakMs, minElevDeg: 10, freqHz: 437_800_000, purpose: 'csv' });
  const csv = radioCsvText(b, { track: omm, obs: EN52VE, generatedAtMs: T0, clockSkewMs: 0 });
  assert.ok(!csv.includes('undefined'));
});
