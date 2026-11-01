import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOrbit, makeTrack, orbitTrackEcef } from '../lib/sat/track.mjs';
import { CATALOG } from '../lib/catalog.mjs';
import { ISS_OMM } from './fixtures/omm-iss.mjs';
import { MOLNIYA_LINE1, MOLNIYA_LINE2, GOES16_LINE1, GOES16_LINE2, recordFrom } from './fixtures/orbits.mjs';

test('classifyOrbit', () => {
  assert.equal(classifyOrbit({ meanMotionRevPerDay: 15.5, eccentricity: 0.0005 }), 'leo');
  assert.equal(classifyOrbit({ meanMotionRevPerDay: 2.3644, eccentricity: 0.679 }), 'heo');
  assert.equal(classifyOrbit({ meanMotionRevPerDay: 1.0027, eccentricity: 0.0003 }), 'geo');
  assert.equal(classifyOrbit({ meanMotionRevPerDay: 2.0056, eccentricity: 0.01 }), 'meo');
});
test('makeTrack from TLE lines, OMM and a catalog entry', () => {
  const m = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'MOLNIYA 1-91'));
  assert.equal(m.orbitClass, 'heo');
  assert.ok(Math.abs(m.periodMs - 86_400_000 / 2.3644441) < 5000);
  assert.equal(m.standardMag, null);
  assert.deepEqual(m.downlinks, []);
  const iss = makeTrack({ noradId: 25544, name: 'ISS (ZARYA)', omm: ISS_OMM }, CATALOG.find((c) => c.noradId === 25544));
  assert.equal(iss.shortName, 'ISS');
  assert.equal(iss.standardMag, -1.8);
  assert.equal(iss.orbitClass, 'leo');
  assert.equal(iss.epochMs, Date.parse('2026-03-01T12:00:00Z'));
  const e = iss.ecefAt(new Date('2026-03-01T12:00:00Z'));
  assert.equal(e.length, 3);
  assert.ok(Math.hypot(...e) > 6.6e6 && Math.hypot(...e) < 6.9e6);
  assert.equal(makeTrack(recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16')).orbitClass, 'geo');
});
test('orbitTrackEcef spans one period of the track', () => {
  const m = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M'));
  const pts = orbitTrackEcef(m, new Date('2023-06-27T06:00:00Z'));
  assert.equal(pts.length, 360);
  const radii = pts.map((p) => Math.hypot(...p));
  assert.ok(Math.max(...radii) > 3.9e7, 'reaches Molniya apogee (~40,000 km for this 2.36 rev/day fixture)');
});
