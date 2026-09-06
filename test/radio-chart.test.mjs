import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceAxisMax, panelScale, timeTicks, fmtDopplerLeg, formatLocalTime, fmtTick, formatZoneAbbr } from '../lib/pass-finder/radio-chart.js';

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


// ---- fmtTick: y-axis tick formatting ------------------------------------

test('fmtTick renders zero plainly, not 0.00', () => {
  assert.equal(fmtTick(0), '0');
});

test('fmtTick decimals follow magnitude, so a dB axis is not over-precise', () => {
  // A signal axis running to -8 dB should read "-8.0", not "-8.00" - the
  // extra digit implies precision the free-space envelope does not have.
  assert.equal(fmtTick(-8), '-8.0');
  assert.equal(fmtTick(10), '10.0');
  assert.equal(fmtTick(-10), '-10.0');
});

test('fmtTick keeps two decimals below 1, where one would lose the scale', () => {
  // An angular-rate axis topping out near 0.6 deg/s needs the second digit.
  assert.equal(fmtTick(0.6), '0.60');
  assert.equal(fmtTick(0.05), '0.05');
});

test('fmtTick drops decimals above 100', () => {
  assert.equal(fmtTick(150), '150');
  assert.equal(fmtTick(-1200), '-1200');
});

// ---- formatZoneAbbr: axis row name --------------------------------------

const TZ_MS = Date.UTC(2026, 8, 7, 9, 25, 0);

test('formatZoneAbbr gives a short zone name, not the IANA identifier', () => {
  // The gutter cannot fit "America/Chicago", and a reader checking a
  // capture wants the abbreviation anyway.
  const abbr = formatZoneAbbr(TZ_MS, 'America/Chicago');
  assert.ok(abbr && abbr.length <= 6, `expected a short abbreviation, got ${abbr}`);
  assert.ok(!abbr.includes('/'), 'must not be the IANA identifier');
});

test('formatZoneAbbr returns null for an absent or bogus zone', () => {
  assert.equal(formatZoneAbbr(TZ_MS, null), null);
  assert.equal(formatZoneAbbr(TZ_MS, undefined), null);
  assert.equal(formatZoneAbbr(TZ_MS, 'Not/AZone'), null);
});

// ---- panelScale exposes its bounds so the painter can label the axis ----

test('panelScale exposes the nice bounds it computed', () => {
  const s = panelScale([-9500, 9500], 100);
  assert.equal(s.hi, 10000);
  assert.equal(s.lo, -10000);
  // The bounds must agree with the mapping: hi maps to the top of the panel.
  assert.ok(Math.abs(s(s.hi)) < 1e-9);
  assert.ok(Math.abs(s(s.lo) - 100) < 1e-9);
});
