import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAY_SOURCES, overlayColors, overlayData, overlayImages, overlayLayers } from '../lib/map/overlays.mjs';
import { basemapColors } from '../lib/map/basemap.mjs';
import { footprintFeature } from '../lib/map/geometry.mjs';

const NIGHT = new Date('2026-11-02T12:00:00Z');

// A track running east across the date line, split there the way
// geometry.mjs sampleLines splits it.
function track(lon0, lat, n = 40) {
  const pts = Array.from({ length: n }, (_, i) => {
    const lon = lon0 + i * 3;
    return [lon > 180 ? lon - 360 : lon, lat + i * 0.5];
  });
  const cut = pts.findIndex((p, i) => i > 0 && Math.abs(p[0] - pts[i - 1][0]) > 180);
  return { type: 'MultiLineString', coordinates: cut < 0 ? [pts] : [pts.slice(0, cut), pts.slice(cut)] };
}

function sat(noradId, emphasis, extra = {}) {
  return {
    noradId,
    name: `SAT ${noradId}`,
    color: '#ff9b54',
    trackPast: { type: 'MultiLineString', coordinates: [[[100, 0], [110, 2], [120, 4]]] },
    trackFuture: track(120, 4),
    trackTicks: [
      { lonDeg: 132, latDeg: 6, minutes: 10 },
      { lonDeg: 150, latDeg: 9, minutes: 20 },
      { lonDeg: 168, latDeg: 12, minutes: 30 },
    ],
    position: { lonDeg: 120, latDeg: 4 },
    footprint: emphasis === 'focus' ? footprintFeature({ lonDeg: 179, latDeg: 10 }, 800, 0) : null,
    selected: emphasis === 'focus',
    emphasis,
    orbitClass: 'leo',
    tickMin: 10,
    ...extra,
  };
}

const SATS = [sat(1, 'focus'), sat(2, 'normal'), sat(3, 'ghost'), sat(4, 'hidden')];
const OBSERVER = { name: 'Home', latDeg: 41.9, lonDeg: -87.6 };

function build(over = {}) {
  return overlayData({ sats: SATS, observer: OBSERVER, nightDate: NIGHT, shortTrackIds: new Set(), ...over });
}
const ids = (fc) => fc.features.map((f) => f.properties.noradId);

test('overlayData builds every source', () => {
  const data = build({ graticule: true });
  assert.deepEqual(Object.keys(data).sort(), [...OVERLAY_SOURCES].sort());
  for (const id of OVERLAY_SOURCES) {
    assert.equal(data[id].type, 'FeatureCollection', id);
    assert.ok(Array.isArray(data[id].features), id);
  }
  assert.equal(data['ss-night'].features.length, 4);
  assert.deepEqual(data['ss-night'].features.map((f) => f.properties.band), [0, -6, -12, -18]);
  assert.equal(data['ss-observer'].features.length, 1);
  assert.deepEqual(data['ss-observer'].features[0].geometry.coordinates, [-87.6, 41.9]);
  assert.equal(build({ observer: null })['ss-observer'].features.length, 0);
});

test('hidden satellites are not drawn and ghosts have no track', () => {
  const data = build({ graticule: true });
  for (const id of OVERLAY_SOURCES) {
    assert.ok(!ids(data[id]).includes(4), `hidden satellite in ${id}`);
  }
  const ghost = data['ss-sats'].features.find((f) => f.properties.noradId === 3);
  assert.ok(ghost);
  assert.equal(ghost.properties.name, '');
  assert.equal(ghost.properties.emphasis, 'ghost');
  for (const id of ['ss-track-past', 'ss-track-future', 'ss-marks']) {
    assert.ok(!ids(data[id]).includes(3), `ghost in ${id}`);
  }
  const keys = Object.fromEntries(data['ss-sats'].features.map((f) => [f.properties.noradId, f.properties.sortKey]));
  assert.deepEqual(keys, { 1: 2, 2: 1, 3: 0 });
  const focus = data['ss-sats'].features.find((f) => f.properties.noradId === 1);
  assert.equal(focus.properties.name, 'SAT 1');
  assert.deepEqual(focus.geometry.coordinates, [120, 4]);
});

