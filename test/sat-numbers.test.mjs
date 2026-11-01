import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { liveNumbers, orbitElements, elementAge, formatNumber } from '../lib/sat/numbers.mjs';
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
