import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoPath } from 'd3-geo';
import { EN52VE } from './fixtures/orbits.mjs';
import {
  PROJECTIONS, DEFAULT_PROJECTION, projectionAvailable, makeProjection, clampZoom,
} from '../lib/map/projections.mjs';

test('menu order, labels and default', () => {
  assert.deepEqual(PROJECTIONS.map((p) => p.id),
    ['equirectangular', 'azimuthal', 'polar-north', 'polar-south', 'winkel3', 'satellite']);
  assert.deepEqual(PROJECTIONS.map((p) => p.label),
    ['Lat/lon grid', 'Centered on you', 'North pole', 'South pole', 'Winkel tripel', 'From the satellite']);
  assert.equal(DEFAULT_PROJECTION, 'equirectangular');
});
test('equirectangular: [0,0] at the centre', () => {
  const p = makeProjection('equirectangular', { width: 800, height: 400 });
  const [x, y] = p([0, 0]);
  assert.ok(Math.abs(x - 400) < 1 && Math.abs(y - 200) < 1);
});
test('azimuthal: the observer is the centre, due north is straight up', () => {
  const p = makeProjection('azimuthal', { width: 600, height: 600, observer: EN52VE });
  const [x, y] = p([EN52VE.lonDeg, EN52VE.latDeg]);
  assert.ok(Math.abs(x - 300) < 1 && Math.abs(y - 300) < 1);
  const [xn, yn] = p([EN52VE.lonDeg, EN52VE.latDeg + 10]);
  assert.ok(Math.abs(xn - 300) < 1 && yn < 300);
});
test('polar-north centres the pole and clips the far south', () => {
  const p = makeProjection('polar-north', { width: 600, height: 600 });
  const [x, y] = p([0, 90]);
  assert.ok(Math.abs(x - 300) < 1 && Math.abs(y - 300) < 1);
  assert.equal(geoPath(p)({ type: 'Point', coordinates: [0, -60] }), null);
});
test('satellite view centres the subpoint and hides the far side', () => {
  const sat = { latDeg: 0, lonDeg: -75, altKm: 35786 };
  const p = makeProjection('satellite', { width: 600, height: 600, sat });
  const [x, y] = p([-75, 0]);
  assert.ok(Math.abs(x - 300) < 1 && Math.abs(y - 300) < 1);
  assert.equal(geoPath(p)({ type: 'Point', coordinates: [105, 0] }), null);
});
test('unavailable projections fall back to equirectangular', () => {
  assert.equal(projectionAvailable('satellite', { observer: EN52VE, sat: null }), false);
  assert.equal(projectionAvailable('azimuthal', { observer: null, sat: null }), false);
  const p = makeProjection('satellite', { width: 800, height: 400 });
  const [x, y] = p([0, 0]);
  assert.ok(Math.abs(x - 400) < 1 && Math.abs(y - 200) < 1);
});
test('winkel3 centres [0,0], zoom scales, clampZoom bounds', () => {
  const a = makeProjection('winkel3', { width: 800, height: 400 });
  const b = makeProjection('winkel3', { width: 800, height: 400, zoom: 2 });
  assert.ok(Math.abs(a([0, 0])[0] - 400) < 1);
  assert.ok(Math.abs(b.scale() / a.scale() - 2) < 1e-9);
  assert.equal(clampZoom(0.2), 1); assert.equal(clampZoom(20), 8); assert.equal(clampZoom(3), 3);
});

test('centredPan puts the point at the centre when zoomed in', async () => {
  const { centredPan, makeProjection: mk } = await import('../lib/map/projections.mjs');
  const o = { width: 800, height: 400, zoom: 4 };
  const pan = centredPan('equirectangular', o, 20, 10);
  const [x, y] = mk('equirectangular', { ...o, pan })([20, 10]);
  assert.ok(Math.abs(x - 400) < 1e-6 && Math.abs(y - 200) < 1e-6);
});

test('centredPan keeps the map covering the frame', async () => {
  const { centredPan } = await import('../lib/map/projections.mjs');
  // Zoom 2 on an 800 x 400 frame: the map is 1600 x 800, so pan is within +-400 x +-200.
  const [px, py] = centredPan('equirectangular', { width: 800, height: 400, zoom: 2 }, 179, 89);
  assert.ok(Math.abs(px + 400) < 1e-6 && Math.abs(py - 200) < 1e-6);
});

