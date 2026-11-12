import test from 'node:test';
import assert from 'node:assert/strict';
import { withPlace, samePlace, cleanRecent, RECENT_MAX } from '../lib/home/places.mjs';
import { parsePrefs, defaultPrefs } from '../lib/home/prefs.mjs';

const chi = { name: 'Chicago', latDeg: 41.88, lonDeg: -87.63, source: 'place' };
const tok = { name: 'Tokyo', latDeg: 35.68, lonDeg: 139.69, source: 'place' };

test('withPlace moves the old place into recent', () => {
  const r = withPlace({ ...defaultPrefs(), location: chi, recent: [] }, tok);
  assert.deepEqual(r.location, tok);
  assert.deepEqual(r.recent, [chi]);
});

test('withPlace dedupes', () => {
  const r = withPlace({ ...defaultPrefs(), location: tok, recent: [chi] }, chi);
  assert.deepEqual(r.recent.map((p) => p.name), ['Tokyo']);
  const same = withPlace({ ...defaultPrefs(), location: chi, recent: [] }, { ...chi });
  assert.deepEqual(same.recent, []);
});

test('recent keeps the last RECENT_MAX', () => {
  let p = { ...defaultPrefs(), location: null, recent: [] };
  for (let i = 0; i < 8; i++) p = { ...p, ...withPlace(p, { name: `P${i}`, latDeg: i, lonDeg: i, source: 'coords' }) };
  assert.equal(RECENT_MAX, 5);
  assert.equal(p.recent.length, 5);
  assert.equal(p.recent[0].name, 'P6');
});

test('old prefs without recent load with an empty list', () => {
  assert.deepEqual(parsePrefs(JSON.stringify({ location: chi })).recent, []);
});

test('cleanRecent drops bad entries', () => {
  assert.deepEqual(cleanRecent([chi, { latDeg: 99 }, 'x', null]), [chi]);
});

test('samePlace compares to 4 decimals', () => {
  assert.ok(samePlace(chi, { ...chi, latDeg: 41.880001 }));
  assert.ok(!samePlace(chi, tok));
});