test('future track fades over 8 chunks', () => {
  const chunks = build()['ss-track-future'].features.filter((f) => f.properties.noradId === 1);
  assert.equal(chunks.length, 8);
  const op = chunks.map((f) => f.properties.opacity);
  assert.equal(op[0], 1);
  assert.ok(Math.abs(op[7] - 0.25) < 1e-9);
  for (let i = 1; i < 8; i++) assert.ok(op[i] < op[i - 1], `chunk ${i} is not fainter`);
  // Every point is kept, and no chunk joins across the date line.
  const lines = chunks.flatMap((f) => f.geometry.coordinates);
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) assert.ok(Math.abs(line[i][0] - line[i - 1][0]) < 180);
  }
  const points = new Set(lines.flat().map((p) => p.join()));
  assert.equal(points.size, 40);
});

test('marks skip short tracks', () => {
  const marks = build({ shortTrackIds: new Set([1]) })['ss-marks'];
  assert.ok(!ids(marks).includes(1));
  assert.ok(ids(marks).includes(2));
});

test('marks have a chevron and a tick per time tick, with bearings', () => {
  const marks = build()['ss-marks'].features.filter((f) => f.properties.noradId === 1);
  const chevrons = marks.filter((f) => f.properties.kind === 'chevron');
  const ticks = marks.filter((f) => f.properties.kind === 'tick');
  assert.equal(chevrons.length, 1);
  assert.equal(ticks.length, 3);
  // The track heads east and a little north.
  const [lon, lat] = chevrons[0].geometry.coordinates;
  assert.ok(Math.abs(lon - 120.3) < 1e-9 && Math.abs(lat - 4.05) < 1e-9);
  for (const f of marks) {
    const b = f.properties.bearing;
    assert.ok(b > 45 && b < 90, `${f.properties.kind} bearing ${b}`);
  }
});

test('the chevron sits in the same place at every track detail', () => {
  const chevron = (detail) => build({ trackDetail: detail })['ss-marks'].features
    .find((f) => f.properties.noradId === 1 && f.properties.kind === 'chevron');
  const plain = chevron(1);
  const fine = chevron(8);
  assert.deepEqual(fine.geometry.coordinates, plain.geometry.coordinates);
  assert.equal(fine.properties.bearing, plain.properties.bearing);
});

test('only the focus gets tick labels, and only two', () => {
  const marks = build()['ss-marks'].features;
  const labels = (id) => marks.filter((f) => f.properties.noradId === id && f.properties.label).map((f) => f.properties.label);
  assert.deepEqual(labels(1), ['+10m', '+20m']);
  assert.deepEqual(labels(2), []);
  const hourly = overlayData({
    sats: [sat(5, 'focus', { trackTicks: [{ lonDeg: 132, latDeg: 6, minutes: 60 }, { lonDeg: 150, latDeg: 9, minutes: 120 }] })],
    observer: null, nightDate: NIGHT, shortTrackIds: new Set(),
  })['ss-marks'].features.map((f) => f.properties.label).filter(Boolean);
  assert.deepEqual(hourly, ['+1h', '+2h']);
});

test('footprint only for the focus', () => {
  assert.ok(build()['ss-footprint'].features.length > 0);
  assert.ok(build()['ss-footprint'].features.every((f) => f.properties.color === '#ff9b54'));
  const noFocus = build({ sats: [sat(2, 'normal'), sat(3, 'ghost')] });
  assert.equal(noFocus['ss-footprint'].features.length, 0);
});

