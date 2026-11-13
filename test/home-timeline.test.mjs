import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelineRows, stripLanes, barSpan, hourTicks, nightSpans, clockLabel } from '../lib/home/timeline.mjs';

const H = 3_600_000;
const NOW = Date.parse('2026-11-02T03:30:00Z');
const pass = (startMs, endMs) => ({ startMs, endMs });

test('timelineRows drops satellites with nothing in 24 h', () => {
  const near = pass(NOW + H, NOW + 2 * H);
  const far = pass(NOW + 30 * H, NOW + 31 * H);
  const cards = [
    { kind: 'pass', noradId: 1, name: 'A', pass: near, passes: [near] },
    { kind: 'pass', noradId: 2, name: 'B', pass: far, passes: [] },
    { kind: 'none', noradId: 3, name: 'C' },
    { kind: 'stationary', noradId: 4, name: 'D' },
    { kind: 'unavailable', noradId: 5, name: 'E' },
    { kind: 'missing', noradId: 6, name: 'F' },
  ];
  assert.deepEqual(timelineRows(cards, NOW), [{ noradId: 1, name: 'A', passes: [near] }]);
});

test('stripLanes stacks overlapping bars and reuses a lane once it is free', () => {
  const spans = [{ x0: 0.1, x1: 0.2 }, { x0: 0.15, x1: 0.25 }, { x0: 0.3, x1: 0.4 }, { x0: 0.18, x1: 0.19 }];
  assert.deepEqual(stripLanes(spans), { lanes: [0, 1, 0, 2], count: 3 });
});

test('stripLanes judges overlap at the minimum bar width', () => {
  const spans = [{ x0: 0.1, x1: 0.101 }, { x0: 0.11, x1: 0.111 }];
  assert.deepEqual(stripLanes(spans).count, 1);
  assert.deepEqual(stripLanes(spans, 0.03), { lanes: [0, 1], count: 2 });
  assert.deepEqual(stripLanes([]), { lanes: [], count: 1 });
});

test('stripLanes keeps bars inside the strip, as drawn, when judging overlap', () => {
  // The first is drawn at [0, 0.03], not about its middle at -0.0125.
  assert.deepEqual(stripLanes([{ x0: 0, x1: 0.005 }, { x0: 0.02, x1: 0.05 }], 0.03).lanes, [0, 1]);
  assert.deepEqual(stripLanes([{ x0: 0.995, x1: 1 }, { x0: 0.95, x1: 0.98 }], 0.03).lanes, [1, 0]);
});

test('barSpan clips a pass in progress at the left edge', () => {
  const s = barSpan(pass(NOW - 5 * 60_000, NOW + 5 * 60_000), NOW);
  assert.equal(s.x0, 0);
  assert.ok(Math.abs(s.x1 - 5 / (24 * 60)) < 1e-9);
});

test('barSpan is null outside the window', () => {
  assert.equal(barSpan(pass(NOW - 2 * H, NOW - H), NOW), null);
  assert.equal(barSpan(pass(NOW + 25 * H, NOW + 26 * H), NOW), null);
});

test("hourTicks follows the observer's zone", () => {
  const tokyo = hourTicks(NOW, 'Asia/Tokyo', { locale: 'en-GB' });
  assert.equal(tokyo[0].label, '15:00');
  assert.ok(Math.abs(tokyo[0].x - 2.5 / 24) < 1e-9);
  assert.equal(tokyo[0].dayLabel, null);
  const chi = hourTicks(NOW, 'America/Chicago', { locale: 'en-GB' });
  // Midnight is named by its day rather than a time.
  assert.equal(chi[0].label, 'Mon');
  assert.equal(chi[0].dayLabel, 'Mon');
  assert.equal(chi.filter((t) => t.dayLabel).length, 1);
});

test('nightSpans covers the night', () => {
  const start = Date.parse('2026-11-02T18:00:00Z');
  const spans = nightSpans({ latDeg: 41.88, lonDeg: -87.63 }, start);
  assert.equal(spans.length, 1);
  const at = (x) => start + x * 24 * H;
  assert.ok(Math.abs(at(spans[0].x0) - Date.parse('2026-11-02T23:30:00Z')) < 30 * 60_000);
  assert.ok(Math.abs(at(spans[0].x1) - Date.parse('2026-11-03T12:00:00Z')) < 30 * 60_000);
});

