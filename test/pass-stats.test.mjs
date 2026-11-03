import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passStats } from '../lib/home/view.mjs';

// The pass card's three stat columns: Starts (or Ends, while up), Max, Lasts
// (or Left). Times come from the caller's clock so cards share one format.

const TZ = 'America/Chicago';
const clock = (ms, timeZone) => new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', timeZone }).format(ms);
const NOW = Date.UTC(2026, 10, 3, 8, 0, 0); // 02:00 AM CST, Tue 3 Nov
const pass = (o = {}) => ({
  startMs: NOW + 90 * 60_000, endMs: NOW + 90 * 60_000 + 224_000, peakMs: NOW + 90 * 60_000 + 112_000,
  durationMs: 224_000, maxElevDeg: 24.4, peakAzDeg: 135, inProgress: false, ...o,
});

test('an upcoming pass: start time and countdown, max and its direction, duration', () => {
  assert.deepEqual(passStats(pass(), NOW, { timeZone: TZ, clock }), {
    first: { label: 'Starts', value: '03:30 AM', sub: 'in 1 h 30 min' },
    max: { label: 'Max', value: '24°', sub: 'SE' },
    last: { label: 'Lasts', value: '3m44s' },
  });
});

test('a pass on another day names the weekday beside the countdown', () => {
  const p = pass({ startMs: NOW + 26 * 3_600_000, endMs: NOW + 26 * 3_600_000 + 224_000 });
  assert.equal(passStats(p, NOW, { timeZone: TZ, clock }).first.sub, 'Wed, in 1 day 2 h');
});

test('a pass already up shows when it ends and how long is left', () => {
  const p = pass({ startMs: NOW, endMs: NOW + 150_000, inProgress: true });
  const s = passStats(p, NOW, { timeZone: TZ, clock });
  assert.deepEqual(s.first, { label: 'Ends', value: '02:02 AM', sub: 'Up now' });
  assert.deepEqual(s.last, { label: 'Left', value: '2 min' });
});

test('without a peak azimuth the max has no direction', () => {
  assert.equal(passStats(pass({ peakAzDeg: null }), NOW, { timeZone: TZ, clock }).max.sub, null);
});
