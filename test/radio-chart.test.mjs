import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceAxisMax, panelScale, timeTicks, fmtDopplerLeg, formatLocalTime, fmtTick, formatZoneAbbr, panelsFor, axisTicks } from '../lib/pass-finder/radio-chart.js';

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


// ---- panelsFor: panel order and the no-frequency degrade path -----------

test('panels run angular rate, Doppler, signal - Doppler in the middle', () => {
  // Doppler is the reference the other two are read against (both peak
  // where it crosses zero), so it sits adjacent to both.
  assert.deepEqual(panelsFor(true).map((p) => p.key),
    ['angRateDegPerSec', 'dopplerHz', 'relSignalDb']);
});

test('with no frequency, Doppler is replaced by range rate in place', () => {
  const keys = panelsFor(false).map((p) => p.key);
  assert.deepEqual(keys, ['angRateDegPerSec', 'rangeRateMps', 'relSignalDb']);
});

test('the degrade swap matches on key, not position', () => {
  // A positional swap (PANELS[0]) silently replaces the wrong panel the
  // moment the order changes - which it did. Angular rate and signal must
  // survive the swap untouched.
  const on = panelsFor(true), off = panelsFor(false);
  assert.equal(off[0].label, on[0].label, 'angular rate must be untouched');
  assert.equal(off[2].label, on[2].label, 'signal must be untouched');
  assert.equal(off[1].unit, 'm/s');
});




// ---- axisTicks: the gridline ladder -------------------------------------

test('axisTicks lands on readable steps, not even divisions of the span', () => {
  // An angular-rate axis to 0.6 divided evenly gives 0.15 steps, which
  // nobody reads off a chart. The ladder rounds to 1 / 2 / 2.5 / 5.
  assert.deepEqual(axisTicks(0, 0.6, 4).map((v) => +v.toFixed(4)),
    [0, 0.2, 0.4, 0.6]);
  assert.deepEqual(axisTicks(-10, 10, 4), [-10, -5, 0, 5, 10]);
  assert.deepEqual(axisTicks(-8, 0, 4), [-8, -6, -4, -2, 0]);
});

test('axisTicks includes a clean zero when the range straddles it', () => {
  // Float accumulation can leave -0 or 1e-17 where zero belongs; the tick
  // has to read "0", since it is the line the Doppler curve crosses.
  const ticks = axisTicks(-10, 10, 4);
  const zero = ticks.find((v) => Math.abs(v) < 1e-9);
  assert.equal(zero, 0);
  assert.ok(!Object.is(zero, -0), 'must not be negative zero');
});

test('axisTicks stays within the bounds it is given', () => {
  for (const [lo, hi] of [[-10, 10], [0, 0.6], [-8, 0], [-1200, 400]]) {
    for (const v of axisTicks(lo, hi, 4)) {
      assert.ok(v >= lo - 1e-9 && v <= hi + 1e-9, `${v} outside [${lo}, ${hi}]`);
    }
  }
});

test('axisTicks degrades rather than spinning on a degenerate range', () => {
  // Guards the accumulate-by-step walk: a zero or non-finite span must
  // return promptly instead of looping.
  assert.deepEqual(axisTicks(5, 5, 4), [5]);
  assert.deepEqual(axisTicks(10, 0, 4), [10]);
  assert.deepEqual(axisTicks(0, NaN, 4), [0]);
  assert.deepEqual(axisTicks(0, Infinity, 4), [0]);
});

test('axisTicks produces a sane number of ticks across magnitudes', () => {
  for (const [lo, hi] of [[-10, 10], [0, 0.6], [-8, 0], [0, 1e6], [0, 1e-4]]) {
    const n = axisTicks(lo, hi, 4).length;
    assert.ok(n >= 2 && n <= 12, `${n} ticks for [${lo}, ${hi}]`);
  }
});
