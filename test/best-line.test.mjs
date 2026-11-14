import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestDayWord, bestLine, upNowPass, upNowLine } from '../lib/home/best-line.mjs';

// Chicago keeps UTC-6 in November.
const TZ = 'America/Chicago';
const at = (local) => Date.parse(`${local}-06:00`);

test('evening and night passes this evening are tonight', () => {
  const now = at('2026-11-12T10:00:00');
  assert.equal(bestDayWord(at('2026-11-12T17:30:00'), now, TZ), 'tonight');
  assert.equal(bestDayWord(at('2026-11-12T21:44:00'), now, TZ), 'tonight');
  assert.equal(bestDayWord(at('2026-11-13T04:30:00'), now, TZ), 'tonight');
});

test('daytime passes are today or tomorrow', () => {
  const now = at('2026-11-12T10:00:00');
  assert.equal(bestDayWord(at('2026-11-12T15:00:00'), now, TZ), 'today');
  assert.equal(bestDayWord(at('2026-11-12T16:59:00'), now, TZ), 'today');
  assert.equal(bestDayWord(at('2026-11-13T05:30:00'), now, TZ), 'tomorrow');
  assert.equal(bestDayWord(at('2026-11-13T09:00:00'), now, TZ), 'tomorrow');
});

test('from the evening, after midnight is still tonight and the next evening is tomorrow', () => {
  const now = at('2026-11-12T20:00:00');
  assert.equal(bestDayWord(at('2026-11-13T01:00:00'), now, TZ), 'tonight');
  assert.equal(bestDayWord(at('2026-11-13T11:00:00'), now, TZ), 'tomorrow');
  assert.equal(bestDayWord(at('2026-11-13T19:00:00'), now, TZ), 'tomorrow');
});

test('in the small hours, the rest of the night and this evening are tonight', () => {
  const now = at('2026-11-13T02:00:00');
  assert.equal(bestDayWord(at('2026-11-13T03:00:00'), now, TZ), 'tonight');
  assert.equal(bestDayWord(at('2026-11-13T08:00:00'), now, TZ), 'today');
  assert.equal(bestDayWord(at('2026-11-13T21:00:00'), now, TZ), 'tonight');
});

test('the day word follows the observer zone, not UTC', () => {
  // 21:44 in Chicago is 03:44 the next day in UTC.
  const now = at('2026-11-12T12:00:00');
  assert.equal(bestDayWord(at('2026-11-12T21:44:00'), now, TZ), 'tonight');
  assert.equal(bestDayWord(at('2026-11-12T21:44:00'), now, 'Asia/Tokyo'), 'today');
});

const pass = (o = {}) => ({
  startMs: at('2026-11-12T21:44:00'), endMs: at('2026-11-12T21:50:00'), peakMs: at('2026-11-12T21:47:00'),
  maxElevDeg: 72.4, startAzDeg: 310, endAzDeg: 120, ...o,
});

test('best line: name, rise time, height and where it comes up', () => {
  const line = bestLine({ name: 'ISS', pass: pass(), nowMs: at('2026-11-12T18:00:00'), timeZone: TZ, locale: 'en-US' });
  assert.deepEqual(line, { label: 'Best tonight:', text: 'ISS 9:44 PM, 72°, look NW' });
  const noAz = bestLine({ name: 'ISS', pass: pass({ startAzDeg: null }), nowMs: at('2026-11-12T18:00:00'), timeZone: TZ, locale: 'en-US' });
  assert.equal(noAz.text, 'ISS 9:44 PM, 72°');
});

test('up now pass: under way only, the highest of several', () => {
  const now = at('2026-11-12T21:46:00');
  const low = pass({ maxElevDeg: 20 });
  const high = pass({ maxElevDeg: 60 });
  const later = pass({ startMs: at('2026-11-12T23:00:00'), endMs: at('2026-11-12T23:08:00'), maxElevDeg: 85 });
  const cards = [
    { kind: 'pass', noradId: 1, name: 'A', pass: low, upcoming: [low] },
    { kind: 'pass', noradId: 2, name: 'B', pass: high, passes: [high, later] },
    { kind: 'stationary', noradId: 3, name: 'C' },
  ];
  assert.equal(upNowPass(cards, now).noradId, 2);
  assert.equal(upNowPass(cards, at('2026-11-12T21:40:00')), null);
  assert.equal(upNowPass(cards, at('2026-11-12T21:50:00')), null);
  assert.equal(upNowPass([], now), null);
});

test('up now line: where it is now, else where it sets, and the time left', () => {
  const now = at('2026-11-12T21:45:30');
  assert.deepEqual(upNowLine({ name: 'ISS', pass: pass(), nowMs: now, azDeg: 40 }), { label: 'Up now:', text: 'ISS, look NE, 4 min left' });
  assert.equal(upNowLine({ name: 'ISS', pass: pass(), nowMs: now }).text, 'ISS, heading SE, 4 min left');
  assert.equal(upNowLine({ name: 'ISS', pass: pass(), nowMs: at('2026-11-12T21:49:50') }).text, 'ISS, heading SE, 1 min left');
  assert.equal(upNowLine({ name: 'X', pass: pass({ endAzDeg: null, runsPastEnd: true }), nowMs: now }).text, 'X');
  const long = pass({ endMs: now + 80 * 60_000 });
  assert.equal(upNowLine({ name: 'X', pass: long, nowMs: now, azDeg: 0 }).text, 'X, look N, 1 h 20 min left');
});
