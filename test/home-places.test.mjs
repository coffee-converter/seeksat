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

test('placeLabels: coordinates under generic or repeated names, none under unique ones', () => {
  const gpsA = { name: 'My location', latDeg: 41.88, lonDeg: -87.63, source: 'gps' };
  const gpsB = { name: 'My location', latDeg: 40.71, lonDeg: -74.01, source: 'gps' };
  const blank = { name: '', latDeg: 35.68, lonDeg: 139.69, source: 'coords' };
  assert.deepEqual(placeLabels([chi, tok]), [{ name: 'Chicago', coords: null }, { name: 'Tokyo', coords: null }]);
  assert.deepEqual(placeLabels([gpsA, chi, gpsB, blank]), [
    { name: 'My location', coords: '41.9, -87.6' },
    { name: 'Chicago', coords: null },
    { name: 'My location', coords: '40.7, -74.0' },
    { name: 'Your location', coords: '35.7, 139.7' },
  ]);
  // A single GPS place is generic too.
  assert.deepEqual(placeLabels([gpsA]), [{ name: 'My location', coords: '41.9, -87.6' }]);
  // Two places with the same name are told apart.
  const springIl = { name: 'Springfield', latDeg: 39.8, lonDeg: -89.64, source: 'place' };
  const springMo = { name: 'Springfield', latDeg: 37.21, lonDeg: -93.29, source: 'place' };
  assert.deepEqual(placeLabels([springIl, springMo]).map((l) => l.coords), ['39.8, -89.6', '37.2, -93.3']);
});

test('placeLabels adds decimals until close places read differently', () => {
  const a = { name: 'My location', latDeg: 41.881, lonDeg: -87.631, source: 'gps' };
  const b = { name: 'My location', latDeg: 41.912, lonDeg: -87.642, source: 'gps' };
  assert.deepEqual(placeLabels([a, b]).map((l) => l.coords), ['41.88, -87.63', '41.91, -87.64']);
});
