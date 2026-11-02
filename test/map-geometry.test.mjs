import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { GOES16_LINE1, GOES16_LINE2, recordFrom } from './fixtures/orbits.mjs';
import { geoArea, geoCircle } from 'd3-geo';
import {
  footprintRadiusDeg, subsolarPoint, nightBands, groundTrack, subpoint, tickStepMin,
} from '../lib/map/geometry.mjs';

test('footprintRadiusDeg', () => {
  assert.ok(Math.abs(footprintRadiusDeg(420) - 20.256) < 0.01);
  assert.ok(Math.abs(footprintRadiusDeg(420, 10) - 12.497) < 0.01);
  assert.ok(Math.abs(footprintRadiusDeg(35786) - 81.308) < 0.01);
});
test('subsolarPoint at the June solstice, noon UTC', () => {
  const s = subsolarPoint(new Date('2026-06-21T12:00:00Z'));
  assert.ok(Math.abs(s.latDeg - 23.44) < 0.1 && Math.abs(s.lonDeg - 0.46) < 0.5);
});
test('nightBands are four nested circles around the antisolar point', () => {
  const bands = nightBands(new Date('2026-06-21T12:00:00Z'));
  assert.deepEqual(bands.map((b) => b.sunBelowDeg), [0, -6, -12, -18]);
  for (const b of bands) assert.equal(b.feature.type, 'Polygon');
});
test('ISS ground track: never crosses the antimeridian inside a line', () => {
  const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
  const g = groundTrack(iss, Date.parse('2026-03-01T12:00:00Z'));
  assert.equal(g.type, 'MultiLineString');
  for (const line of g.coordinates) for (let i = 1; i < line.length; i++) {
    assert.ok(Math.abs(line[i][0] - line[i - 1][0]) <= 180);
  }
  const lats = g.coordinates.flat().map((p) => p[1]);
  assert.ok(Math.max(...lats) <= 52 && Math.min(...lats) >= -52, 'bounded by inclination 51.6°');
});
test('GEO ground track stays near its longitude', () => {
  const g = makeTrack(recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'));
  const lons = groundTrack(g, Date.parse('2026-10-31T15:00:00Z')).coordinates.flat().map((p) => p[0]);
  assert.ok(Math.max(...lons) - Math.min(...lons) < 2);
});
test('subpoint of the ISS is about 400 km up', () => {
  const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
  const s = subpoint(iss.ecefAt(new Date('2026-03-01T12:00:00Z')));
  assert.ok(s.altKm > 380 && s.altKm < 450 && Math.abs(s.latDeg) <= 52);
});
test('night bands nest: deeper night is a smaller cap', () => {
  const areas = nightBands(new Date('2026-06-21T12:00:00Z')).map((b) => geoArea(b.feature));
  for (let i = 1; i < areas.length; i++) assert.ok(areas[i] < areas[i - 1]);
  assert.ok(Math.abs(areas[3] - geoArea(geoCircle().radius(72)())) < 1e-6);
});
test('a 1.25-orbit ISS track crosses the antimeridian into separate lines', () => {
  const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
  const g = groundTrack(iss, Date.parse('2026-03-01T12:00:00Z'));
  assert.ok(g.coordinates.length >= 2);
  for (const line of g.coordinates) for (let i = 1; i < line.length; i++) {
    assert.ok(Math.abs(line[i][0] - line[i - 1][0]) <= 180);
  }
});

test('a track split at the antimeridian meets it on both sides, with no gap', () => {
  const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
  const lines = groundTrack(iss, Date.parse('2026-03-01T12:00:00Z')).coordinates;
  assert.ok(lines.length >= 2);
  for (let k = 1; k < lines.length; k++) {
    const end = lines[k - 1].at(-1), start = lines[k][0];
    assert.equal(Math.abs(end[0]), 180, `line ${k - 1} ends on the date line`);
    assert.equal(start[0], -end[0], `line ${k} starts on the other side`);
    assert.equal(start[1], end[1], 'at the same latitude');
  }
});

import { splitTrack } from '../lib/map/geometry.mjs';
test('splitTrack: past ends and future starts at the now point; ticks 10 min for ISS, hourly for GOES', () => {
  const NOW = Date.parse('2026-03-01T12:00:00Z');
  const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
  const s = splitTrack(iss, NOW);
  const now = subpoint(iss.ecefAt(new Date(NOW)));
  const lastPast = s.past.coordinates.at(-1).at(-1);
  const firstFuture = s.future.coordinates[0][0];
  assert.deepEqual(lastPast, [now.lonDeg, now.latDeg]);
  assert.deepEqual(firstFuture, [now.lonDeg, now.latDeg]);
  assert.deepEqual(s.ticks.slice(0, 3).map((t) => t.minutes), [10, 20, 30]);
  assert.ok(s.ticks.at(-1).minutes <= iss.periodMs / 60000);
  for (const part of [s.past, s.future]) for (const line of part.coordinates) {
    for (let i = 1; i < line.length; i++) assert.ok(Math.abs(line[i][0] - line[i - 1][0]) <= 180);
  }
  const goes = makeTrack(recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'));
  const g = splitTrack(goes, NOW);
  assert.deepEqual(g.ticks.slice(0, 3).map((t) => t.minutes), [60, 120, 180]);
});

test('tickStepMin: 10 min under a 3 h period, else hourly; splitTrack ticks on it', () => {
  const H = 3_600_000;
  assert.equal(tickStepMin(92 * 60_000), 10);
  assert.equal(tickStepMin(3 * H - 1), 10);
  assert.equal(tickStepMin(3 * H), 60);
  assert.equal(tickStepMin(12 * H), 60);
  const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
  const { ticks } = splitTrack(iss, Date.parse('2026-03-01T12:00:00Z'));
  assert.equal(ticks[0].minutes, tickStepMin(iss.periodMs));
  const goes = makeTrack(recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'));
  assert.equal(splitTrack(goes, Date.parse('2026-03-01T12:00:00Z')).ticks[0].minutes, 60);
});

import { mapPolygons } from '../lib/map/geometry.mjs';

const ringOf = (lon, lat, r) => geoCircle().center([lon, lat]).radius(r)().coordinates[0];
const signedArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
};
const unwrapped = (ring) => {
  const out = [ring[0].slice()];
  for (let i = 1; i < ring.length; i++) {
    let d = ring[i][0] - ring[i - 1][0];
    d -= 360 * Math.round(d / 360);
    out.push([out[i - 1][0] + d, ring[i][1]]);
  }
  return out;
};
const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

test('mapPolygons leaves a small ring alone', () => {
  const ring = ringOf(0, 0, 10);
  const mp = mapPolygons(ring);
  assert.equal(mp.type, 'MultiPolygon');
  assert.equal(mp.coordinates.length, 1);
  const out = mp.coordinates[0][0];
  assert.equal(out.length, ring.length);
  const same = (ref) => ref.every((p, i) => near(p, out[i]));
  assert.ok(same(ring) || same(ring.slice().reverse()), 'points equal the input, up to winding');
});

// MapLibre (geojson-vt) wraps longitudes past +-180 onto the other side and
// clips them per tile, so a polygon that never has an edge on the date line
// never shows a seam there. mapPolygons keeps every ring in one piece.
const jumps = (ring) => ring.slice(1).map((p, i) => Math.abs(p[0] - ring[i][0]));
const onDateLine = (lon) => Math.abs(Math.abs(lon % 360) - 180) < 1e-9;
const dateLineEdges = (ring) => ring.slice(1).filter((p, i) => onDateLine(p[0]) && onDateLine(ring[i][0]));
// The same closed ring, starting at its vertex on the date line.
const startOnDateLine = (ring) => {
  const open = ring.slice(0, -1);
  const i = open.findIndex((p) => onDateLine(p[0]));
  const out = [...open.slice(i), ...open.slice(0, i)];
  return [...out, out[0].slice()];
};
const NOV = nightBands(new Date('2026-11-02T17:48:00Z')).map((b) => b.feature.coordinates[0]);

test('mapPolygons keeps a ring across the date line in one piece', () => {
  const ring = ringOf(179, 0, 10);
  const mp = mapPolygons(ring);
  assert.equal(mp.coordinates.length, 1);
  const out = mp.coordinates[0][0];
  assert.ok(Math.max(...jumps(out)) < 10, 'longitudes run on with no jump');
  const lons = out.map((p) => p[0]);
  assert.ok(Math.min(...lons) < 180 && Math.max(...lons) > 180, `spans 180 unwrapped: ${Math.min(...lons)}..${Math.max(...lons)}`);
  assert.ok(lons.every((lon) => lon >= -540 && lon <= 540), 'within the range MapLibre wraps');
  const whole = Math.abs(signedArea(unwrapped(ring)));
  assert.ok(Math.abs(Math.abs(signedArea(out)) - whole) / whole < 1e-9, 'same area as the input');
});

test('mapPolygons closes a ring around a pole across one unwrapped turn', () => {
  const band = nightBands(new Date('2026-06-21T12:00:00Z'))[0];
  const mp = mapPolygons(band.feature.coordinates[0]);
  assert.equal(mp.coordinates.length, 1);
  const out = mp.coordinates[0][0];
  assert.ok(out.some((p) => p[1] === -90), 'has a vertex at the South Pole');
  assert.ok(!out.some((p) => p[1] === 90), 'no vertex at the North Pole');
  const lons = out.filter((p) => p[1] !== -90).map((p) => p[0]);
  assert.ok(Math.abs(Math.max(...lons) - Math.min(...lons) - 360) < 1e-9, 'the ring part spans exactly 360');
  const ringEdges = jumps(out).filter((_, i) => out[i][1] !== -90 && out[i + 1][1] !== -90);
  assert.ok(Math.max(...ringEdges) < 10, 'the ring part runs on with no jump');
  assert.ok(out.every((p) => p[0] >= -540 && p[0] <= 540), 'within the range MapLibre wraps');
});

test('mapPolygons never puts an edge on the date line', () => {
  const rings = [
    ringOf(179, 0, 10),
    ringOf(-179, 40, 25),
    ringOf(180, 0, 81),
    ringOf(30, 80, 20),
    startOnDateLine(ringOf(0, 80, 20)),
    startOnDateLine(ringOf(0, -80, 30)),
    ...NOV,
    ...nightBands(new Date('2026-06-21T12:00:00Z')).map((b) => b.feature.coordinates[0]),
    ...nightBands(new Date('2026-12-21T12:00:00Z')).map((b) => b.feature.coordinates[0]),
  ];
  for (const ring of rings) {
    for (const poly of mapPolygons(ring).coordinates) {
      assert.deepEqual(dateLineEdges(poly[0]), [], 'no edge runs along lon 180');
    }
  }
});

test('mapPolygons winds outer rings counter-clockwise', () => {
  const rings = [
    ringOf(0, 0, 10),
    ringOf(179, 0, 10),
    ringOf(-179, 40, 25),
    ringOf(30, 80, 20),
    ...nightBands(new Date('2026-06-21T12:00:00Z')).map((b) => b.feature.coordinates[0]),
    ...nightBands(new Date('2026-12-21T12:00:00Z')).map((b) => b.feature.coordinates[0]),
    ...NOV,
  ];
  for (const ring of rings) for (const poly of mapPolygons(ring).coordinates) {
    assert.ok(signedArea(poly[0]) > 0, 'outer ring is counter-clockwise');
  }
});

import { densifyLine, trackDetailFor } from '../lib/map/geometry.mjs';

test('densifyLine with factor 1 returns the line unchanged', () => {
  const line = [[0, 0], [1, 1], [2, 1.5]];
  assert.deepEqual(densifyLine(line, 1), line);
});

test('densifyLine curves through the samples close to the true ISS track', () => {
  const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
  const t0 = Date.parse('2026-03-01T12:00:00Z');
  const at = (ms) => { const s = subpoint(iss.ecefAt(new Date(ms))); return [s.lonDeg, s.latDeg]; };
  // 30 s samples over 10 minutes, away from the date line.
  const coarse = [];
  for (let ms = t0; ms <= t0 + 600_000; ms += 30_000) coarse.push(at(ms));
  assert.ok(coarse.every(([lon], i) => i === 0 || Math.abs(lon - coarse[i - 1][0]) < 180));
  const dense = densifyLine(coarse, 6);
  assert.equal(dense.length, (coarse.length - 1) * 6 + 1);
  // Every 5 s point lands within 0.002 deg (about 200 m) of SGP4's.
  let worst = 0;
  for (let i = 0; i < dense.length; i++) {
    const [lon, lat] = at(t0 + i * 5_000);
    worst = Math.max(worst, Math.hypot(dense[i][0] - lon, dense[i][1] - lat));
  }
  assert.ok(worst < 0.002, `worst ${worst} deg`);
  // A straight-line (linear) fill would be far worse, so the test has teeth.
  let linear = 0;
  for (let i = 0; i < dense.length; i++) {
    const k = Math.floor(i / 6), f = (i % 6) / 6;
    const a = coarse[k], b = coarse[Math.min(k + 1, coarse.length - 1)];
    const [lon, lat] = at(t0 + i * 5_000);
    linear = Math.max(linear, Math.hypot(a[0] + (b[0] - a[0]) * f - lon, a[1] + (b[1] - a[1]) * f - lat));
  }
  assert.ok(linear > worst * 5, `linear ${linear} vs spline ${worst}`);
});

test('densifyLine keeps longitudes in range next to the date line', () => {
  const line = [[178, 10], [179, 10.5], [179.9, 11]];
  for (const [lon] of densifyLine(line, 8)) assert.ok(lon >= -180 && lon <= 180 && lon > 170);
});

test('trackDetailFor adds points as the map zooms in', () => {
  assert.equal(trackDetailFor(2), 1);
  assert.equal(trackDetailFor(5), 1);
  assert.ok(trackDetailFor(10) >= 4);
  assert.ok(trackDetailFor(15) >= 24 && trackDetailFor(15) <= 64);
  for (let z = 0; z < 15; z += 0.5) assert.ok(trackDetailFor(z + 0.5) >= trackDetailFor(z));
});

import { ringLine } from '../lib/map/geometry.mjs';

test('ringLine stops at 85.05 degrees, where MapLibre tiles end', () => {
  // A polar-orbit footprint reaching past the tile edge (centre 72N, 22 deg radius).
  const ring = geoCircle().center([-20, 72]).radius(22)().coordinates[0];
  const edge = ringLine(ring);
  assert.equal(edge.type, 'MultiLineString');
  const pts = edge.coordinates.flat();
  assert.ok(pts.every(([, lat]) => Math.abs(lat) <= 85.0511 + 1e-9), 'no point past the tile edge');
  // The cut ends sit on the edge itself, not short of it.
  const ends = edge.coordinates.flatMap((l) => [l[0], l[l.length - 1]]);
  assert.ok(ends.some(([, lat]) => Math.abs(lat - 85.0511) < 1e-6), 'a cut end lies on 85.05');
});

test('ringLine leaves a footprint well clear of the poles in one piece', () => {
  const ring = geoCircle().center([10, 20]).radius(20)().coordinates[0];
  const edge = ringLine(ring);
  assert.equal(edge.coordinates.length, 1);
  const line = edge.coordinates[0];
  assert.deepEqual(line[0], line[line.length - 1]);
});
