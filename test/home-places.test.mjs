import test from 'node:test';
import assert from 'node:assert/strict';
import { withPlace, samePlace, cleanRecent, placeName, placeLabels, RECENT_MAX } from '../lib/home/places.mjs';
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

test('placeName falls back to "Your location" for an empty name', () => {
  assert.equal(placeName(chi), 'Chicago');
  assert.equal(placeName({ ...chi, name: '' }), 'Your location');
  assert.equal(placeName({ ...chi, name: '   ' }), 'Your location');
});

test('placeLabels: every place has its coordinates under it, unless its name is them', () => {
  const gpsA = { name: 'My location', latDeg: 41.88, lonDeg: -87.63, source: 'gps' };
  const blank = { name: '', latDeg: 35.68, lonDeg: 139.69, source: 'coords' };
  const typed = { name: '41.8781, -87.6298', latDeg: 41.8781, lonDeg: -87.6298, source: 'coords' };
  assert.deepEqual(placeLabels([chi, tok]), [
    { name: 'Chicago', coords: '41.88, -87.63' },
    { name: 'Tokyo', coords: '35.68, 139.69' },
  ]);
  assert.deepEqual(placeLabels([gpsA, blank, typed]), [
    { name: 'My location', coords: '41.88, -87.63' },
    { name: 'Your location', coords: '35.68, 139.69' },
    { name: '41.8781, -87.6298', coords: null },
  ]);
  // Two places with the same name are told apart.
  const springIl = { name: 'Springfield', latDeg: 39.8, lonDeg: -89.64, source: 'place' };
  const springMo = { name: 'Springfield', latDeg: 37.21, lonDeg: -93.29, source: 'place' };
  assert.deepEqual(placeLabels([springIl, springMo]).map((l) => l.coords), ['39.80, -89.64', '37.21, -93.29']);
});

test('placeLabels adds decimals until close places read differently', () => {
  const a = { name: 'My location', latDeg: 41.8812, lonDeg: -87.6311, source: 'gps' };
  const b = { name: 'My location', latDeg: 41.8838, lonDeg: -87.6342, source: 'gps' };
  assert.deepEqual(placeLabels([a, b]).map((l) => l.coords), ['41.881, -87.631', '41.884, -87.634']);
});
