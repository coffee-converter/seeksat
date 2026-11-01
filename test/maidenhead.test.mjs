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
