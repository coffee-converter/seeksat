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

// ---- Browser-only Cesium glue --------------------------------------------

const DARK_BASEMAP_URL =
  "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png";

// Build an imagery layer from a metrics buffer, draped over the grid's
// lat/lon rectangle. Returns the Cesium ImageryLayer (caller removes it
// on teardown / before repaint).
export function createHeatmapLayer(viewer, grid, imageData) {
  const Cesium = window.Cesium;
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(imageData.width, imageData.height);
  img.data.set(imageData.data);
  ctx.putImageData(img, 0, 0);

  const layer = viewer.imageryLayers.addImageryProvider(
    new Cesium.SingleTileImageryProvider({
      url: canvas.toDataURL("image/png"),
      rectangle: Cesium.Rectangle.fromDegrees(
        grid.west, grid.south, grid.east, grid.north,
      ),
      tileWidth: imageData.width,
      tileHeight: imageData.height,
    }),
  );
  layer.alpha = 1.0; // alpha already baked into the pixels
  return layer;
}

// Enter the flat dark map: morph to 2D, hide the existing imagery
// layers, add a dark basemap UNDER where the heatmap will go, and fly
// the camera to the region. Returns a restore token for exitHeatmap2D.
export function enterHeatmap2D(viewer, grid) {
  const Cesium = window.Cesium;
  const prevLayers = [];
  for (let i = 0; i < viewer.imageryLayers.length; i++) {
    const l = viewer.imageryLayers.get(i);
    prevLayers.push({ layer: l, show: l.show });
    l.show = false;
  }
  const darkLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: DARK_BASEMAP_URL,
      subdomains: ["a", "b", "c", "d"],
      credit: "© OpenStreetMap, © CARTO",
      maximumLevel: 18,
    }),
  );
  viewer.scene.morphTo2D(0.6);
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(
      grid.west, grid.south, grid.east, grid.north,
    ),
    duration: 0.8,
  });
  return { prevLayers, darkLayer };
}

// Restore the 3D globe + original imagery. Pass the token from
// enterHeatmap2D plus the current heatmap layer (if any) to remove.
export function exitHeatmap2D(viewer, token, heatmapLayer) {
  if (heatmapLayer) viewer.imageryLayers.remove(heatmapLayer, true);
  if (token && token.darkLayer) viewer.imageryLayers.remove(token.darkLayer, true);
  if (token && token.prevLayers) {
    for (const { layer, show } of token.prevLayers) layer.show = show;
  }
  viewer.scene.morphTo3D(0.6);
}
