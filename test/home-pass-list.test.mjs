import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passList, passKey, rowWhen, rowDetail, quietLines, ROW_LIMIT, durationWords } from '../lib/home/pass-list.mjs';

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
  assert.equal(groups[0].rows[0].key, `1:${Date.parse('2026-11-12T21:00:00Z') / 60_000}`);
});

test('a row keeps its key when a refresh moves the start by seconds', () => {
  const at = (iso) => passList({ cards: [card(1, 'A', [p(iso, 5, 40, 0, 90)])], nowMs: NOW, timeZone: 'UTC' }).groups[0].rows[0].key;
  assert.equal(at('2026-11-12T21:00:10Z'), at('2026-11-12T21:00:12.400Z'));
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
  assert.deepEqual(r.quiet, { none: ['AO-91'], neverUp: [], unusable: ['X'], missing: [3] });
  assert.deepEqual(r.groups, []);
});

test('quietLines gives one line per reason, and none when there is nothing to say', () => {
  assert.deepEqual(quietLines({ none: ['AO-91', 'FO-29'], neverUp: ['G'], unusable: ['X'], missing: [3, 4] }), [
    'No passes in the next 48 h: AO-91, FO-29',
    'Never rises here: G',
    "Can't predict passes from this orbit data: X",
    'Not in the catalog right now: NORAD 3, NORAD 4',
  ]);
  assert.deepEqual(quietLines({ none: [], neverUp: [], unusable: [], missing: [] }), []);
});

test('a pass that started after the cards were made reads Now and sorts first', () => {
  const a = card(1, 'A', [p('2026-11-12T19:58:00Z', 5, 40, 0, 90)]);
  const b = card(2, 'B', [p('2026-11-12T20:30:00Z', 5, 40, 0, 90)]);
  const { groups } = passList({ cards: [b, a], nowMs: NOW, timeZone: 'UTC' });
  assert.equal(groups[0].rows[0].name, 'A');
  assert.equal(groups[0].rows[0].now, true);
  assert.equal(rowWhen(a.pass, NOW, 'UTC').sub, 'Now');
});

test('a pass that has ended drops out before the next refresh', () => {
  const a = card(1, 'A', [p('2026-11-12T19:50:00Z', 5, 40, 0, 90), p('2026-11-12T21:00:00Z', 5, 40, 0, 90)]);
  const { groups } = passList({ cards: [a], nowMs: NOW, timeZone: 'UTC' });
  assert.equal(groups.flatMap((g) => g.rows).length, 1);
});

test('a pass under way is keyed and timed by its rise, the same before and after it starts', () => {
  const before = p('2026-11-12T19:58:00Z', 5, 40, 0, 90);
  const under = { ...p('2026-11-12T20:00:00Z', 3, 40, 0, 90, { inProgress: true }), riseMs: before.startMs + 5_000 };
  assert.equal(passKey(1, before), passKey(1, under));
  assert.deepEqual(rowWhen(under, NOW, 'UTC'), { time: '7:58 PM', sub: 'Now' });
});

test('a pass up since before its rise could be found is "now", to its set time or staying up', () => {
  const cut = p('2026-11-12T20:00:00Z', 30, 40, 0, 90, { inProgress: true, riseUnknown: true });
  const later = { ...cut, startMs: cut.startMs + 10 * 60_000 };
  assert.equal(passKey(1, cut), '1:now');
  assert.equal(passKey(1, cut), passKey(1, later));
  assert.deepEqual(rowWhen(cut, NOW, 'UTC'), { time: 'Now', sub: 'to 8:30 PM' });
  assert.deepEqual(rowWhen({ ...cut, runsPastEnd: true }, NOW, 'UTC'), { time: 'Now', sub: 'stays up' });
});

test('a satellite that never sets but stays below the horizon is quiet, not always up', () => {
  const up = { kind: 'stationary', noradId: 9, name: 'G', visible: true, pointing: { azDeg: 1, elDeg: 2 } };
  const down = { kind: 'stationary', noradId: 8, name: 'H', visible: false, pointing: { azDeg: 1, elDeg: -5 } };
  const r = passList({ cards: [down, up, { kind: 'none', noradId: 1, name: 'AO-91' }], nowMs: NOW, timeZone: 'UTC' });
  assert.deepEqual(r.always, [up]);
  assert.deepEqual(r.quiet, { none: ['AO-91'], neverUp: ['H'], unusable: [], missing: [] });
});

test('rowDetail', () => {
  const pass = { maxElevDeg: 54.4, durationMs: 5 * 60e3, startAzDeg: 225, endAzDeg: 45 };
  assert.equal(rowDetail(pass), '54° · 5 min · SW→NE');
  assert.equal(rowDetail({ ...pass, endAzDeg: null }), '54° · 5 min');
});

test('a long pass reads in hours, not thousands of minutes', () => {
  assert.equal(durationWords(5 * 60_000), '5 min');
  assert.equal(durationWords(80 * 60_000), '1 h 20 min');
  assert.equal(durationWords(120 * 60_000), '2 h');
  assert.equal(durationWords(1648 * 60_000), '27 h');
});
