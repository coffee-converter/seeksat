import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPrefs, parsePrefs, loadPrefs, savePrefs, PREFS_KEY, POPULAR_IDS } from '../lib/home/prefs.mjs';
import { MOLNIYA_LINE1, MOLNIYA_LINE2 } from './fixtures/orbits.mjs';

test('defaults', () => {
  const d = defaultPrefs();
  assert.equal(d.location, null);
  assert.deepEqual(d.following, POPULAR_IDS);
  assert.equal(d.mode, 'radio');
  assert.equal(d.minElevDeg, 10);
});

test('garbage falls back to defaults', () => {
  for (const raw of [null, '{', 42, undefined, [], 'null']) assert.deepEqual(parsePrefs(raw), defaultPrefs());
  assert.deepEqual(parsePrefs({ following: 'x' }).following, POPULAR_IDS);
  assert.equal(parsePrefs({ location: { latDeg: 200 } }).location, null);
});

test('field-by-field validation', () => {
  const p = parsePrefs({
    location: { name: 'X', latDeg: 10, lonDeg: 181, source: 'gps' },
    following: [1, 1, 2.5, 0, 'a', 3, ...Array.from({ length: 30 }, (_, i) => 100 + i)],
    minElevDeg: 90,
    projection: 'nope',
    mode: 'x',
  });
  assert.equal(p.location, null);
  assert.equal(p.following.length, 20);
  assert.deepEqual(p.following.slice(0, 2), [1, 3]);
  assert.equal(p.minElevDeg, 10);
  assert.equal(p.projection, defaultPrefs().projection);
  assert.equal(p.mode, 'radio');
});

test('custom entries are validated and capped', () => {
  const good = { noradId: 25485, name: 'MOLNIYA', line1: MOLNIYA_LINE1, line2: MOLNIYA_LINE2 };
  const bad = { noradId: 1, name: 'BAD', line1: 'x', line2: 'y' };
  assert.deepEqual(parsePrefs({ custom: [bad, good] }).custom, [good]);
});

test('valid object round-trips', () => {
  const p = {
    location: { name: 'Home', latDeg: 42.1, lonDeg: -88.2, source: 'coords' },
    following: [25544, 41866],
    custom: [{ noradId: 25485, name: 'MOLNIYA', line1: MOLNIYA_LINE1, line2: MOLNIYA_LINE2 }],
    mode: 'visual',
    minElevDeg: 20,
    projection: defaultPrefs().projection,
  };
  assert.deepEqual(parsePrefs(JSON.parse(JSON.stringify(p))), p);
});

test('loadPrefs and savePrefs survive broken storage', () => {
  assert.deepEqual(loadPrefs({ getItem() { throw new Error('denied'); } }), defaultPrefs());
  assert.equal(savePrefs(defaultPrefs(), { setItem() { throw new Error('quota'); } }), false);
  assert.deepEqual(loadPrefs({ getItem: () => null }), defaultPrefs());
});

test('savePrefs then loadPrefs round-trips through storage', () => {
  const m = new Map();
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  const p = { ...defaultPrefs(), mode: 'visual' };
  assert.equal(savePrefs(p, storage), true);
  assert.ok(m.has(PREFS_KEY));
  assert.deepEqual(loadPrefs(storage), p);
});
