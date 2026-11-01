import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legendItems } from '../lib/map/legend.mjs';

const iss = { noradId: 25544, name: 'ISS', color: '#ff9b54', selected: true, orbitClass: 'leo' };
const goes = { noradId: 41866, name: 'GOES 16', color: '#7fe5d1', selected: false, orbitClass: 'geo' };
const obs = { name: 'Home', latDeg: 1, lonDeg: 2 };
const TRACK = 'Line: ground track, from a quarter orbit ago to one orbit ahead';

test('full legend, in order', () => {
  const items = legendItems({ sats: [iss, goes], observer: obs, minElevDeg: 10 });
  assert.deepEqual(items.map((i) => i.kind), ['sat', 'sat', 'track', 'footprint', 'night', 'observer']);
  assert.deepEqual(items[0], { key: 'sat-25544', kind: 'sat', label: 'ISS', color: '#ff9b54' });
  assert.equal(items[2].label, TRACK);
  assert.equal(items[3].label, 'Circle: where ISS is at least 10° up');
  assert.equal(items[4].label, 'Shading: night, darker through twilight');
  assert.equal(items[5].label, 'You');
});
test('no selection or observer drops footprint and observer', () => {
  const items = legendItems({ sats: [{ ...iss, selected: false }], observer: null, minElevDeg: 10 });
  assert.deepEqual(items.map((i) => i.kind), ['sat', 'track', 'night']);
});
test('GEO label only when every listed sat is GEO', () => {
  const only = legendItems({ sats: [goes], observer: null, minElevDeg: 5 });
  assert.equal(only.find((i) => i.kind === 'track').label, 'Line: ground track over a day');
  const mixed = legendItems({ sats: [goes, iss], observer: null, minElevDeg: 5 });
  assert.equal(mixed.find((i) => i.kind === 'track').label, TRACK);
});
test('keys are unique', () => {
  const items = legendItems({ sats: [iss, goes], observer: obs, minElevDeg: 10 });
  assert.equal(new Set(items.map((i) => i.key)).size, items.length);
});
