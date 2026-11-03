// lib/map/grid.mjs - the lat/lon lines finer than the static 5 degree grid,
// built for the area in view, and the value labels on the view's edges.

/** Steps finer than 5 degrees, coarse to fine. */
export const FINE_STEPS = [2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
/** The fewest lines a view should show across its shorter side. */
const MIN_LINES = 2;
/** MapLibre's tiles stop here. */
const TILE_LAT = 85;
/** Points per line across the built area, so parallels curve on the globe. */
const SEGMENTS = 32;

const RAD = Math.PI / 180;
const wrapLon = (d) => d - 360 * Math.round(d / 360);
const round = (x) => Math.round(x * 1e6) / 1e6;

/** The static grid's finest visible step at a zoom, as overlayLayers fades it in. */
export function coarseStep(zoom) {
  return zoom < 3.5 ? 30 : zoom < 5.5 ? 10 : 5;
}

/** The fine step for a view spanning spanDeg, or null while 5 degree lines already give MIN_LINES. */
export function fineStep(spanDeg) {
  if (!(spanDeg > 0) || spanDeg / 5 >= MIN_LINES) return null;
  return FINE_STEPS.find((s) => spanDeg / s >= MIN_LINES) ?? FINE_STEPS.at(-1);
}

/** "40°N", "75.5°W", "0°", "180°": as few decimals as the step needs. */
export function gridLabel(deg, kind, step) {
  const v = kind === 'meridian' ? wrapLon(deg) : deg;
  const a = Math.abs(v);
  if (a < 1e-9) return '0°';
  if (kind === 'meridian' && Math.abs(a - 180) < 1e-9) return '180°';
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const hemi = kind === 'meridian' ? (v > 0 ? 'E' : 'W') : (v > 0 ? 'N' : 'S');
  return `${Number(a.toFixed(decimals))}°${hemi}`;
}

/**
 * The lines finer than the static grid for a view's bounds (none while the
 * static grid gives enough), less those the static grid draws. Built over the
 * view grown by one view each way, so small moves reuse it: `covers` is that
 * area and `key` the steps, for the caller to tell when to rebuild.
 */
export function viewGrid(view) {
  const { west, east, zoom } = view;
  const { lat0, lat1, span } = extentOf(view);
  const fine = fineStep(span);
  const coarse = coarseStep(zoom);
  const step = fine;
  const dLon = east - west;
  const dLat = lat1 - lat0;
  const covers = {
    west: west - dLon,
    east: east + dLon,
    south: Math.max(-TILE_LAT, lat0 - dLat),
    north: Math.min(TILE_LAT, lat1 + dLat),
  };
  // A whole-world view: no wider than the world.
  if (covers.east - covers.west > 360) {
    covers.west = -180;
    covers.east = 180;
  }
  const features = [];
  const line = (kind, deg, coordinates) => {
    if (Math.abs(deg / coarse - Math.round(deg / coarse)) < 1e-6) return;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: { kind, deg: round(kind === 'meridian' ? wrapLon(deg) : deg) },
    });
  };
  if (fine == null) return { data: { type: 'FeatureCollection', features }, covers, key: gridKey(view) };
  const along = (from, to) => Array.from({ length: SEGMENTS + 1 }, (_, i) => round(from + ((to - from) * i) / SEGMENTS));
  // A whole-world area would draw 180 twice (as -180 and 180).
  const lastLon = covers.east - covers.west >= 360 ? covers.east - step / 2 : covers.east;
  for (let i = Math.ceil(covers.west / step); i * step <= lastLon; i++) {
    const lon = round(i * step);
    line('meridian', lon, along(covers.south, covers.north).map((lat) => [lon, lat]));
  }
  for (let i = Math.ceil(covers.south / step); i * step <= covers.north; i++) {
    const lat = round(i * step);
    line('parallel', lat, along(covers.west, covers.east).map((lon) => [lon, lat]));
  }
  return { data: { type: 'FeatureCollection', features }, covers, key: gridKey(view) };
}

/** The view's latitudes inside the tiles, and its shorter side in degrees of arc. */
function extentOf({ west, east, south, north }) {
  const lat0 = Math.max(-TILE_LAT, south);
  const lat1 = Math.min(TILE_LAT, north);
  return { lat0, lat1, span: Math.min(lat1 - lat0, (east - west) * Math.cos(((lat0 + lat1) / 2) * RAD)) };
}

/** The steps a view wants: a change means rebuilding. */
export function gridKey(view) {
  return `${fineStep(extentOf(view).span)}:${coarseStep(view.zoom)}`;
}

/** True when a view still lies inside a built grid and wants the same steps. */
export function gridCovers(built, view) {
  if (!built || built.key !== gridKey(view)) return false;
  const { covers } = built;
  const { lat0, lat1 } = extentOf(view);
  return view.west >= covers.west && view.east <= covers.east && lat0 >= covers.south && lat1 <= covers.north;
}

/** The step the edge labels use: the finest lines showing. */
export function labelStep(view) {
  return fineStep(extentOf(view).span) ?? coarseStep(view.zoom);
}

/**
 * Where lines cross one edge of the view, for its labels. samples run along
 * the edge: { px, deg } (deg the longitude or latitude there) or null where
 * the edge misses the Earth. Returns { px, deg, label } per crossing.
 */
export function edgeCrossings(samples, kind, step) {
  const out = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a || !b) continue;
    // Longitudes unwrapped across the date line.
    const bd = kind === 'meridian' ? a.deg + wrapLon(b.deg - a.deg) : b.deg;
    if (bd === a.deg) continue;
    const lo = Math.min(a.deg, bd);
    const hi = Math.max(a.deg, bd);
    for (let k = Math.ceil(lo / step); k * step <= hi; k++) {
      const deg = round(k * step);
      // A crossing on a sample counts once, for the segment it ends.
      if (deg === round(a.deg) && i > 1) continue;
      const t = (deg - a.deg) / (bd - a.deg);
      out.push({ px: a.px + (b.px - a.px) * t, deg, label: gridLabel(deg, kind, step) });
    }
  }
  return out;
}
