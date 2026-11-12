import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passList, rowWhen, rowDetail, quietLine, ROW_LIMIT } from '../lib/home/pass-list.mjs';

const p = (startIso, minutes, maxElevDeg, startAzDeg, endAzDeg, extra = {}) => {
  const startMs = Date.parse(startIso);
  return { startMs, endMs: startMs + minutes * 60e3, durationMs: minutes * 60e3, maxElevDeg, startAzDeg, endAzDeg, ...extra };
};
const card = (noradId, name, passes) => ({ kind: 'pass', noradId, name, pass: passes[0], passes, upcoming: passes });
const NOW = Date.parse('2026-11-12T20:00:00Z');

test('ROW_LIMIT is 12', () => assert.equal(ROW_LIMIT, 12));

test('rows are sorted by start across satellites', () => {
  const a = card(1, 'A', [p('2026-11-12T21:00:00Z', 5, 40, 0, 90), p('2026-11-12T23:00:00Z', 5, 40, 0, 90)]);
  const b = card(2, 'B', [p('2026-11-12T22:00:00Z', 5, 40, 0, 90), p('2026-11-13T00:00:00Z', 5, 40, 0, 90)]);
  const { groups } = passList({ cards: [a, b], nowMs: NOW, timeZone: 'UTC' });
  assert.deepEqual(groups.flatMap((g) => g.rows.map((r) => r.name)), ['A', 'B', 'A', 'B']);
  assert.equal(groups[0].rows[0].key, `1:${Date.parse('2026-11-12T21:00:00Z')}`);
});

test('in-progress first', () => {
  const a = card(1, 'A', [p('2026-11-12T21:00:00Z', 5, 40, 0, 90)]);
  const b = card(2, 'B', [p('2026-11-12T19:58:00Z', 5, 40, 0, 90, { inProgress: true })]);
  const { groups } = passList({ cards: [a, b], nowMs: NOW, timeZone: 'UTC' });
  const first = groups[0].rows[0];
  assert.equal(first.name, 'B');
  assert.equal(first.now, true);
  assert.equal(rowWhen(first.pass, NOW, 'UTC').sub, 'Now');
});

test("groups by the place's day", () => {
  const early = card(1, 'A', [p('2026-11-13T04:30:00Z', 5, 40, 0, 90)]);
  const late = card(2, 'B', [p('2026-11-13T07:00:00Z', 5, 40, 0, 90)]);
  const tokyo = passList({ cards: [early], nowMs: NOW, timeZone: 'Asia/Tokyo' });
  assert.equal(tokyo.groups[0].label, 'Today');
  const chi = passList({ cards: [early, late], nowMs: NOW, timeZone: 'America/Chicago' });
  assert.deepEqual(chi.groups.map((g) => g.label), ['Today', 'Tomorrow']);
});

test('later days use the weekday name', () => {
  const c = card(1, 'A', [p('2026-11-14T15:00:00Z', 5, 40, 0, 90)]);
  const { groups } = passList({ cards: [c], nowMs: NOW, timeZone: 'UTC' });
  assert.equal(groups[0].label, 'Saturday');
  assert.equal(rowWhen(c.pass, NOW, 'UTC').sub, 'Sat');
});

test('rowWhen counts down on the same day', () => {
  assert.equal(rowWhen(p('2026-11-12T20:42:00Z', 5, 40, 0, 90), NOW, 'UTC').sub, 'in 42 min');
  assert.equal(rowWhen(p('2026-11-12T23:00:00Z', 5, 40, 0, 90), NOW, 'UTC').sub, 'in 3 h');
});

test('caps at 12', () => {
  const cards = Array.from({ length: 20 }, (_, i) => card(i, `S${i}`, [
    p(`2026-11-12T${String(i % 10 + 10).padStart(2, '0')}:00:00Z`, 5, 40, 0, 90),
    p(`2026-11-13T${String(i % 10 + 10).padStart(2, '0')}:00:00Z`, 5, 40, 0, 90),
  ]));
  const r = passList({ cards, nowMs: Date.parse('2026-11-12T00:00:00Z'), timeZone: 'UTC' });
  assert.equal(r.groups.reduce((n, g) => n + g.rows.length, 0), 12);
  assert.equal(r.more, 28);
  const all = passList({ cards, nowMs: Date.parse('2026-11-12T00:00:00Z'), timeZone: 'UTC', limit: Infinity });
  assert.equal(all.groups.reduce((n, g) => n + g.rows.length, 0), 40);
  assert.equal(all.more, 0);
});

test('non-pass cards', () => {
  const st = { kind: 'stationary', noradId: 9, name: 'G', visible: true, pointing: { azDeg: 1, elDeg: 2 } };
  const r = passList({
    cards: [st, { kind: 'none', noradId: 1, name: 'AO-91' }, { kind: 'unavailable', noradId: 2, name: 'X' }, { kind: 'missing', noradId: 3, name: '3' }],
    nowMs: NOW, timeZone: 'UTC',
  });
  assert.deepEqual(r.always, [st]);
  assert.deepEqual(r.quiet, ['AO-91', 'X', '3']);
  assert.deepEqual(r.groups, []);
  assert.equal(quietLine(['AO-91', 'FO-29']), 'No passes in the next 48 h: AO-91, FO-29');
  assert.equal(quietLine([]), null);
});

test('a satellite that never sets but stays below the horizon is quiet, not always up', () => {
  const up = { kind: 'stationary', noradId: 9, name: 'G', visible: true, pointing: { azDeg: 1, elDeg: 2 } };
  const down = { kind: 'stationary', noradId: 8, name: 'H', visible: false, pointing: { azDeg: 1, elDeg: -5 } };
  const r = passList({ cards: [down, up, { kind: 'none', noradId: 1, name: 'AO-91' }], nowMs: NOW, timeZone: 'UTC' });
  assert.deepEqual(r.always, [up]);
  assert.deepEqual(r.quiet, ['H', 'AO-91']);
});

test('rowDetail', () => {
  const pass = { maxElevDeg: 54.4, durationMs: 5 * 60e3, startAzDeg: 225, endAzDeg: 45 };
  assert.equal(rowDetail(pass), '54° · 5 min · SW→NE');
  assert.equal(rowDetail({ ...pass, endAzDeg: null }), '54° · 5 min');
});