test('hourTicks gives the same ticks for a non-Latin-digit locale', () => {
  // ar-EG uses a 12-hour clock, like en-US; the labels stay in Latin digits.
  const a = hourTicks(NOW, 'America/Chicago', { locale: 'en-US' });
  const b = hourTicks(NOW, 'America/Chicago', { locale: 'ar-EG' });
  assert.equal(b.length, a.length);
  assert.deepEqual(b.map((t) => t.x), a.map((t) => t.x));
  // Hour labels match; the midnight tick names the weekday in the locale's own words.
  assert.deepEqual(b.filter((t) => !t.dayLabel).map((t) => t.label), a.filter((t) => !t.dayLabel).map((t) => t.label));
  assert.deepEqual(b.filter((t) => t.dayLabel).map((t) => t.label), b.filter((t) => t.dayLabel).map((t) => t.dayLabel));
});

test('hourTicks in Asia/Kolkata lands on whole local hours that are multiples of 3', () => {
  const ticks = hourTicks(NOW, 'Asia/Kolkata', { locale: 'en-GB' });
  assert.ok(ticks.length >= 7);
  for (const t of ticks) {
    const ms = NOW + t.x * 24 * H;
    const local = new Date(ms + 5.5 * H);
    assert.equal(local.getUTCMinutes(), 0);
    assert.equal(local.getUTCHours() % 3, 0);
  }
});

test('hourTicks across a Chicago DST change keeps ticks on local multiples of 3', () => {
  const now = Date.parse('2026-11-01T04:30:00Z'); // fall back at 07:00Z
  const ticks = hourTicks(now, 'America/Chicago', { locale: 'en-GB' });
  assert.ok(ticks.length >= 7);
  assert.ok(ticks.filter((t) => !t.dayLabel).every((t) => Number(t.label.slice(0, 2)) % 3 === 0));
  assert.ok(ticks.every((t) => t.x >= 0 && t.x <= 1));
});

test('nightSpans at 80N is all night in December and none in June', () => {
  const obs = { latDeg: 80, lonDeg: 0 };
  assert.deepEqual(nightSpans(obs, Date.parse('2026-12-21T00:00:00Z')), [{ x0: 0, x1: 1 }]);
  assert.deepEqual(nightSpans(obs, Date.parse('2026-06-21T00:00:00Z')), []);
});

test('clockLabel is a fixed 24-hour HH:MM in the observer zone, in any locale', () => {
  const t = Date.parse('2026-11-02T03:07:00Z');
  assert.equal(clockLabel(t, 'America/Chicago'), '21:07');
  for (const locale of ['fi-FI', 'da-DK', 'ar-EG', 'en-US', 'hi-IN-u-nu-deva']) {
    assert.equal(clockLabel(t, 'America/Chicago', locale), '21:07', locale);
  }
  assert.equal(clockLabel(t, 'Asia/Kolkata'), '08:37');
  assert.equal(clockLabel(Date.parse('2026-11-02T00:05:00Z'), 'UTC'), '00:05');
});

test('clockLabel falls back to UTC for an unknown zone', () => {
  assert.equal(clockLabel(Date.parse('2026-11-02T03:07:00Z'), 'Not/AZone'), '03:07');
});

test('hourTicks labels are short: "3p" for 12-hour locales, the weekday at midnight', () => {
  const tokyo = hourTicks(NOW, 'Asia/Tokyo', { locale: 'en-US' });
  assert.equal(tokyo[0].label, '3p');
  const chi = hourTicks(NOW, 'America/Chicago', { locale: 'en-US' });
  assert.deepEqual(chi.slice(0, 5).map((t) => t.label), ['Mon', '3a', '6a', '9a', '12p']);
  assert.equal(hourTicks(NOW, 'America/Chicago', { locale: 'en-GB' })[1].label, '03:00');
});
