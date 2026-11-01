import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALERTS_KEY, MAX_ALERTS, MAX_TIMER_MS, parseAlerts, safeUrl, canRemind, addAlert, removeAlert, pruneAlerts, nextDue, alertText, planTimer, makeAlert, shouldNotify,
} from '../lib/alerts/alerts.mjs';

const MIN = 60_000;
const mk = (noradId, startMs, extra = {}) => ({
  id: `${noradId}:${startMs}`, noradId, name: 'ISS', startMs, peakMs: startMs + 3 * MIN, maxElevDeg: 62.4, leadMin: 10, url: `/sat/${noradId}`, ...extra,
});

test('storage key', () => assert.equal(ALERTS_KEY, 'seeksat.alerts.v1'));

test('parseAlerts survives junk', () => {
  for (const bad of [null, undefined, '', 'nope', '{}', '42', '[1,"a",null]']) assert.deepEqual(parseAlerts(bad), []);
  const good = mk(25544, 1000);
  assert.deepEqual(parseAlerts(JSON.stringify([good, { id: 'x' }, 7])), [good]);
});

test('makeAlert builds the id', () => {
  const a = makeAlert({ noradId: 1, name: 'A', pass: { startMs: 5, peakMs: 6, maxElevDeg: 30 }, url: '/sat/1' });
  assert.equal(a.id, '1:5');
  assert.equal(a.leadMin, 10);
});

test('addAlert replaces a duplicate and caps at 50, dropping the oldest', () => {
  let l = [];
  for (let i = 0; i < MAX_ALERTS + 3; i++) l = addAlert(l, mk(1, i + 1));
  assert.equal(l.length, MAX_ALERTS);
  assert.equal(l[0].startMs, 4);
  assert.equal(l.at(-1).startMs, MAX_ALERTS + 3);
  const again = addAlert(l, mk(1, 10, { leadMin: 5 }));
  assert.equal(again.length, MAX_ALERTS);
  assert.equal(again.filter((a) => a.id === '1:10').length, 1);
});

test('removeAlert', () => {
  const l = [mk(1, 5), mk(2, 6)];
  assert.deepEqual(removeAlert(l, '1:5'), [mk(2, 6)]);
  assert.equal(removeAlert(l, 'zzz').length, 2);
});

test('pruneAlerts drops passes that have started', () => {
  const l = [mk(1, 100), mk(1, 200), mk(1, 300)];
  assert.deepEqual(pruneAlerts(l, 200).map((a) => a.startMs), [200, 300]);
});

test('nextDue orders by notify time across lead times', () => {
  const now = 1_000_000;
  const a = mk(1, now + 30 * MIN, { leadMin: 10 }); // fires now+20
  const b = mk(2, now + 25 * MIN, { leadMin: 20 }); // fires now+5
  const c = mk(3, now + 12 * MIN, { leadMin: 10 }); // fires now+2
  assert.equal(nextDue([a, b, c], now).id, c.id);
  assert.equal(nextDue([a, b], now).id, b.id);
  assert.equal(nextDue([], now), null);
  // fire time already passed but the pass is ahead: still due
  assert.equal(nextDue([c], now + 3 * MIN).id, c.id);
  // pass started: not due
  assert.equal(nextDue([c], now + 12 * MIN), null);
  // exactly now still counts
  assert.equal(nextDue([c], now + 2 * MIN).id, c.id);
});

test('alertText', () => {
  assert.equal(alertText(mk(1, 10 * MIN), 0), 'ISS in 10 min, max 62°');
});

test('planTimer', () => {
  const now = 5_000;
  assert.equal(planTimer([], now), null);
  const a = mk(1, now + 30 * MIN);
  assert.deepEqual(planTimer([a], now), { delayMs: 20 * MIN, alert: a });
  const far = mk(1, now + 60 * 24 * 60 * MIN);
  assert.equal(planTimer([far], now).delayMs, MAX_TIMER_MS);
  assert.equal(MAX_TIMER_MS, 2 ** 31 - 1);
  assert.equal(planTimer([mk(1, now + 10 * MIN)], now).delayMs, 0);
});

test('overdue with pass ahead fires at 0', () => {
  const now = 9_000_000;
  const a = mk(1, now + 4 * MIN); // fire time was 6 min ago
  assert.deepEqual(planTimer([a], now), { delayMs: 0, alert: a });
  assert.equal(planTimer([mk(1, now - 1)], now), null);
});

test('canRemind', () => {
  assert.equal(canRemind({ startMs: 101 }, 100), true);
  assert.equal(canRemind({ startMs: 100 }, 100), false);
  assert.equal(canRemind({ startMs: 50 }, 100), false);
  assert.equal(canRemind(null, 100), false);
});

test('safeUrl keeps same-origin only', () => {
  const o = 'https://seeksat.app';
  assert.equal(safeUrl('/sat/25544', o), '/sat/25544');
  assert.equal(safeUrl('https://seeksat.app/sat/1?x=1', o), 'https://seeksat.app/sat/1?x=1');
  assert.equal(safeUrl('https://evil.example/x', o), '/');
  assert.equal(safeUrl('//evil.example/x', o), '/');
  assert.equal(safeUrl('javascript:alert(1)', o), '/');
});

test('parseAlerts sanitizes urls when given an origin', () => {
  const bad = mk(1, 5, { url: 'https://evil.example/' });
  assert.equal(parseAlerts(JSON.stringify([bad]), 'https://seeksat.app')[0].url, '/');
});

test('shouldNotify only while the pass is still ahead', () => {
  const now = 1_000_000_000;
  assert.equal(shouldNotify(mk(25544, now + 10 * MIN), now), true);
  assert.equal(shouldNotify(mk(25544, now + 1), now), true);
  // A timer that fired late (sleep, throttling) for a pass that has started.
  assert.equal(shouldNotify(mk(25544, now), now), false);
  assert.equal(shouldNotify(mk(25544, now - 45 * MIN), now), false);
  assert.equal(shouldNotify(null, now), false);
  assert.equal(shouldNotify(mk(25544, Number.NaN), now), false);
});

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the runner drops a started pass and never shows an id twice', () => {
  const runner = src('components/AlertRunner.tsx');
  assert.match(runner, /shouldNotify/);
  assert.match(runner, /new Set<string>\(\)/);
  assert.match(runner, /fired\.has\(/);
  assert.match(runner, /fired\.add\(/);
});

