import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERTS_KEY, MAX_ALERTS, MAX_TIMER_MS, parseAlerts, addAlert, removeAlert, pruneAlerts, nextDue, alertText, planTimer, makeAlert,
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
  // fire time already passed: skipped
  assert.equal(nextDue([c], now + 3 * MIN), null);
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
