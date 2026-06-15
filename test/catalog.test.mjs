import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, resolveSatellite } from '../lib/catalog.mjs';

test('catalog has the 5 starter satellites', () => {
  assert.equal(CATALOG.length, 5);
  const ids = CATALOG.map(s => s.noradId).sort((a, b) => a - b);
  assert.deepEqual(ids, [20580, 25544, 33591, 48274, 53807]);
});

test('every entry has the enriched, valid shape', () => {
  for (const s of CATALOG) {
    assert.equal(typeof s.noradId, 'number');
    assert.equal(typeof s.name, 'string');
    assert.ok(typeof s.shortName === 'string' && s.shortName.length > 0, `${s.name} shortName`);
    assert.ok(Array.isArray(s.aliases));
    assert.ok(['free', 'premium'].includes(s.tier), `${s.name} tier`);
    assert.equal(typeof s.inclinationDeg, 'number');
    assert.ok(s.viewingHint === null || typeof s.viewingHint === 'string');
    assert.ok(['visual', 'radio'].includes(s.defaultMode), `${s.name} mode`);
  }
});

test('all starter satellites are free for now', () => {
  assert.ok(CATALOG.every(s => s.tier === 'free'));
});

test('NOAA-19 defaults to radio; ISS to visual', () => {
  assert.equal(resolveSatellite(33591).defaultMode, 'radio');
  assert.equal(resolveSatellite('iss').defaultMode, 'visual');
});

test('resolveSatellite handles new aliases and ids', () => {
  assert.equal(resolveSatellite('bluewalker').noradId, 53807);
  assert.equal(resolveSatellite('noaa-19').noradId, 33591);
  assert.equal(resolveSatellite(20580).name, 'Hubble Space Telescope');
  assert.equal(resolveSatellite('nope'), null);
});
