import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTIONS, DEFAULT_PROJECTION, migrateProjection, homeCamera, presetCamera } from '../lib/map/view.mjs';

test('the view list is flat and globe, flat by default', () => {
  assert.deepEqual(PROJECTIONS, [{ id: 'flat', label: 'Flat' }, { id: 'globe', label: 'Globe' }]);
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

test('homeCamera globe near a pole zooms no further out than at 80 degrees', () => {
  const size = { width: 1024, height: 800 };
  const at80 = homeCamera('globe', { observer: { latDeg: 80, lonDeg: 0 }, ...size }).zoom;
  const north = homeCamera('globe', { observer: { latDeg: 89, lonDeg: 0 }, ...size }).zoom;
  const south = homeCamera('globe', { observer: { latDeg: -89, lonDeg: 0 }, ...size }).zoom;
  assert.ok(Number.isFinite(north), `zoom ${north}`);
  assert.ok(north >= at80 - 1e-9, `89N ${north} vs 80N ${at80}`);
  assert.ok(south >= at80 - 1e-9, `89S ${south} vs 80N ${at80}`);
});

test('presetCamera needs an observer or a focus', () => {
  assert.equal(presetCamera('you', { observer: null, focus: null }), null);
  assert.equal(presetCamera('sat', { observer: null, focus: null }), null);
  assert.deepEqual(presetCamera('you', { observer: { latDeg: 41.9, lonDeg: -88 } }), { center: [-88, 41.9], zoom: null });
  assert.deepEqual(presetCamera('sat', { focus: { latDeg: -10, lonDeg: 100 } }), { center: [100, -10], zoom: null });
  assert.deepEqual(presetCamera('north', {}), { center: [0, 90], zoom: null });
  assert.deepEqual(presetCamera('south', {}), { center: [0, -90], zoom: null });
  assert.equal(presetCamera('nope', {}), null);
});
