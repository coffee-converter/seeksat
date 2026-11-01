import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCustomTo, followIn, unfollowIn, isStale, createLoadGuard, followBlockedMessage, addObserverTo, removeObserverFrom,
} from '../lib/home/actions.mjs';
import { defaultPrefs, MAX_CUSTOM, MAX_FOLLOWING } from '../lib/home/prefs.mjs';
import { tleFor } from './fixtures/tle-variants.mjs';

const text = (id, name = 'SAT') => { const t = tleFor(id); return `${name}\n${t.line1}\n${t.line2}`; };

test('addCustomTo adds to custom and following', () => {
  const { prefs, result } = addCustomTo(defaultPrefs(), text(25485, 'MOLNIYA'));
  assert.deepEqual(result, { ok: true });
  assert.equal(prefs.custom.length, 1);
  assert.equal(prefs.custom[0].name, 'MOLNIYA');
  assert.ok(prefs.following.includes(25485));
});

test('addCustomTo replaces the same id and does not duplicate following', () => {
  const a = addCustomTo(defaultPrefs(), text(25485, 'ONE')).prefs;
  const b = addCustomTo(a, text(25485, 'TWO')).prefs;
  assert.equal(b.custom.length, 1);
  assert.equal(b.custom[0].name, 'TWO');
  assert.equal(b.following.filter((i) => i === 25485).length, 1);
});

test('addCustomTo passes ElementsError messages through and leaves prefs alone', () => {
  const p = defaultPrefs();
  const { prefs, result } = addCustomTo(p, 'nonsense');
  assert.equal(result.ok, false);
  assert.equal(result.message, 'Paste two TLE lines, or three with a name line first.');
  assert.equal(prefs, p);
});

test('addCustomTo rethrows non-ElementsError failures', () => {
  assert.throws(() => addCustomTo(defaultPrefs(), { toString() { throw new RangeError('boom'); } }), RangeError);
});

test('addCustomTo enforces the custom cap', () => {
  let p = { ...defaultPrefs(), following: [] };
  for (let i = 0; i < MAX_CUSTOM; i++) p = addCustomTo(p, text(20001 + i)).prefs;
  assert.equal(p.custom.length, MAX_CUSTOM);
  const { prefs, result } = addCustomTo(p, text(30000));
  assert.equal(result.ok, false);
  assert.match(result.message, /up to 10/);
  assert.equal(prefs, p);
  assert.equal(addCustomTo(p, text(20001, 'RENAMED')).result.ok, true);
});

test('addCustomTo enforces the following cap', () => {
  const p = { ...defaultPrefs(), following: Array.from({ length: MAX_FOLLOWING }, (_, i) => i + 1) };
  const { prefs, result } = addCustomTo(p, text(25485));
  assert.equal(result.ok, false);
  assert.match(result.message, /up to 20/);
  assert.equal(prefs, p);
});

test('followIn dedupes and caps', () => {
  const p = defaultPrefs();
  assert.equal(followIn(p, p.following[0]), p);
  assert.deepEqual(followIn(p, 99999).following, [...p.following, 99999]);
  const full = { ...p, following: Array.from({ length: MAX_FOLLOWING }, (_, i) => i + 1) };
  assert.equal(followIn(full, 500), full);
});

test('unfollowIn removes the custom entry too', () => {
  const p = addCustomTo(defaultPrefs(), text(25485)).prefs;
  const q = unfollowIn(p, 25485);
  assert.ok(!q.following.includes(25485));
  assert.equal(q.custom.length, 0);
  assert.deepEqual(unfollowIn(defaultPrefs(), 1).following, defaultPrefs().following);
});

test('isStale', () => {
  const t = 1_000_000;
  assert.equal(isStale(null, t), true);
  assert.equal(isStale(t, t + 60 * 60 * 1000), false);
  assert.equal(isStale(t, t + 60 * 60 * 1000 + 1), true);
});

test('load guard discards an older load that finishes after a newer one', async () => {
  const guard = createLoadGuard();
  const committed = [];
  const run = async (label, ms) => {
    const isLatest = guard.begin();
    await new Promise((r) => setTimeout(r, ms));
    if (isLatest()) committed.push(label);
  };
  await Promise.all([run('old', 20), run('new', 1)]);
  assert.deepEqual(committed, ['new']);
});

test('followBlockedMessage explains the cap only for a new id at the cap', () => {
  const full = Array.from({ length: MAX_FOLLOWING }, (_, i) => i + 1);
  assert.equal(followBlockedMessage(full, 999), 'You can follow up to 20 satellites. Unfollow one first.');
  assert.equal(followBlockedMessage(full, 1), null, 'already following');
  assert.equal(followBlockedMessage(full.slice(1), 999), null, 'room left');
});

test('addObserverTo assigns obs-1, obs-2 and caps at 3', () => {
  let p = defaultPrefs();
  const add = (name) => {
    const r = addObserverTo(p, { name, latDeg: 10, lonDeg: 20 });
    if (r.prefs) p = r.prefs;
    return r;
  };
  assert.equal(add('A').prefs.observers[0].id, 'obs-1');
  assert.equal(add('B').prefs.observers[1].id, 'obs-2');
  add('C');
  assert.equal(add('D').error, 'You can add up to 3 other places.');
  assert.equal(p.observers.length, 3);
});

test('addObserverTo takes the lowest unused id after a removal', () => {
  let p = defaultPrefs();
  for (const n of ['A', 'B']) p = addObserverTo(p, { name: n, latDeg: 1, lonDeg: 2 }).prefs;
  p = removeObserverFrom(p, 'obs-1');
  assert.equal(addObserverTo(p, { name: 'C', latDeg: 1, lonDeg: 2 }).prefs.observers.at(-1).id, 'obs-1');
});

test('removeObserverFrom drops by id', () => {
  const p = addObserverTo(defaultPrefs(), { name: 'A', latDeg: 1, lonDeg: 2 }).prefs;
  assert.deepEqual(removeObserverFrom(p, 'obs-1').observers, []);
  assert.equal(removeObserverFrom(p, 'nope').observers.length, 1);
});
