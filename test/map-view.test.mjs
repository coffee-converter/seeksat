import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTIONS, DEFAULT_PROJECTION, defaultProjectionFor, migrateProjection, nightRefreshMs, NIGHT_REFRESH_MIN_MS, NIGHT_REFRESH_MAX_MS, homeCamera, homeCentresFocus, presetCamera, minZoomFor, easeZoom, MAX_ZOOM } from '../lib/map/view.mjs';

test('the view list is globe and Mercator, flat by default', () => {
  assert.deepEqual(PROJECTIONS, [
    { id: 'globe', label: 'Globe' },
    { id: 'flat', label: 'Mercator' },
  ]);
  assert.equal(DEFAULT_PROJECTION, 'flat'); // the fallback; phones start on the globe (defaultProjectionFor)
});

test('a saved Satellite\'s view (satview) loads as the globe', () => {
  assert.equal(migrateProjection('satview'), 'globe');
  assert.equal(migrateProjection('flat'), 'flat');
  assert.equal(migrateProjection('globe'), 'globe');
});

test('the Night side preset centres opposite the Sun', () => {
  const date = new Date('2026-06-21T12:00:00Z');
  const cam = presetCamera('night', { date, width: 1000, height: 800 });
  // subsolar is about (0.46 E, 23.44 N) then: antisolar about (-179.5, -23.44)
  assert.ok(Math.abs(cam.center[1] + 23.44) < 0.2);
  assert.ok(Math.abs(Math.abs(cam.center[0]) - 179.5) < 0.6);
  // The whole-Earth zoom at the preset's own centre, as the other presets use.
  assert.equal(cam.zoom, homeCamera('globe', { observer: { lonDeg: cam.center[0], latDeg: cam.center[1] }, width: 1000, height: 800 }).zoom);
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
    nonsense: null,
    toString: null,
  };
  for (const [from, to] of Object.entries(table)) assert.equal(migrateProjection(from), to, from);
  assert.equal(migrateProjection(undefined), null);
  assert.equal(migrateProjection(null), null);
  assert.equal(migrateProjection(42), null);
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

const across = (width) => Math.log2(width / 512);
// How far a longitude sits east of the centre, -180 to 180.
const offset = (lon, centre) => ((((lon - centre) % 360) + 540) % 360) - 180;
// Half the view's width in degrees of longitude at a zoom.
const halfWidthDeg = (width, zoom) => (180 * width) / (512 * 2 ** zoom);

test('homeCamera flat centres on the circular mean of the observer and the points', () => {
  const { center } = homeCamera('flat', { points: [{ lonDeg: -170, latDeg: 0 }, { lonDeg: 170, latDeg: 10 }], ...size });
  assert.ok(Math.abs(Math.abs(center[0]) - 180) < 1e-6, `centre ${center[0]}`);
  assert.equal(center[1], 20);
  const withObs = homeCamera('flat', { observer: { latDeg: 41.9, lonDeg: -88 }, points: [{ lonDeg: -68, latDeg: 0 }], ...size });
  assert.ok(Math.abs(withObs.center[0] - -78) < 1e-6, `centre ${withObs.center[0]}`);
});

test('homeCamera flat with no points behaves as before', () => {
  const observer = { latDeg: 41.9, lonDeg: -88 };
  for (const s of [size, { width: 400, height: 800 }]) {
    assert.deepEqual(homeCamera('flat', { observer, points: [], ...s }), homeCamera('flat', { observer, ...s }));
  }
  assert.deepEqual(homeCamera('flat', { observer, points: [], ...size }).center, [-88, 20]);
});

test('homeCamera flat with a focus ignores the points', () => {
  const observer = { latDeg: 41.9, lonDeg: -88 };
  const focus = { latDeg: -10, lonDeg: 100 };
  const points = [{ lonDeg: -170, latDeg: 0 }, { lonDeg: 170, latDeg: 0 }];
  const tall = { width: 400, height: 800 };
  assert.deepEqual(homeCamera('flat', { observer, focus, points, ...tall }), homeCamera('flat', { observer, focus, ...tall }));
});

test('homeCamera flat zooms out just enough to fit the points with a margin', () => {
  const tall = { width: 400, height: 800 };
  const observer = { latDeg: 41.9, lonDeg: -88 };
  const base = homeCamera('flat', { observer, ...tall }).zoom;
  const points = [{ lonDeg: -150, latDeg: 0 }, { lonDeg: -20, latDeg: 0 }];
  const { center, zoom } = homeCamera('flat', { observer, points, ...tall });
  assert.ok(zoom < base && zoom > across(400), `zoom ${zoom}`);
  const half = halfWidthDeg(400, zoom);
  const far = Math.max(...[observer, ...points].map((p) => Math.abs(offset(p.lonDeg, center[0]))));
  // The furthest point sits exactly 5% of the width inside the edge.
  assert.ok(Math.abs(far - half * 0.9) < 1e-6, `far ${far}, half ${half}`);
  // Points that already fit keep the normal zoom.
  assert.equal(homeCamera('flat', { observer, points: [{ lonDeg: -80, latDeg: 0 }], ...tall }).zoom, base);
});

test('homeCamera flat never zooms out past the whole world across', () => {
  // Spread 300 degrees from -150 east round to 150: the mean sits at 180 and
  // the point at 0 is on the far side.
  const points = [{ lonDeg: -150, latDeg: 0 }, { lonDeg: 0, latDeg: 0 }, { lonDeg: 150, latDeg: 0 }];
  for (const s of [size, { width: 400, height: 800 }]) {
    assert.ok(Math.abs(homeCamera('flat', { points, ...s }).zoom - across(s.width)) < 1e-9);
  }
});

test('homeCamera globe centres on the observer, then the focus', () => {
  const observer = { latDeg: 41.9, lonDeg: -88 };
  const focus = { latDeg: -10, lonDeg: 100 };
  const g = homeCamera('globe', { observer, focus, width: 1024, height: 800 });
  assert.deepEqual(g.center, [-88, 41.9]);
  const cos = Math.cos((41.9 * Math.PI) / 180);
  assert.ok(Math.abs(g.zoom - (Math.log2(800 / 512) + 1.85 + Math.log2(cos))) < 1e-9, `zoom ${g.zoom}`);
  // On the equator the disc needs no latitude correction.
  assert.ok(Math.abs(homeCamera('globe', { observer: { latDeg: 0, lonDeg: 0 }, width: 512, height: 512 }).zoom - 1.85) < 1e-9);
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

test('the flat map zooms out until the whole world is in frame, whichever side fills first', () => {
  // Tall: the width fills.
  assert.equal(minZoomFor('flat', { width: 512, height: 900, latDeg: 0 }), 0);
  // Wide: the height fills, so both poles show.
  assert.equal(minZoomFor('flat', { width: 2048, height: 1024, latDeg: 40 }), 1);
  assert.equal(minZoomFor('flat', { width: 1024, height: 900, latDeg: 40 }), Math.log2(900 / 512));
});

test('the globe zooms out only until the whole Earth is in frame', () => {
  const size = { width: 1000, height: 800 };
  const home = (latDeg) => homeCamera('globe', { observer: { latDeg, lonDeg: 0 }, ...size }).zoom;
  // The floor is the equator's home zoom at any centre: MapLibre's globe
  // already lowers the floor by log2(cos latitude) itself, so adding that
  // here too let the disc shrink to a twelfth of its size at a pole.
  for (const latDeg of [0, 41.88, 60, 85.05, 89, 90, -90]) {
    assert.equal(minZoomFor('globe', { ...size, latDeg }), home(0), String(latDeg));
  }
  // At a pole, MapLibre's floor (ours plus log2(cos 85.05)) is the preset's zoom.
  const north = presetCamera('north', size).zoom;
  const cos = Math.cos((85.05 * Math.PI) / 180);
  assert.ok(Math.abs(minZoomFor('globe', { ...size, latDeg: 90 }) + Math.log2(cos) - north) < 1e-9);
});

// MapLibre's setMinZoom throws below -2, which froze a phone's ease to a pole.
test('the zoom floor never goes below MapLibre\'s own minimum of -2', () => {
  for (const latDeg of [0, 60, 85.05, 89, 90, -90]) {
    assert.ok(minZoomFor('globe', { width: 390, height: 500, latDeg }) >= -2, `globe ${latDeg}`);
    assert.ok(minZoomFor('globe', { width: 30, height: 30, latDeg }) >= -2, `tiny globe ${latDeg}`);
  }
  assert.equal(minZoomFor('flat', { width: 60, height: 60, latDeg: 0 }), -2);
});

// MapLibre's globe ease scales the Earth along the way only when the zoom
// number changes; pole to pole keeps the same number, so it is nudged.
test('a preset ease always changes the zoom number, by a hair when it would not', () => {
  const size = { width: 372, height: 504 };
  const north = presetCamera('north', size).zoom;
  const south = presetCamera('south', size).zoom;
  assert.equal(north, south);
  const z = easeZoom(north, south);
  assert.notEqual(z, north);
  assert.ok(Math.abs(z - south) < 1e-5);
  assert.equal(easeZoom(1, 2.5), 2.5);
  assert.equal(easeZoom(2.5, 1), 1);
});

test('defaultProjectionFor: globe on a narrow portrait screen, Mercator elsewhere', () => {
  assert.equal(defaultProjectionFor({ width: 360, height: 780 }), 'globe');
  assert.equal(defaultProjectionFor({ width: 600, height: 900 }), 'globe');
  assert.equal(defaultProjectionFor({ width: 780, height: 360 }), 'flat'); // phone on its side
  assert.equal(defaultProjectionFor({ width: 820, height: 1180 }), 'flat'); // tablet portrait
  assert.equal(defaultProjectionFor({ width: 1280, height: 800 }), 'flat');
  assert.equal(defaultProjectionFor({ width: 0, height: 0 }), 'flat');
});

test('nightRefreshMs: about a pixel per step, between 2 s and a minute', () => {
  assert.equal(nightRefreshMs(0), NIGHT_REFRESH_MAX_MS);
  assert.equal(nightRefreshMs(15), NIGHT_REFRESH_MIN_MS);
  // Zoom 5: 360 / (512 * 32) deg per px, swept at 240 s a degree.
  assert.equal(nightRefreshMs(5), (360 / (512 * 32)) * 240_000);
  for (let z = 0; z < 15; z++) assert.ok(nightRefreshMs(z + 1) <= nightRefreshMs(z), String(z));
});

test('a satellite page frames its satellite: between you and it when close, else on it', async () => {
  const { framedCentre, homeCamera, FRAME_BOTH_DEG } = await import('../lib/map/view.mjs');
  const chicago = { latDeg: 41.88, lonDeg: -87.63 };
  const near = { latDeg: 45, lonDeg: -60 };
  const c = framedCentre(chicago, near);
  assert.ok(c[0] > -87.63 && c[0] < -60 && c[1] > 41 && c[1] < 46, `midpoint ${c}`);
  const far = { latDeg: -30, lonDeg: 120 };
  assert.deepEqual(framedCentre(chicago, far), [120, -30]);
  assert.deepEqual(framedCentre(null, far), [120, -30]);
  assert.equal(FRAME_BOTH_DEG, 60);
  // Only when asked: the home page keeps centring on you.
  const size = { width: 400, height: 400 };
  assert.deepEqual(homeCamera('globe', { observer: chicago, focus: far, ...size }).center, [-87.63, 41.88]);
  assert.deepEqual(homeCamera('globe', { observer: chicago, focus: far, frameFocus: true, ...size }).center, [120, -30]);
});
