import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridToLatLon, latLonToGrid, parseLocationInput } from '../lib/location/maidenhead.mjs';

test('EN52ve and EN52 centres', () => {
  const a = gridToLatLon('EN52ve');
  assert.ok(Math.abs(a.latDeg - 42.1875) < 1e-4 && Math.abs(a.lonDeg - -88.2083) < 1e-4);
  assert.deepEqual(gridToLatLon('EN52'), { latDeg: 42.5, lonDeg: -89 });
  assert.ok(gridToLatLon('en52VE'));
  assert.ok(gridToLatLon('EN52ve12'));
});
test('invalid squares are rejected', () => {
  for (const g of ['ZZ99', 'EN5', 'EN52v', 'EN52vz', '', 'EN52ve1']) assert.equal(gridToLatLon(g), null, g);
});
test('latLonToGrid, including poles and the antimeridian', () => {
  assert.equal(latLonToGrid(42.1875, -88.2083), 'EN52ve');
  assert.equal(latLonToGrid(90, 180), 'AR09ax');
  assert.equal(latLonToGrid(-90, -180), 'AA00aa');
  assert.equal(latLonToGrid(42.1875, -88.2083, 4), 'EN52');
});
test('parseLocationInput', () => {
  assert.deepEqual(parseLocationInput(' en52ve '), { kind: 'grid', grid: 'EN52ve', ...gridToLatLon('EN52ve') });
  assert.equal(parseLocationInput('42.19, -88.21').kind, 'coords');
  assert.deepEqual(parseLocationInput('Elgin, Illinois'), { kind: 'place', query: 'Elgin, Illinois' });
  assert.equal(parseLocationInput('   '), null);
});

test('parseLocationInput names out-of-range coordinates instead of searching for them', () => {
  const msg = 'Latitude runs from -90 to 90 and longitude from -180 to 180.';
  assert.deepEqual(parseLocationInput('91, 200'), { kind: 'invalid', message: msg });
  assert.deepEqual(parseLocationInput('-95.5, 10'), { kind: 'invalid', message: msg });
  assert.deepEqual(parseLocationInput('45, 181'), { kind: 'invalid', message: msg });
  assert.equal(parseLocationInput('90, 180').kind, 'coords');
  assert.equal(parseLocationInput('Paris, 75').kind, 'place');
});

test('parseLocationInput reads coordinates written several ways', async () => {
  const { parseLocationInput } = await import('../lib/location/maidenhead.mjs');
  const near = (r, lat, lon) => r.kind === 'coords' && Math.abs(r.latDeg - lat) < 0.01 && Math.abs(r.lonDeg - lon) < 0.01;
  for (const t of ['41.88, -87.63', '41.88 -87.63', '41.88N 87.63W', '41.88 N, 87.63 W', "41°52'48\"N 87°37'48\"W", "41°52.8'N, 87°37.8'W", '87.63W 41.88N', '41.88;-87.63']) {
    assert.ok(near(parseLocationInput(t), 41.88, -87.63), t);
  }
  assert.ok(near(parseLocationInput('-33.9 151.2'), -33.9, 151.2));
  // Not positions: place names, a latitude marked E.
  assert.equal(parseLocationInput('Chicago').kind, 'place');
  assert.equal(parseLocationInput('Route 66').kind, 'place');
  assert.equal(parseLocationInput('41.88E 87.63E').kind, 'place');
  assert.equal(parseLocationInput('St Louis, MO').kind, 'place');
});

test('parseLatLonText reads the many ways a position is written', async () => {
  const { parseLatLonText } = await import('../lib/location/maidenhead.mjs');
  const yes = [
    '41.88, -87.63', '41.88,-87.63', '41.88 -87.63', '41.88;-87.63', '41.88 | -87.63', '+41.88, -87.63',
    '41.88N 87.63W', '41.88N, 87.63W', '41.88 N 87.63 W', 'N41.88 W87.63', 'N 41.88, W 87.63', '87.63W 41.88N',
    "41°52'48\"N 87°37'48\"W", "41° 52' 48\" N, 87° 37' 48\" W", '41 52 48 N 87 37 48 W', '41°52.8′N, 87°37.8′W',
    '41°52′48″N 87°37′48″W', '41º52\'48"N 87º37\'48"W', '41.88°, -87.63°', '41.88° N, 87.63° W', '41d52m48sN 87d37m48sW', '41.88 deg N, 87.63 deg W', '41.88n 87.63w',
    'lat: 41.88, lon: -87.63', 'Lat 41.88 Lng -87.63', 'latitude 41.88 longitude -87.63', 'latitude=41.88&longitude=-87.63'.replace('&', ' '),
    '41,88; -87,63', 'geo:41.88,-87.63', 'https://www.google.com/maps/@41.88,-87.63,12z', 'https://maps.google.com/?q=41.88,-87.63',
    '41.88, −87.63', '41.88, –87.63', '-87.63, 41.88'.replace('-87.63, 41.88', '41.880, -87.630'),
  ];
  for (const t of yes) {
    const r = parseLatLonText(t);
    assert.ok(r && Math.abs(r.latDeg - 41.88) < 0.005 && Math.abs(r.lonDeg + 87.63) < 0.005, `${t} -> ${JSON.stringify(r)}`);
  }
  // Southern and eastern, and a swapped pair the numbers give away.
  const sy = parseLatLonText("33°52'S 151°12'E");
  assert.ok(Math.abs(sy.latDeg + 33.867) < 0.01 && Math.abs(sy.lonDeg - 151.2) < 0.01);
  // Out of range stays as written (parseLocationInput then says so).
  const swapped = parseLatLonText('151.2, -33.9');
  assert.deepEqual([swapped.latDeg, swapped.lonDeg], [151.2, -33.9]);
  // Not positions.
  for (const t of ['Chicago', 'Route 66', 'St Louis, MO', 'New York', 'North East', '41.88', '41.88E 87.63E', '-41.88S, 87.63W', '41 61 00 N, 87 00 00 W', 'I-80, Iowa', '10 Downing St, London', 'EN52ve']) {
    assert.equal(parseLatLonText(t), null, t);
  }
});
