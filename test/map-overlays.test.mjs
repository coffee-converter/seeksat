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
  const data = build();
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
  const data = build();
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

test('night and footprint use repaired polygons', () => {
  const data = build();
  const lons = (coords) => (typeof coords[0] === 'number' ? [coords[0]] : coords.flatMap(lons));
  for (const id of ['ss-night', 'ss-footprint']) {
    for (const f of data[id].features) {
      for (const lon of lons(f.geometry.coordinates)) assert.ok(lon >= -180 && lon <= 180, `${id} lon ${lon}`);
    }
  }
  assert.ok(data['ss-night'].features.every((f) => f.geometry.type === 'MultiPolygon'));
  // The footprint centred on 179E crosses the date line, so its area has two pieces.
  const area = data['ss-footprint'].features.find((f) => f.geometry.type === 'MultiPolygon');
  assert.equal(area.geometry.coordinates.length, 2);
});

const COLORS = overlayColors('dark');
const LAYER_IDS = [
  'ss-night', 'ss-footprint-fill', 'ss-footprint-line', 'ss-track-past', 'ss-track-future', 'ss-marks', 'ss-observer', 'ss-sats',
];

test('overlayLayers keeps the overlay order', () => {
  const layers = overlayLayers(COLORS);
  assert.deepEqual(layers.map((l) => l.id), LAYER_IDS);
  for (const l of layers) assert.ok(OVERLAY_SOURCES.includes(l.source), `${l.id} source ${l.source}`);
  const sats = layers.find((l) => l.id === 'ss-sats');
  assert.equal(sats.layout['icon-allow-overlap'], true);
  assert.equal(sats.layout['icon-ignore-placement'], false);
  assert.equal(sats.layout['text-optional'], true);
  assert.deepEqual(sats.layout['text-variable-anchor'], ['left', 'right']);
  assert.equal(sats.paint['text-halo-color'], COLORS.water);
  assert.equal(sats.paint['icon-halo-color'], COLORS.water);
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
  assert.deepEqual(overlayColors('dark'), { water: basemapColors('dark').water, observer: '#7eb8ff', night: 'rgba(3, 5, 12, 0.24)' });
  assert.deepEqual(overlayColors('light'), { water: basemapColors('light').water, observer: '#1f5fbf', night: 'rgba(20, 30, 60, 0.07)' });
});
