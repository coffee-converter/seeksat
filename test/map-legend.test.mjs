import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legendItems } from '../lib/map/legend.mjs';

const iss = { noradId: 25544, name: 'ISS', color: '#ff9b54', selected: true, orbitClass: 'leo', tickMin: 10 };
const goes = { noradId: 41866, name: 'GOES 16', color: '#7fe5d1', selected: false, orbitClass: 'geo', tickMin: 60 };
const gps = { noradId: 48859, name: 'GPS III-5', color: '#c084fc', selected: false, orbitClass: 'meo', tickMin: 60 };
const obs = { name: 'Home', latDeg: 1, lonDeg: 2 };
const PREFIX = 'Dotted: where it has been. Solid, fading: where it is going, ';
const TRACK = `${PREFIX}with ticks every 10 min`;
const HOURLY = `${PREFIX}with ticks every hour`;
const MIXED = `${PREFIX}with ticks every 10 min on low orbits, every hour on higher ones`;

test('full legend, in order', () => {
  const items = legendItems({ sats: [iss, goes], observer: obs, minElevDeg: 10 });
  assert.deepEqual(items.map((i) => i.kind), ['sat', 'sat', 'track', 'footprint', 'night', 'observer']);
  assert.deepEqual(items[0], { key: 'sat-25544', kind: 'sat', label: 'ISS', color: '#ff9b54' });
  assert.equal(items[2].label, MIXED);
  assert.equal(items[3].label, 'Circle: where ISS is at least 10° up');
  assert.equal(items[4].label, 'Shading: night, darker through twilight');
  assert.equal(items[5].label, 'You');
});
test('no selection or observer drops footprint and observer', () => {
  const items = legendItems({ sats: [{ ...iss, selected: false }], observer: null, minElevDeg: 10 });
  assert.deepEqual(items.map((i) => i.kind), ['sat', 'track', 'night']);
});
test('tick copy follows each satellite\'s tick step, not its orbit class', () => {
  const track = (sats) => legendItems({ sats, observer: null, minElevDeg: 5 }).find((i) => i.kind === 'track').label;
  assert.equal(track([goes]), HOURLY);
  // GPS (MEO, 12 h period) ticks hourly too.
  assert.equal(track([gps]), HOURLY);
  assert.equal(track([gps, goes]), HOURLY);
  assert.equal(track([iss]), TRACK);
  assert.equal(track([goes, iss]), MIXED);
  assert.equal(track([iss, gps]), MIXED);
});
test('keys are unique', () => {
  const items = legendItems({ sats: [iss, goes], observer: obs, minElevDeg: 10 });
  assert.equal(new Set(items.map((i) => i.key)).size, items.length);
});

test('ghost and hidden satellites are not listed; ghosts get one faint-dot line', () => {
  const items = legendItems({
    sats: [{ ...iss, emphasis: 'focus' }, { ...goes, emphasis: 'ghost' }, { noradId: 3, name: 'X', color: '#fff', emphasis: 'hidden', orbitClass: 'leo' }],
    observer: null,
    minElevDeg: 10,
  });
  assert.deepEqual(items.map((i) => i.kind), ['sat', 'ghost', 'track', 'footprint', 'night']);
  assert.equal(items[1].label, 'Faint dots: the other satellites you follow');
});

test('the tick copy ignores ghosts', () => {
  const items = legendItems({ sats: [{ ...gps, emphasis: 'focus' }, { ...iss, emphasis: 'ghost' }], observer: null, minElevDeg: 5 });
  assert.equal(items.find((i) => i.kind === 'track').label, HOURLY);
});

test('at 0 degrees the circle line says above the horizon', () => {
  const items = legendItems({ sats: [iss], observer: null, minElevDeg: 0 });
  assert.equal(items.find((i) => i.kind === 'footprint').label, 'Circle: where ISS is above the horizon');
});

test('the circle swatch takes the focused satellite\'s colour, as the map draws it', () => {
  const items = legendItems({ sats: [iss], observer: null, minElevDeg: 0 });
  assert.equal(items.find((i) => i.kind === 'footprint').color, iss.color);
});