test('night and footprint run on past the date line in one piece', () => {
  const data = build();
  const lons = (coords) => (typeof coords[0] === 'number' ? [coords[0]] : coords.flatMap(lons));
  for (const id of ['ss-night', 'ss-footprint']) {
    for (const f of data[id].features) {
      for (const lon of lons(f.geometry.coordinates)) assert.ok(lon >= -540 && lon <= 540, `${id} lon ${lon}`);
    }
  }
  assert.ok(data['ss-night'].features.every((f) => f.geometry.type === 'MultiPolygon' && f.geometry.coordinates.length === 1));
  // The footprint centred on 179E crosses the date line: one area, running
  // on past 180 rather than cut there.
  const area = data['ss-footprint'].features.find((f) => f.properties.part === 'area');
  assert.equal(area.geometry.coordinates.length, 1);
  assert.ok(Math.max(...lons(area.geometry.coordinates)) > 180);
});

const COLORS = overlayColors('dark');
const LAYER_IDS = [
  'ss-graticule', 'ss-graticule-fine', 'ss-night', 'ss-footprint-fill', 'ss-track-past', 'ss-track-future', 'ss-marks', 'ss-observer', 'ss-sats', 'ss-sats-focus',
];

test('overlayLayers keeps the overlay order', () => {
  const layers = overlayLayers(COLORS);
  assert.deepEqual(layers.map((l) => l.id), LAYER_IDS);
  for (const l of layers) assert.ok(OVERLAY_SOURCES.includes(l.source), `${l.id} source ${l.source}`);
  const sats = layers.find((l) => l.id === 'ss-sats');
  const focus = layers.find((l) => l.id === 'ss-sats-focus');
  for (const l of [sats, focus]) {
    assert.equal(l.source, 'ss-sats');
    assert.equal(l.layout['icon-allow-overlap'], true);
    assert.equal(l.layout['icon-ignore-placement'], false);
    assert.equal(l.layout['text-optional'], true);
    assert.deepEqual(l.layout['text-variable-anchor'], ['left', 'right']);
    assert.deepEqual(l.layout['symbol-sort-key'], ['get', 'sortKey']);
    assert.equal(l.paint['text-halo-color'], COLORS.water);
    assert.equal(l.paint['icon-halo-color'], COLORS.water);
  }
  // The focus is placed first, on its own layer; ss-sats has everything else.
  assert.deepEqual(focus.filter, ['==', ['get', 'emphasis'], 'focus']);
  assert.deepEqual(sats.filter, ['!=', ['get', 'emphasis'], 'focus']);
  // FlatMap draws the focus itself, so its layer only holds the place.
  assert.equal(focus.paint['icon-opacity'], 0);
  assert.equal(focus.paint['text-opacity'], 0);
  assert.notEqual(sats.paint['icon-opacity'], 0);
  assert.equal(sats.paint['text-opacity'], 1);
});

function iconNames(expr) {
  if (typeof expr === 'string') return expr.startsWith('ss-') ? [expr] : [];
  return Array.isArray(expr) ? expr.flatMap(iconNames) : [];
}

test('overlayImages draws every icon the layers name', () => {
  const images = overlayImages(COLORS);
  const byId = new Map(images.map((i) => [i.id, i]));
  const named = overlayLayers(COLORS).flatMap((l) => iconNames(l.layout?.['icon-image']));
  assert.deepEqual([...new Set(named)].sort(), ['ss-chevron', 'ss-dot', 'ss-dot-focus', 'ss-dot-ghost', 'ss-observer', 'ss-tick']);
  for (const id of named) {
    const img = byId.get(id);
    assert.ok(img, `no image for ${id}`);
    assert.ok(img.data instanceof Uint8ClampedArray);
    assert.equal(img.data.length, img.width * img.height * 4);
    assert.ok(img.data.some((v, i) => i % 4 === 3 && v > 0), `${id} is blank`);
  }
  for (const id of ['ss-chevron', 'ss-tick', 'ss-dot', 'ss-dot-focus', 'ss-dot-ghost']) assert.equal(byId.get(id).sdf, true, id);
  assert.equal(byId.get('ss-observer').sdf, false);
});

