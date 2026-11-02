import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPrefs, parsePrefs, loadPrefs, savePrefs, migrateClassicState, PREFS_KEY, POPULAR_IDS, MAX_CUSTOM } from '../lib/home/prefs.mjs';
import { MOLNIYA_LINE1, MOLNIYA_LINE2 } from './fixtures/orbits.mjs';
import { tleFor } from './fixtures/tle-variants.mjs';

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

test('old projection prefs migrate', () => {
  assert.equal(parsePrefs(JSON.stringify({ projection: 'polar-north' })).projection, 'globe');
  assert.equal(parsePrefs(JSON.stringify({ projection: 'winkel3' })).projection, 'flat');
  assert.equal(parsePrefs(JSON.stringify({ projection: 'globe' })).projection, 'globe');
  assert.equal(defaultPrefs().projection, 'flat');
});

test('custom entries are validated and capped', () => {
  const good = { noradId: 25485, name: 'MOLNIYA', line1: MOLNIYA_LINE1, line2: MOLNIYA_LINE2 };
  const bad = { noradId: 1, name: 'BAD', line1: 'x', line2: 'y' };
  assert.deepEqual(parsePrefs({ custom: [bad, good] }).custom, [good]);
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `S${i}`, ...tleFor(10001 + i) }));
  const kept = parsePrefs({ custom: many }).custom;
  assert.equal(kept.length, MAX_CUSTOM);
  assert.equal(kept[0].noradId, 10001);
});

test('valid object round-trips', () => {
  const p = {
    location: { name: 'Home', latDeg: 42.1, lonDeg: -88.2, source: 'coords' },
    following: [25544, 41866],
    custom: [{ noradId: 25485, name: 'MOLNIYA', line1: MOLNIYA_LINE1, line2: MOLNIYA_LINE2 }],
    mode: 'visual',
    minElevDeg: 20,
    projection: defaultPrefs().projection,
    observers: [{ id: 'obs-2', name: 'FN31', latDeg: 41.5, lonDeg: -72.7 }],
    hidden: [41866],
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

test('observers default to [] and old prefs parse to []', () => {
  assert.deepEqual(defaultPrefs().observers, []);
  assert.deepEqual(parsePrefs({ mode: 'visual' }).observers, []);
});

test('observers are cleaned, deduped and capped at 3', () => {
  const o = (id, extra = {}) => ({ id, name: 'X', latDeg: 1, lonDeg: 2, ...extra });
  const out = parsePrefs({
    observers: [
      o('obs-1'), o('obs-1'), o('bad'), o('obs-2', { latDeg: 99 }), o('obs-3', { lonDeg: 'x' }),
      'junk', null, o('obs-4', { name: 'n'.repeat(100) }), o('obs-5'), o('obs-6'),
    ],
  }).observers;
  assert.deepEqual(out.map((x) => x.id), ['obs-1', 'obs-4', 'obs-5']);
  assert.equal(out[1].name.length, 60);
  assert.deepEqual(parsePrefs({ observers: 'x' }).observers, []);
});

import { LS_STATE_KEY, encodeStateBlob } from '../lib/pass-finder/state-blob.js';

const OBS = { name: 'Chicago', latDeg: 41.8781, lonDeg: -87.6298 };
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

test('classic saved state migrates once into home prefs', () => {
  const extra = [1, 2, 3, 4].map((i) => ({ name: `Extra ${i}`, latDeg: i, lonDeg: -i }));
  const blob = encodeStateBlob({ observers: [OBS, ...extra], mode: 'visual', minElevDeg: 20 });
  const storage = memStorage({ [LS_STATE_KEY]: blob });
  const p = loadPrefs(storage);
  assert.equal(p.location.name, 'Chicago');
  assert.equal(p.location.source, 'coords');
  assert.equal(p.location.latDeg, 41.8781);
  assert.deepEqual(p.observers.map((o) => o.id), ['obs-1', 'obs-2', 'obs-3']);
  assert.equal(p.observers[0].name, 'Extra 1');
  assert.equal(p.mode, 'visual');
  assert.equal(p.minElevDeg, 20);
  assert.deepEqual(JSON.parse(storage.m.get(PREFS_KEY)), p);
  assert.equal(storage.m.get(LS_STATE_KEY), blob);
  assert.deepEqual(loadPrefs(storage), p);
});

test('existing home prefs win over classic state', () => {
  const mine = JSON.stringify({ ...defaultPrefs(), mode: 'visual' });
  const storage = memStorage({ [PREFS_KEY]: mine, [LS_STATE_KEY]: encodeStateBlob({ observers: [OBS], mode: 'radio' }) });
  const p = loadPrefs(storage);
  assert.equal(p.location, null);
  assert.equal(p.mode, 'visual');
  assert.equal(storage.m.get(PREFS_KEY), mine);
});

test('migration never throws and ignores junk', () => {
  assert.equal(migrateClassicState({ getItem() { throw new Error('x'); } }), null);
  assert.equal(migrateClassicState(memStorage({ [LS_STATE_KEY]: '!!!' })), null);
  assert.equal(migrateClassicState(memStorage({ [LS_STATE_KEY]: encodeStateBlob({ observers: [] }) })), null);
  const p = migrateClassicState(memStorage({ [LS_STATE_KEY]: encodeStateBlob({ observers: [{ name: '', latDeg: 1, lonDeg: 2 }] }) }));
  assert.equal(p.location.name, 'Observer'); // the decoder already names nameless observers
});

test('hidden defaults to [] and old prefs parse to []', () => {
  assert.deepEqual(defaultPrefs().hidden, []);
  assert.deepEqual(parsePrefs({ mode: 'visual' }).hidden, []);
  assert.deepEqual(parsePrefs({ hidden: 'x' }).hidden, []);
});

test('hidden is cleaned like following and keeps only followed ids', () => {
  const p = parsePrefs({ following: [1, 2, 3], hidden: [3, 3, 'a', 2.5, 0, 9, 1] });
  assert.deepEqual(p.hidden, [3, 1]);
  // With following missing, the defaults are what hidden is checked against.
  assert.deepEqual(parsePrefs({ hidden: [POPULAR_IDS[1], 77] }).hidden, [POPULAR_IDS[1]]);
});
