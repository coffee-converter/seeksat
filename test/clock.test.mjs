import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockFormat } from '../lib/clock.mjs';
import { nextPassText } from '../lib/sat/pass-rows.mjs';

// One clock for every pass time on the site: "4:12 AM" where the locale uses
// a 12-hour clock, "04:12" where it uses a 24-hour one.

const TZ = 'America/Chicago';
const AT = Date.parse('2026-11-02T10:12:00Z'); // 04:12 CST

test('a 12-hour locale gets no leading zero and keeps AM or PM', () => {
  assert.equal(clockFormat('en-US', TZ).format(AT), '4:12 AM');
  assert.equal(clockFormat('en-US', TZ).format(AT + 12 * 3_600_000), '4:12 PM');
});

test('a 24-hour locale gets a two-digit hour', () => {
  assert.equal(clockFormat('en-GB', TZ).format(AT), '04:12');
  assert.equal(clockFormat('de-DE', TZ).format(AT), '04:12');
});

test('the satellite page uses the clock', () => {
  const now = Date.parse('2026-11-02T03:00:00Z');
  const p = { startMs: AT, endMs: AT + 360_000, startAzDeg: 225, endAzDeg: 135 };
  assert.equal(nextPassText(p, now, TZ, 'en-US'), 'in 7 h 12 min, Tomorrow 4:12 AM, SW to SE');
});
