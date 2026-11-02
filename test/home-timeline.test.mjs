import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelineRows, barSpan, hourTicks, nightSpans } from '../lib/home/timeline.mjs';

const H = 3_600_000;
const NOW = Date.parse('2026-11-02T03:30:00Z');
const pass = (startMs, endMs) => ({ startMs, endMs });

test('timelineRows drops satellites with nothing in 24 h and counts them', () => {
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
  const { rows, leftOut } = timelineRows(cards, NOW);
  assert.deepEqual(rows, [{ noradId: 1, name: 'A', passes: [near] }]);
  assert.equal(leftOut, 2);
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
  assert.equal(chi[0].label, '00:00');
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
