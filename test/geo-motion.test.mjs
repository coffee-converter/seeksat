import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoMotion, azSpanDeg } from '../lib/passes/geo-motion.mjs';

test('geoMotion: station-kept, drifting and inclined geosynchronous satellites', () => {
  assert.equal(geoMotion({ elMinDeg: 38.15, elMaxDeg: 38.25, azMinDeg: 203.05, azMaxDeg: 203.15 }), 'fixed');
  assert.equal(geoMotion({ elMinDeg: 37.8, elMaxDeg: 39.2, azMinDeg: 203.4, azMaxDeg: 204.1 }), 'nearly');
  // SDO from Sarasota.
  assert.equal(geoMotion({ elMinDeg: 16.8, elMaxDeg: 75.9, azMinDeg: 194.2, azMaxDeg: 300.3 }), 'moving');
});

test('azSpanDeg does not wrap a range across north into a near-full circle', () => {
  assert.ok(Math.abs(azSpanDeg({ azMinDeg: 359.9, azMaxDeg: 0.2 }) - 0.3) < 1e-9);
  assert.equal(azSpanDeg({}), 0);
});
