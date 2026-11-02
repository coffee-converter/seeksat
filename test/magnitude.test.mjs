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

test('every catalog satellite has a numeric standardMag, or null when unknown', () => {
  for (const s of CATALOG) {
    assert.ok(s.standardMag === null || typeof s.standardMag === 'number', `${s.name} standardMag`);
  }
});

test('relative brightness is sane: ISS brighter than Hubble/NOAA; NOAA dimmest', () => {
  const byId = Object.fromEntries(CATALOG.map((s) => [s.noradId, s.standardMag]));
  assert.ok(byId[25544] < byId[20580], 'ISS brighter than Hubble');
  assert.ok(byId[25544] < byId[33591], 'ISS brighter than NOAA-19');
  assert.equal(byId[33591], Math.max(...CATALOG.map((s) => s.standardMag).filter((m) => m != null)), 'NOAA-19 dimmest');
});

// Standard magnitude is defined at 1000 km range and 90 degrees phase angle
// (half lit), so that geometry must give stdMag back exactly.
test('at 1000 km and 90 degrees phase, magnitudeAt returns the standard magnitude', () => {
  const obs0 = { latDeg: 0, lonDeg: 0 };
  const sat = [6_378_137 + 1_000_000, 0, 0];
  // Satellite to observer is -x; a Sun direction along +y is 90 degrees off it.
  const m = magnitudeAt(obs0, sat, [0, 1, 0], 2.0);
  assert.ok(Math.abs(m - 2.0) < 1e-9, `m ${m}`);
});

test('at 1000 km fully lit (phase 0), magnitudeAt is 0.75 brighter than standard', () => {
  const obs0 = { latDeg: 0, lonDeg: 0 };
  const sat = [6_378_137 + 1_000_000, 0, 0];
  const m = magnitudeAt(obs0, sat, [-1, 0, 0], 2.0);
  assert.ok(Math.abs(m - (2.0 - 0.75)) < 0.01, `m ${m}`);
});
