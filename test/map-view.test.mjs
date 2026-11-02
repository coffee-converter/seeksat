import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTIONS, DEFAULT_PROJECTION, migrateProjection, homeCamera, homeCentresFocus, presetCamera, minZoomFor, MAX_ZOOM } from '../lib/map/view.mjs';

test('the view list is flat and globe, flat by default', () => {
  assert.deepEqual(PROJECTIONS, [{ id: 'flat', label: 'Mercator' }, { id: 'globe', label: 'Globe' }]);
  assert.equal(DEFAULT_PROJECTION, 'flat');
});

test('migrateProjection maps every old value', () => {
  const table = {
    equirectangular: 'flat',
    winkel3: 'flat',
    azimuthal: 'globe',
    'polar-north': 'globe',
    'polar-south': 'globe',
    satellite: 'globe',
    flat: 'flat',
    globe: 'globe',
    nonsense: 'flat',
  };
  for (const [from, to] of Object.entries(table)) assert.equal(migrateProjection(from), to, from);
  assert.equal(migrateProjection(undefined), 'flat');
  assert.equal(migrateProjection(null), 'flat');
  assert.equal(migrateProjection(42), 'flat');
});

const size = { width: 1024, height: 400 };

test('homeCamera flat centres on the focus, then the observer', () => {
  const observer = { latDeg: 41.9, lonDeg: -88 };
  const focus = { latDeg: -10, lonDeg: 100 };
  assert.deepEqual(homeCamera('flat', { observer, focus, ...size }).center, [100, 20]);
  assert.deepEqual(homeCamera('flat', { observer, focus: null, ...size }).center, [-88, 20]);
  assert.deepEqual(homeCamera('flat', { observer: null, focus: null, ...size }).center, [0, 20]);
});

test('homeCamera flat shows the whole world across', () => {
  const { zoom } = homeCamera('flat', { width: 1024, height: 400 });
  assert.ok(zoom <= Math.log2(1024 / 512) + 1e-9, `zoom ${zoom}`);
  assert.ok(Math.abs(zoom - 1) < 1e-9);
});

test('homeCamera flat fills a tall frame between 60S and 75N', () => {
  // A frame taller than the world is wide zooms in until that band fills it.
  const { zoom } = homeCamera('flat', { width: 400, height: 800 });
  assert.ok(zoom > Math.log2(400 / 512));
  const merc = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
  const bandPx = 512 * 2 ** zoom * (merc(-60) - merc(75));
  assert.ok(Math.abs(bandPx - 800) < 1e-6, `band ${bandPx}`);
});

test('homeCamera globe centres on the observer, then the focus', () => {
  const observer = { latDeg: 41.9, lonDeg: -88 };
  const focus = { latDeg: -10, lonDeg: 100 };
  const g = homeCamera('globe', { observer, focus, width: 1024, height: 800 });
  assert.deepEqual(g.center, [-88, 41.9]);
  const cos = Math.cos((41.9 * Math.PI) / 180);
  assert.ok(Math.abs(g.zoom - (Math.log2(800 / 512) + 1.7 + Math.log2(cos))) < 1e-9, `zoom ${g.zoom}`);
  // On the equator the disc needs no latitude correction.
  assert.ok(Math.abs(homeCamera('globe', { observer: { latDeg: 0, lonDeg: 0 }, width: 512, height: 512 }).zoom - 1.7) < 1e-9);
  assert.deepEqual(homeCamera('globe', { observer: null, focus, width: 1024, height: 800 }).center, [100, -10]);
  assert.deepEqual(homeCamera('globe', { width: 1024, height: 800 }).center, [0, 20]);
});

