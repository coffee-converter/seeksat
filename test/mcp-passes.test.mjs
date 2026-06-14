// test/mcp-passes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPasses, getPosition } from '../lib/mcp/passes.mjs';

const LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const LINE2 = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';
const START = Date.parse('2024-01-01T12:00:00Z');

test('getPosition returns a geodetic sub-point and sunlit flag', () => {
  const p = getPosition(LINE1, LINE2, new Date(START));
  assert.ok(p.latDeg >= -90 && p.latDeg <= 90);
  assert.ok(p.lonDeg >= -180 && p.lonDeg <= 180);
  assert.ok(p.altitudeKm > 300 && p.altitudeKm < 500, `alt ${p.altitudeKm}`);
  assert.equal(typeof p.sunlit, 'boolean');
});

test('findPasses (radio mode) returns ordered windows with the expected shape', () => {
  // Radio mode is deterministic and not gated on twilight/illumination,
  // so an observer under the ground track will always see passes — a
  // robust shape/ordering check independent of sun geometry.
  const passes = findPasses({
    line1: LINE1, line2: LINE2,
    observer: { latDeg: 0, lonDeg: 100 },
    startMs: START, windowHours: 48,
    minElevationDeg: 10, mode: 'radio',
  });
  assert.ok(passes.length > 0, 'finds at least one pass');
  for (const p of passes) {
    assert.ok(Date.parse(p.rise) <= Date.parse(p.peak));
    assert.ok(Date.parse(p.peak) <= Date.parse(p.set));
    assert.ok(p.peakElevationDeg >= 10);
    assert.ok(p.durationSec > 0);
    assert.equal(typeof p.sunlit, 'boolean');
    assert.ok('peakMagnitude' in p);
    assert.ok(p.quality >= 0 && p.quality <= 1);
    assert.ok(p.azimuthDeg.rise >= 0 && p.azimuthDeg.rise < 360);
  }
  const rises = passes.map(p => Date.parse(p.rise));
  assert.deepEqual(rises, [...rises].sort((a, b) => a - b), 'chronological');
});
