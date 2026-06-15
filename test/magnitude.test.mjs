import { test } from 'node:test';
import assert from 'node:assert/strict';
import { magnitudeAt } from '../lib/pass-finder/ratings.js';
import { CATALOG } from '../lib/catalog.mjs';

// Fixed full-phase geometry: observer at (0,0), satellite ~500 km straight
// up on the +x axis, sun direction along -x so the satellite→observer
// vector is fully lit (F = 1). Only stdMag varies between calls, so the
// range/phase terms cancel and the result shifts one-for-one with stdMag.
const obs = { latDeg: 0, lonDeg: 0 };
const satEcef = [6_878_137, 0, 0];
const sunDir = [-1, 0, 0];

test('magnitudeAt defaults to the ISS standard magnitude (-1.8)', () => {
  assert.equal(magnitudeAt(obs, satEcef, sunDir), magnitudeAt(obs, satEcef, sunDir, -1.8));
});

test('result shifts one-for-one with the standard magnitude', () => {
  const bright = magnitudeAt(obs, satEcef, sunDir, -1.8);
  const dim = magnitudeAt(obs, satEcef, sunDir, 2.0);
  assert.ok(bright != null && dim != null);
  assert.ok(Math.abs((dim - bright) - 3.8) < 1e-9, `delta ${dim - bright}`);
});

test('every catalog satellite has a numeric standardMag', () => {
  for (const s of CATALOG) {
    assert.equal(typeof s.standardMag, 'number', `${s.name} standardMag`);
  }
});

test('relative brightness is sane: ISS brighter than Hubble/NOAA; NOAA dimmest', () => {
  const byId = Object.fromEntries(CATALOG.map((s) => [s.noradId, s.standardMag]));
  assert.ok(byId[25544] < byId[20580], 'ISS brighter than Hubble');
  assert.ok(byId[25544] < byId[33591], 'ISS brighter than NOAA-19');
  assert.equal(byId[33591], Math.max(...CATALOG.map((s) => s.standardMag)), 'NOAA-19 dimmest');
});
