import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { dashboardValues, liveNumbers, orbitElements } from '../lib/sat/numbers.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { recordFrom } from './fixtures/orbits.mjs';

const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
// At the epoch the ISS is over the Mediterranean in daylight; 50 minutes
// later it is south of the equator over the Pacific, in Earth's shadow.
const SUNLIT_MS = Date.parse('2026-03-01T12:00:00Z');
const SHADOW_MS = SUNLIT_MS + 50 * 60_000;

test('sunlit: the ISS fixture is sunlit at the epoch and in shadow 50 min later', () => {
  assert.equal(liveNumbers(iss, new Date(SUNLIT_MS)).sunlit, true);
  assert.equal(liveNumbers(iss, new Date(SHADOW_MS)).sunlit, false);
});

test('dashboardValues: keys, labels, units and notes in order', () => {
  const rows = dashboardValues(liveNumbers(iss, new Date(SUNLIT_MS)), orbitElements(iss));
  assert.deepEqual(rows.map((r) => [r.key, r.label, r.unit, r.note]), [
    ['altitude', 'Altitude', 'km', 'above the WGS84 ellipsoid'],
    ['speed', 'Speed', 'km/s', 'inertial, from SGP4'],
    ['groundSpeed', 'Ground speed', 'km/s', "over Earth's surface"],
    ['radius', "From Earth's center", 'km', 'distance, from SGP4'],
    ['lat', 'Latitude', '', 'below the satellite'],
    ['lon', 'Longitude', '', 'below the satellite'],
    ['sun', 'Sunlight', '', "Earth's shadow and atmosphere"],
  ]);
});

test('dashboardValues: digits and hemisphere letters at the sunlit moment', () => {
  const v = Object.fromEntries(
    dashboardValues(liveNumbers(iss, new Date(SUNLIT_MS)), orbitElements(iss)).map((r) => [r.key, r.value]),
  );
  assert.equal(v.altitude, '420.1');
  assert.equal(v.speed, '7.664');
  assert.equal(v.groundSpeed, '6.905');
  assert.equal(v.radius, '6,790.5');
  assert.equal(v.lat, '37.009° N');
  assert.equal(v.lon, '4.304° E');
  assert.equal(v.sun, 'Sunlit');
});

test('dashboardValues: southern and western hemispheres, in shadow', () => {
  const v = Object.fromEntries(
    dashboardValues(liveNumbers(iss, new Date(SHADOW_MS)), orbitElements(iss)).map((r) => [r.key, r.value]),
  );
  assert.equal(v.lat, '27.767° S');
  assert.equal(v.lon, '176.494° W');
  assert.equal(v.sun, 'In shadow');
});

test('dashboardValues: the Sunlight tile reads partly lit in the penumbra', () => {
  const sun = (litFraction) => dashboardValues({ ...liveNumbers(iss, new Date(SUNLIT_MS)), litFraction }, orbitElements(iss)).find((r) => r.key === 'sun').value;
  assert.equal(sun(1), 'Sunlit');
  assert.equal(sun(0.42), 'Partly lit, 42%');
  assert.equal(sun(0.001), 'Partly lit, 1%');
  assert.equal(sun(0.9999), 'Partly lit, 99%');
  assert.equal(sun(0), 'In shadow');
});