test('centredPan leaves an axis the map does not fill centred', async () => {
  const { centredPan } = await import('../lib/map/projections.mjs');
  // Zoom 1 on a 1200 x 400 frame: the map is 800 x 400 and moves nowhere.
  assert.deepEqual(centredPan('equirectangular', { width: 1200, height: 400, zoom: 1 }, 120, 40), [0, 0]);
});

test('centredPan works on winkel3 and azimuthal, and only those and equirectangular', async () => {
  const { centredPan, makeProjection: mk, CENTRE_ON_FOCUS } = await import('../lib/map/projections.mjs');
  assert.deepEqual(CENTRE_ON_FOCUS, ['equirectangular', 'winkel3', 'azimuthal']);
  const observer = { latDeg: 42, lonDeg: -88 };
  for (const id of ['winkel3', 'azimuthal']) {
    const o = { width: 800, height: 400, zoom: 6, observer };
    const pan = centredPan(id, o, -80, 40);
    const [x, y] = mk(id, { ...o, pan })([-80, 40]);
    assert.ok(Math.abs(x - 400) < 1e-6 && Math.abs(y - 200) < 1e-6, id);
  }
});

test('fillView fills a tall frame on world maps only', async () => {
  const { fillView, makeProjection: mk } = await import('../lib/map/projections.mjs');
  const o = { width: 390, height: 504, observer: EN52VE };
  const eq = fillView('equirectangular', o, 0);
  assert.ok(Math.abs(eq.zoom - 504 / (390 / 2)) < 1e-6, `zoom ${eq.zoom}`);
  // The map now spans the frame's full height.
  const p = mk('equirectangular', { ...o, ...eq });
  const [[, y0], [, y1]] = geoPath(p).bounds({ type: 'Sphere' });
  assert.ok(Math.abs(y0) < 1 && Math.abs(y1 - 504) < 1, `${y0}..${y1}`);
  assert.ok(Math.abs(p([0, 0])[0] - 195) < 1, 'centred on lon 0');
  const w3 = fillView('winkel3', o, 0);
  assert.ok(w3 && w3.zoom > 1);
  for (const id of ['azimuthal', 'polar-north', 'polar-south', 'satellite']) {
    assert.equal(fillView(id, { ...o, sat: { latDeg: 0, lonDeg: 0, altKm: 420 } }, 0), null, id);
  }
  assert.equal(fillView('equirectangular', { width: 900, height: 450 }, 0), null);
  assert.equal(fillView('equirectangular', { width: 900, height: 300 }, 0), null);
});

test('fillView centres any longitude by rotating, with no pan', async () => {
  const { fillView, makeProjection: mk } = await import('../lib/map/projections.mjs');
  const o = { width: 390, height: 504 };
  for (const lon of [60, 179, -175]) {
    const v = fillView('equirectangular', o, lon);
    assert.deepEqual(v.pan, [0, 0]);
    assert.equal(v.rotLon, lon);
    assert.ok(Math.abs(mk('equirectangular', { ...o, ...v })([lon, 0])[0] - 195) < 1, `${lon}`);
  }
  assert.equal(fillView('winkel3', o, 179).pan[0], 0);
});

test('world maps rotate: rotLon lands at the centre x, on equirectangular and Winkel tripel', async () => {
  const { makeProjection: mk, wrapLon } = await import('../lib/map/projections.mjs');
  for (const id of ['equirectangular', 'winkel3']) {
    const p = mk(id, { width: 900, height: 450, rotLon: 179 });
    assert.ok(Math.abs(p([179, 0])[0] - 450) < 1e-6, id);
  }
  // Disc projections ignore it.
  const az = mk('azimuthal', { width: 900, height: 450, observer: EN52VE, rotLon: 179 });
  const az0 = mk('azimuthal', { width: 900, height: 450, observer: EN52VE });
  assert.deepEqual(az([10, 10]), az0([10, 10]));
  assert.equal(wrapLon(181), -179);
  assert.equal(wrapLon(-180), -180);
  assert.equal(wrapLon(540), -180);
});