test('homeCamera globe near a pole keeps the whole Earth in frame', () => {
  // MapLibre scales the globe by 1 / cos(centre latitude), clamped at 85.05
  // degrees; the home zoom undoes exactly that, so the disc is the same size.
  const size = { width: 1024, height: 800 };
  const at = (latDeg) => homeCamera('globe', { observer: { latDeg, lonDeg: 0 }, ...size }).zoom;
  const equator = at(0);
  assert.ok(Number.isFinite(at(89)) && at(89) > -2, `zoom ${at(89)}`);
  assert.equal(at(89), at(85.05));
  assert.equal(at(-89), at(85.05));
  assert.ok(Math.abs(at(60) - (equator - 1)) < 1e-9);
});

test('homeCentresFocus: the flat home centres a focus, the globe home only without an observer', () => {
  const observer = { latDeg: 41.9, lonDeg: -88 };
  const focus = { latDeg: -10, lonDeg: 100 };
  assert.equal(homeCentresFocus('flat', { observer, focus }), true);
  assert.equal(homeCentresFocus('flat', { observer: null, focus }), true);
  // The globe home is observer-first, so the map still has to move to the focus.
  assert.equal(homeCentresFocus('globe', { observer, focus }), false);
  assert.equal(homeCentresFocus('globe', { observer: null, focus }), true);
  assert.equal(homeCentresFocus('flat', { observer, focus: null }), false);
  assert.equal(homeCentresFocus('globe', { observer: null, focus: null }), false);
});

test('presetCamera needs an observer or a focus', () => {
  const size = { width: 1000, height: 800 };
  assert.equal(presetCamera('you', { observer: null, focus: null, ...size }), null);
  assert.equal(presetCamera('sat', { observer: null, focus: null, ...size }), null);
  assert.equal(presetCamera('nope', size), null);
});

test('globe presets frame the whole Earth whatever the current zoom', () => {
  const size = { width: 1000, height: 800 };
  const disc = (latDeg) => homeCamera('globe', { observer: { latDeg, lonDeg: 0 }, ...size }).zoom;
  assert.deepEqual(presetCamera('you', { observer: { latDeg: 41.9, lonDeg: -88 }, ...size }), { center: [-88, 41.9], zoom: disc(41.9) });
  assert.deepEqual(presetCamera('sat', { focus: { latDeg: -10, lonDeg: 100 }, ...size }), { center: [100, -10], zoom: disc(-10) });
  assert.deepEqual(presetCamera('north', size), { center: [0, 90], zoom: disc(90) });
  assert.deepEqual(presetCamera('south', size), { center: [0, -90], zoom: disc(-90) });
});

test('zooming in goes to street level', () => {
  assert.ok(MAX_ZOOM >= 14);
});

test('the flat map zooms out only until the whole world fits across', () => {
  assert.equal(minZoomFor('flat', { width: 1024, height: 900, latDeg: 40 }), 1);
  assert.equal(minZoomFor('flat', { width: 512, height: 900, latDeg: 0 }), 0);
});

test('the globe zooms out only until the whole Earth is in frame', () => {
  const size = { width: 1000, height: 800 };
  const home = (latDeg) => homeCamera('globe', { observer: { latDeg, lonDeg: 0 }, ...size }).zoom;
  assert.equal(minZoomFor('globe', { ...size, latDeg: 0 }), home(0));
  assert.equal(minZoomFor('globe', { ...size, latDeg: 45 }), home(45));
  // MapLibre's globe zoom number shifts with latitude for the same disc size.
  assert.ok(Math.abs(minZoomFor('globe', { ...size, latDeg: 60 }) - (minZoomFor('globe', { ...size, latDeg: 0 }) - 1)) < 1e-9);
  // MapLibre scales the globe by 1 / cos(latitude) up to its 85.05 degree clamp.
  assert.equal(minZoomFor('globe', { ...size, latDeg: 89 }), minZoomFor('globe', { ...size, latDeg: 85.05 }));
  assert.ok(minZoomFor('globe', { ...size, latDeg: 89 }) < minZoomFor('globe', { ...size, latDeg: 80 }));
});
