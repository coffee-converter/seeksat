// test/mcp-catalog.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, resolveSatellite } from '../lib/mcp/catalog.mjs';

test('catalog contains the ISS keyed by NORAD id', () => {
  const iss = CATALOG.find(s => s.noradId === 25544);
  assert.ok(iss, 'ISS present');
  assert.equal(iss.name, 'ISS (ZARYA)');
});

test('resolveSatellite matches by numeric id', () => {
  assert.equal(resolveSatellite(25544).noradId, 25544);
  assert.equal(resolveSatellite('25544').noradId, 25544);
});

test('resolveSatellite matches by name/alias case-insensitively', () => {
  assert.equal(resolveSatellite('iss').noradId, 25544);
  assert.equal(resolveSatellite('Hubble').noradId, 20580);
  assert.equal(resolveSatellite('TIANGONG').noradId, 48274);
});

test('resolveSatellite returns null for unknown input', () => {
  assert.equal(resolveSatellite('does-not-exist'), null);
  assert.equal(resolveSatellite(99999), null);
});