test('a dot image is a signed distance disc with room for its ring', () => {
  const dot = overlayImages(COLORS).find((i) => i.id === 'ss-dot');
  const alpha = (x, y) => dot.data[(y * dot.width + x) * 4 + 3];
  const c = dot.width / 2;
  // Inside is opaque, the corner is clear, and the ring's 2 px past the edge still has distance.
  assert.equal(alpha(c, c), 255);
  assert.equal(alpha(0, 0), 0);
  const edge = Math.floor(c + 4 + 1.5);
  assert.ok(alpha(edge, Math.floor(c)) > 0 && alpha(edge, Math.floor(c)) < 192);
});

test('overlayColors takes water from the basemap and keeps the canvas observer and night', () => {
  assert.equal(overlayColors('dark').water, basemapColors('dark').water);
  assert.equal(overlayColors('light').water, basemapColors('light').water);
  assert.deepEqual(overlayColors('dark'), { water: basemapColors('dark').water, observer: '#8fb4e6', night: 'rgba(3, 5, 12, 0.24)', graticule: '#a7b0bf' });
  assert.deepEqual(overlayColors('light'), { water: basemapColors('light').water, observer: '#2c5a99', night: 'rgba(20, 30, 60, 0.07)', graticule: '#3d4757' });
});

test('trackDetail curves extra points into past and future tracks', () => {
  const count = (fc) => fc.features.filter((f) => f.properties.noradId === 1)
    .flatMap((f) => f.geometry.coordinates).reduce((n, line) => n + line.length, 0);
  const plain = build();
  const fine = build({ trackDetail: 4 });
  assert.ok(count(fine['ss-track-future']) > 3 * count(plain['ss-track-future']));
  // One past line of n points becomes (n - 1) * 4 + 1.
  assert.equal(count(fine['ss-track-past']), (count(plain['ss-track-past']) - 1) * 4 + 1);
  // The same track and detail reuse the curved lines instead of recomputing them.
  const again = build({ trackDetail: 4 });
  assert.equal(
    again['ss-track-past'].features[0].geometry.coordinates[0],
    fine['ss-track-past'].features[0].geometry.coordinates[0],
  );
});

test('tracks: false leaves out the track sources without reading the tracks', () => {
  let reads = 0;
  const watched = SATS.map((s) => {
    const copy = { ...s };
    for (const k of ['trackPast', 'trackFuture', 'trackTicks']) {
      Object.defineProperty(copy, k, { get: () => { reads++; return s[k]; }, enumerable: true });
    }
    return copy;
  });
  const data = overlayData({ sats: watched, observer: OBSERVER, trackDetail: 8, tracks: false });
  assert.equal(reads, 0);
  for (const id of ['ss-track-past', 'ss-track-future', 'ss-marks']) assert.ok(!(id in data), id);
  assert.equal(data['ss-sats'].features.length, 3);
  assert.equal(data['ss-footprint'].features.length, 1);
  assert.equal(data['ss-observer'].features.length, 1);
  // The default still builds them.
  const all = overlayData({ sats: watched, observer: OBSERVER, trackDetail: 8 });
  for (const id of ['ss-track-past', 'ss-track-future', 'ss-marks']) assert.ok(all[id].features.length > 0, id);
});

test('the footprint is a faint fill with no outline, so it is not read as a track', () => {
  const fill = overlayLayers(COLORS).find((l) => l.id === 'ss-footprint-fill');
  assert.ok(fill.paint['fill-opacity'] <= 0.1, `fill-opacity ${fill.paint['fill-opacity']}`);
  assert.ok(!overlayLayers(COLORS).some((l) => l.source === 'ss-footprint' && l.type === 'line'));
});

