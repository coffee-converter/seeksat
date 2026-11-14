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
  assert.deepEqual(items.map((i) => i.kind), ['sat', 'sat', 'track', 'footprint', 'night', 'observer', 'note']);
  assert.deepEqual(items[0], { key: 'sat-25544', kind: 'sat', label: 'ISS', color: '#ff9b54' });
  assert.equal(items[2].label, MIXED);
  assert.equal(items[3].label, 'Circle: where ISS is at least 10° up');
  assert.equal(items[4].label, 'Shading: night, darker through twilight');
  assert.equal(items[5].label, 'You');
});
test('no selection or observer drops footprint and observer', () => {
  const items = legendItems({ sats: [{ ...iss, selected: false }], observer: null, minElevDeg: 10 });
  assert.deepEqual(items.map((i) => i.kind), ['sat', 'track', 'night', 'note']);
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
  assert.deepEqual(items.map((i) => i.kind), ['sat', 'ghost', 'track', 'footprint', 'night', 'note']);
  assert.equal(items[1].label, 'Faint dots: the other satellites you saved');
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

test('the legend ends by saying dots are ground positions, not places in space', () => {
  const items = legendItems({ sats: [iss], observer: null, minElevDeg: 0 });
  const note = items.at(-1);
  assert.equal(note.kind, 'note');
  assert.match(note.label, /ground positions: the point on Earth straight below each satellite/);
  assert.match(note.label, /thousands of km apart in height/);
});

test('the radio mark is explained only when a listed dot has it', () => {
  const sat = (noradId, radio) => ({ noradId, name: `S${noradId}`, color: '#ff0000', selected: false, emphasis: 'normal', radio });
  const keys = (sats) => legendItems({ sats, observer: null, minElevDeg: 0 }).map((i) => i.key);
  assert.ok(keys([sat(1, true), sat(2, false)]).includes('radio'));
  assert.ok(!keys([sat(1, false)]).includes('radio'));
});

test('the opened pass legend mentions shadow only when the pass has a shadow part', async () => {
  const { legendItems } = await import('../lib/map/legend.mjs');
  const base = { noradId: 1, color: '#fff', emphasis: 'focus', passPath: { type: 'MultiLineString', coordinates: [] } };
  const radio = legendItems({ sats: [{ ...base, passShadow: null }], observer: null, minElevDeg: 10 }).find((i) => i.key === 'pass');
  assert.equal(radio.label, 'Bold line: the opened pass, rise to set');
  const visual = legendItems({ sats: [{ ...base, passShadow: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] } }], observer: null, minElevDeg: 10 }).find((i) => i.key === 'pass');
  assert.match(visual.label, /dashed in Earth's shadow/);
});
