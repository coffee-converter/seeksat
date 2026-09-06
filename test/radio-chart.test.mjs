import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceAxisMax, panelScale, timeTicks, fmtDopplerLeg, formatLocalTime } from '../lib/pass-finder/radio-chart.js';

test('niceAxisMax rounds up to a readable bound', () => {
  assert.equal(niceAxisMax(10940), 12000);
  assert.equal(niceAxisMax(3640), 4000);
  assert.equal(niceAxisMax(0.7), 0.8);
  assert.equal(niceAxisMax(0), 1);
});

test('niceAxisMax never returns a bound below its input', () => {
  for (const v of [1, 9.9, 10.1, 99, 101, 999, 1001, 10940, 21880]) {
    assert.ok(niceAxisMax(v) >= v, `${v} -> ${niceAxisMax(v)}`);
  }
});

test('panelScale maps a symmetric range to the panel with zero centred', () => {
  const s = panelScale([-4000, 4000], 100);
  assert.ok(Math.abs(s(0) - 50) < 1e-9, 'zero must sit mid-panel');
  assert.ok(s(4000) < s(-4000), 'positive values must plot higher (smaller y)');
});

test('panelScale handles an all-zero series without dividing by zero', () => {
  const s = panelScale([0, 0], 100);
  assert.ok(Number.isFinite(s(0)));
});

test('timeTicks spans the window inclusively and is monotonic', () => {
  const ticks = timeTicks(1000, 401000, 5);
  assert.equal(ticks[0], 1000);
  assert.equal(ticks[ticks.length - 1], 401000);
  for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i] > ticks[i - 1]);
});

test('fmtDopplerLeg renders a null leg as an em dash, never 0 or "null"', () => {
  assert.equal(fmtDopplerLeg(null), '—');
});

test('fmtDopplerLeg renders a positive value as a signed kHz reading', () => {
  assert.equal(fmtDopplerLeg(9600), '+9.6 kHz');
});

test('fmtDopplerLeg renders a negative value as a signed negative kHz reading', () => {
  assert.equal(fmtDopplerLeg(-9600), '-9.6 kHz');
});

test('fmtDopplerLeg does not confuse an actual 0 Hz reading with null', () => {
  assert.equal(fmtDopplerLeg(0), '+0.0 kHz');
});

test('formatLocalTime renders HH:MM:SS in the given IANA zone', () => {
  const ms = Date.UTC(2024, 5, 1, 18, 30, 15);
  assert.equal(formatLocalTime(ms, 'UTC'), '18:30:15');
  assert.equal(formatLocalTime(ms, 'America/Chicago'), '13:30:15');
});

test('formatLocalTime degrades to null with no tz or an unrecognized one', () => {
  const ms = Date.UTC(2024, 5, 1, 18, 30, 15);
  assert.equal(formatLocalTime(ms, undefined), null);
  assert.equal(formatLocalTime(ms, ''), null);
  assert.equal(formatLocalTime(ms, 'Not/A_Zone'), null);
});
