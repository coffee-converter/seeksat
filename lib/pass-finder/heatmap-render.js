// lib/pass-finder/heatmap-render.js — turns heatmap metrics into pixels
// and (in the browser) drapes them onto the Cesium globe.
//
// The pure half (normalizeCount / cellColor / renderHeatmapImageData)
// has no DOM/Cesium dependency and is unit-tested. The browser half
// (createHeatmapLayer / enterHeatmap2D / exitHeatmap2D) reads
// window.Cesium and touches the viewer.

import { interpRatingStop } from "./ratings.js";

const CELL_ALPHA = 0.78 * 255;

// Normalize a good-pass count to [0,1] against the region's max.
export function normalizeCount(count, maxCount) {
  if (!maxCount || maxCount <= 0) return 0;
  return Math.max(0, Math.min(1, count / maxCount));
}

// Map a [0,1] score to an RGBA cell color using the shared rating
// gradient (red → yellow → green), matching the passes-list coloring.
export function cellColor(value) {
  const c = interpRatingStop(value);
  return { r: c.r, g: c.g, b: c.b, a: Math.round(CELL_ALPHA) };
}

// Render metrics to a tiny n×n RGBA buffer (one pixel per cell). Cesium
// bilinearly samples this when draped, so a 1px-per-cell texture reads
// as a smooth heatmap for free.
//
// Grid row 0 is the SOUTH edge; image row 0 is the NORTH (top) edge, so
// we flip vertically. Cells with zero passes render fully transparent.
export function renderHeatmapImageData(grid, metrics, opts) {
  const { metric, maxCount } = opts;
  const n = grid.n;
  const data = new Uint8ClampedArray(n * n * 4);
  for (const m of metrics) {
    const value = metric === "count"
      ? normalizeCount(m.count, maxCount)
      : m.bestP;
    const imgRow = n - 1 - m.row; // flip south→north
    const idx = (imgRow * n + m.col) * 4;
    if (m.passes === 0) {
      data[idx + 3] = 0; // transparent
      continue;
    }
    const c = cellColor(value);
    data[idx] = c.r;
    data[idx + 1] = c.g;
    data[idx + 2] = c.b;
    data[idx + 3] = c.a;
  }
  return { data, width: n, height: n };
}
