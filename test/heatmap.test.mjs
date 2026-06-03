import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionForObservers, buildGrid } from '../lib/pass-finder/heatmap.js';
import { computeCellMetrics, computeHeatmap } from '../lib/pass-finder/heatmap.js';

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

const EARTH_R = 6378137;
const ISS_ALT_M = 420_000;

// A fake ISS sampler: the ISS sits straight above lon=0 / lat=0 for a
// 4-minute window each "day", and is unreachable (null) otherwise. This
// lets us assert pass COUNTS deterministically without SGP4.
function fakeSamplerOverheadEquator(nowMs) {
  return (jsDate) => {
    const since = jsDate.getTime() - nowMs;
    const dayMs = 86_400_000;
    const intoDay = ((since % dayMs) + dayMs) % dayMs;
    // overhead for the first 4 minutes of each day-window
    if (intoDay <= 4 * 60_000) return [EARTH_R + ISS_ALT_M, 0, 0];
    return null;
  };
}

test('computeCellMetrics: radio mode counts one pass per day window', () => {
  const nowMs = Date.UTC(2025, 5, 1, 0, 0, 0);
  const cell = { id: 'c', latDeg: 0, lonDeg: 0 };
  const m = computeCellMetrics(cell, {
    nowMs,
    windowMs: 2 * 86_400_000 - 1, // 2 days → 2 day-windows (−1ms avoids day-boundary bleed)
    stepMs: 60_000,
    issEcefAtFn: fakeSamplerOverheadEquator(nowMs),
    mode: 'radio',
    minElevDeg: 10,
    goodThreshold: 0,           // count every pass
    cloudForecastForCell: () => null,
  });
  assert.equal(m.passes, 2);
  assert.equal(m.count, 2);
  assert.ok(m.bestP > 0);
});

test('computeCellMetrics: a far-away cell sees nothing', () => {
  const nowMs = Date.UTC(2025, 5, 1, 0, 0, 0);
  const cell = { id: 'c', latDeg: 80, lonDeg: 170 };
  const m = computeCellMetrics(cell, {
    nowMs,
    windowMs: 2 * 86_400_000,
    stepMs: 60_000,
    issEcefAtFn: fakeSamplerOverheadEquator(nowMs),
    mode: 'radio',
    minElevDeg: 10,
    goodThreshold: 0,
    cloudForecastForCell: () => null,
  });
  assert.equal(m.passes, 0);
  assert.equal(m.count, 0);
  assert.equal(m.bestP, 0);
});

test('computeHeatmap: returns aligned metrics + maxCount', () => {
  const nowMs = Date.UTC(2025, 5, 1, 0, 0, 0);
  const region = { centerLat: 0, centerLon: 0, halfLatDeg: 1, halfLonDeg: 1 };
  const grid = buildGrid(region, 3);
  const out = computeHeatmap(grid, {
    nowMs,
    windowMs: 86_400_000,
    stepMs: 60_000,
    issEcefAtFn: fakeSamplerOverheadEquator(nowMs),
    mode: 'radio',
    minElevDeg: 10,
    goodThreshold: 0,
    cloudForecastForCell: () => null,
  });
  assert.equal(out.metrics.length, 9);
  assert.ok(out.maxCount >= 1);
  assert.ok(out.metrics.every((m) => typeof m.row === 'number' && typeof m.col === 'number'));
});
