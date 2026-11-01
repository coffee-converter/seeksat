import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { GOES16_LINE1, GOES16_LINE2, recordFrom } from './fixtures/orbits.mjs';
import {
  footprintRadiusDeg, subsolarPoint, nightBands, groundTrack, subpoint, loadLand,
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
test('loadLand returns land polygons', () => {
  const land = loadLand();
  assert.ok(['Feature', 'FeatureCollection'].includes(land.type));
});
