import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionForObservers, buildGrid } from '../lib/pass-finder/heatmap.js';

test('regionForObservers: no observers → default radius around 0,0', () => {
  const r = regionForObservers([], { defaultRadiusDeg: 2.5 });
  assert.equal(r.centerLat, 0);
  assert.equal(r.centerLon, 0);
  assert.equal(r.halfLatDeg, 2.5);
  assert.equal(r.halfLonDeg, 2.5);
});

test('regionForObservers: single observer → centered, default radius', () => {
  const r = regionForObservers([{ latDeg: 40, lonDeg: -74 }], { defaultRadiusDeg: 2.5 });
  assert.equal(r.centerLat, 40);
  assert.equal(r.centerLon, -74);
  assert.equal(r.halfLatDeg, 2.5);
  assert.equal(r.halfLonDeg, 2.5);
});

test('regionForObservers: spread observers → bounding box + padding, centered', () => {
  const r = regionForObservers(
    [{ latDeg: 30, lonDeg: -80 }, { latDeg: 40, lonDeg: -60 }],
    { defaultRadiusDeg: 2.5, padDeg: 1 },
  );
  assert.equal(r.centerLat, 35);
  assert.equal(r.centerLon, -70);
  assert.equal(r.halfLatDeg, 6);   // (40-30)/2 + 1
  assert.equal(r.halfLonDeg, 11);  // (-60 - -80)/2 + 1
});

test('buildGrid: n×n cell centers inside the region, ids unique', () => {
  const region = { centerLat: 0, centerLon: 0, halfLatDeg: 2, halfLonDeg: 2 };
  const grid = buildGrid(region, 4);
  assert.equal(grid.n, 4);
  assert.equal(grid.cells.length, 16);
  assert.equal(grid.south, -2);
  assert.equal(grid.north, 2);
  assert.equal(grid.west, -2);
  assert.equal(grid.east, 2);
  assert.ok(Math.abs(grid.cells[0].latDeg - (-2 + 0.5)) < 1e-9);
  assert.ok(Math.abs(grid.cells[0].lonDeg - (-2 + 0.5)) < 1e-9);
  const ids = new Set(grid.cells.map((c) => c.id));
  assert.equal(ids.size, 16);
});
