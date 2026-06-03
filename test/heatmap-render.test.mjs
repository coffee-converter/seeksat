import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCount, cellColor, renderHeatmapImageData,
} from '../lib/pass-finder/heatmap-render.js';

test('normalizeCount: clamps to [0,1] against max', () => {
  assert.equal(normalizeCount(0, 5), 0);
  assert.equal(normalizeCount(5, 5), 1);
  assert.equal(normalizeCount(2, 4), 0.5);
  assert.equal(normalizeCount(3, 0), 0); // guard against /0
});

test('cellColor: 0 → red-ish, 1 → green-ish, alpha set', () => {
  const lo = cellColor(0);
  const hi = cellColor(1);
  assert.ok(lo.r > lo.g);       // red dominant at low score
  assert.ok(hi.g > hi.r);       // green dominant at high score
  assert.ok(hi.a > 0 && hi.a <= 255);
});

test('renderHeatmapImageData: count metric, north-up flip, empty=transparent', () => {
  // 2×2 grid: row 0 = south. metrics row-major.
  const grid = { n: 2 };
  const metrics = [
    { row: 0, col: 0, passes: 0, count: 0, bestP: 0 },   // SW: empty → transparent
    { row: 0, col: 1, passes: 2, count: 2, bestP: 0.9 }, // SE
    { row: 1, col: 0, passes: 1, count: 1, bestP: 0.4 }, // NW
    { row: 1, col: 1, passes: 1, count: 1, bestP: 0.5 }, // NE
  ];
  const img = renderHeatmapImageData(grid, metrics, { metric: 'count', maxCount: 2 });
  assert.equal(img.width, 2);
  assert.equal(img.height, 2);
  assert.equal(img.data.length, 16);
  // image row 0 = NORTH = grid row 1. SW empty cell is grid row0/col0 →
  // image row 1, col 0 → pixel index (1*2 + 0)*4 = 8 → alpha at 11 = 0.
  assert.equal(img.data[11], 0);
});