test('the lat/lon grid is static and only built on request', () => {
  assert.equal(build()['ss-graticule'], undefined);
  const grid = build({ graticule: true })['ss-graticule'].features;
  const meridians = grid.filter((f) => f.properties.kind === 'meridian');
  const parallels = grid.filter((f) => f.properties.kind === 'parallel');
  assert.equal(meridians.length, 72); // every 5 degrees
  assert.equal(parallels.length, 35); // -85 to 85 every 5 degrees
  const rankOf = (f) => f.properties.rank;
  assert.equal(rankOf(parallels.find((f) => f.properties.deg === 0)), 'equator');
  assert.equal(rankOf(meridians.find((f) => f.properties.deg === 30)), 30);
  assert.equal(rankOf(meridians.find((f) => f.properties.deg === 20)), 10);
  assert.equal(rankOf(meridians.find((f) => f.properties.deg === 25)), 5);
  for (const f of grid) for (const [lon, lat] of f.geometry.coordinates) {
    assert.ok(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90);
  }
  // Parallels have enough points to curve on the globe.
  assert.ok(parallels.every((f) => f.geometry.coordinates.length >= 90));
  // Built once and reused.
  assert.equal(build({ graticule: true })['ss-graticule'], build({ graticule: true })['ss-graticule']);
});

test('the static grid sits under everything, faint, at globe level', () => {
  const grid = overlayLayers(COLORS).find((l) => l.id === 'ss-graticule');
  assert.equal(grid.source, 'ss-graticule');
  assert.equal(grid.paint['line-color'], COLORS.graticule);
  assert.ok(typeof COLORS.graticule === 'string');
  // A match expression may not mix string and number cases (MapLibre rejects the layer).
  const matches = [];
  const walk = (e) => {
    if (Array.isArray(e)) { if (e[0] === 'match') matches.push(e); e.forEach(walk); } else if (e && typeof e === 'object') Object.values(e).forEach(walk);
  };
  walk(grid.paint);
  assert.ok(matches.length >= 1, 'found the match expressions');
  for (const m of matches) {
    const labels = m.slice(2, -1).filter((_, i) => i % 2 === 0);
    assert.equal(new Set(labels.map((l) => typeof l)).size, 1, `mixed match labels: ${JSON.stringify(labels)}`);
  }
});


// A highly elliptical orbit gets extra track points where it moves fast, so
// the fade is cut by time, not by point count: each chunk is an eighth of it.
import { splitTrack } from '../lib/map/geometry.mjs';
import { makeTrack } from '../lib/sat/track.mjs';
import { MOLNIYA_LINE1, MOLNIYA_LINE2, recordFrom as molRecord } from './fixtures/orbits.mjs';
test('the future fade is cut by time on a highly elliptical track', () => {
  const now = Date.parse('2023-06-27T12:00:00Z');
  const split = splitTrack(makeTrack(molRecord(MOLNIYA_LINE1, MOLNIYA_LINE2, 'Molniya')), now);
  const sat = { noradId: 7, name: 'M', color: '#ffffff', emphasis: 'normal', sub: { latDeg: 0, lonDeg: 0 },
    trackPast: split.past, trackFuture: split.future, trackTicks: [] };
  const chunks = overlayData({ sats: [sat] })['ss-track-future'].features;
  assert.equal(chunks.length, 8);
  // Each chunk starts at the time an eighth further on, give or take one step.
  const timeOf = new Map();
  split.future.coordinates.forEach((line, k) => line.forEach((p, i) => timeOf.set(p.join(), split.future.times[k][i])));
  const t0 = split.future.times[0][0];
  const span = split.future.times.at(-1).at(-1) - t0;
  chunks.forEach((c, i) => {
    const start = timeOf.get(c.geometry.coordinates[0][0].join());
    assert.ok(Math.abs(start - t0 - (i * span) / 8) <= span / 192 + 1, `chunk ${i} starts ${((start - t0) / span).toFixed(3)}`);
  });
});
