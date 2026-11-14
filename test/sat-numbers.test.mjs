import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { liveNumbers, orbitElements, elementAge, formatNumber, periodText, relativeTime } from '../lib/sat/numbers.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { MOLNIYA_LINE1, MOLNIYA_LINE2, GOES16_LINE1, GOES16_LINE2, recordFrom } from './fixtures/orbits.mjs';

const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
const ISS_T0 = Date.parse('2026-03-01T12:00:00Z');
const goes = makeTrack(recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'));
const GOES_T0 = Date.parse('2026-10-31T15:00:00Z');
const MOLNIYA_T0 = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M')).epochMs + 86_400_000;

test('Molniya speed agrees with vis-viva to better than 1% around the orbit (spec success test)', () => {
  const m = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'MOLNIYA 1-91'));
  for (let i = 0; i < 24; i++) {
    const n = liveNumbers(m, new Date(MOLNIYA_T0 + (i * m.periodMs) / 24));
    assert.ok(Math.abs(n.speedKmS - n.visVivaSpeedKmS) / n.visVivaSpeedKmS < 0.01);
    assert.ok(Math.abs(n.v2rOverGM - n.visViva) < 0.02);
  }
});
test('Molniya mean elements', () => {
  const e = orbitElements(makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M')));
  assert.ok(e.perigeeAltKm > 1150 && e.perigeeAltKm < 1350);
  assert.ok(e.apogeeAltKm > 33400 && e.apogeeAltKm < 33800);
});
test('ISS: altitude, inertial speed and a lower ground speed', () => {
  const n = liveNumbers(iss, new Date(ISS_T0));
  assert.ok(n.altitudeKm > 380 && n.altitudeKm < 450);
  assert.ok(n.speedKmS > 7.6 && n.speedKmS < 7.7);
  assert.ok(n.groundSpeedKmS > 6.7 && n.groundSpeedKmS < 7.5);
});
test('GEO barely moves over the ground', () => {
  const n = liveNumbers(goes, new Date(GOES_T0));
  assert.ok(n.groundSpeedKmS < 0.05 && Math.abs(n.speedKmS - 3.07) < 0.02);
});
test('elements that do not propagate give no live numbers', () => {
  assert.equal(liveNumbers({ stateAt: () => null }, new Date()), null);
});
test('elementAge', () => {
  const E = Date.parse('2026-11-01T00:00:00Z'), H = 3_600_000;
  assert.deepEqual(elementAge(E, E + 2.3 * 24 * H), { ageDays: 2.3, level: 'fresh', text: 'Elements are 2.3 days old' });
  assert.equal(elementAge(E, E + 8 * 24 * H).level, 'old');
  assert.equal(elementAge(E, E + 15 * 24 * H).level, 'stale');
  assert.equal(elementAge(E, E + 5 * H).text, 'Elements are 5 hours old');
  assert.equal(elementAge(E, E - H).text, 'Elements are less than an hour old');
});
test('elementAge with no finite epoch is unknown and stale', () => {
  for (const bad of [null, undefined, NaN]) {
    assert.deepEqual(elementAge(bad, Date.parse('2026-11-01T00:00:00Z')), { ageDays: null, level: 'stale', text: 'Element age unknown' });
  }
});
test('formatNumber is en-US whatever the process locale', () => {
  assert.equal(formatNumber(12345.678, 1), '12,345.7');
  assert.equal(formatNumber(NaN, 2), 'n/a');
});
test('formatNumber never prints a negative zero', () => {
  assert.equal(formatNumber(-0.01, 1), '0.0');
  assert.equal(formatNumber(-1.5, 1), '-1.5');
});
test('periodText rounds total minutes before splitting hours', () => {
  assert.equal(periodText(92.87), '92.87 min');
  assert.equal(periodText(719.7), '719.70 min (12 h 0 min)');
  assert.equal(periodText(1436.1), '1,436.10 min (23 h 56 min)');
  assert.equal(periodText(3030.9), '3,030.90 min (2 d 3 h)');
  assert.equal(periodText(2879.9), '2,879.90 min (48 h 0 min)');
});
test('relativeTime', () => {
  const M = 60_000, H = 60 * M, D = 24 * H;
  assert.equal(relativeTime(0, 30_000), 'just now');
  assert.equal(relativeTime(0, 5 * M), '5 min ago');
  assert.equal(relativeTime(0, 3 * H), '3 h ago');
  assert.equal(relativeTime(0, D + H), '1 day ago');
  assert.equal(relativeTime(0, 2 * D), '2 days ago');
});

test('periodShort: minutes, then hours, then days, never a carried 60', async () => {
  const { periodShort } = await import('../lib/sat/numbers.mjs');
  assert.equal(periodShort(92.87), '92.9 min');
  assert.equal(periodShort(119.94), '119.9 min');
  assert.equal(periodShort(119.96), '2 h');
  assert.equal(periodShort(719.7), '12 h');
  assert.equal(periodShort(1436.1), '23 h 56 min');
  assert.equal(periodShort(2879.6), '2.0 days');
  assert.equal(periodShort(3030.9), '2.1 days');
  assert.equal(periodShort(13.7 * 1440), '13.7 days');
  assert.equal(periodShort(250 * 1440), '250 days');
  for (const bad of [0, -5, NaN, Infinity, null, undefined]) assert.equal(periodShort(bad), '');
});
