// lib/map/grid.mjs - the lat/lon lines past globe level, built for the area in
// view with 2 to 3 lines each way (never more than 4), and their value labels
// on the view's edges. At globe level the static 30 degree grid shows instead.

/** Below this zoom the static grid (overlays.mjs) draws the lines. */
export const GRID_VIEW_ZOOM = 3;
/** Nice steps, coarse to fine; neighbours differ by at most 2x, so a view gets 2 to 4 lines. */
export const STEPS = [90, 60, 45, 30, 20, 10, 5, 2.5, 2, 1, 0.5, 0.25, 0.2, 0.1, 0.05, 0.025, 0.02, 0.01, 0.005, 0.0025, 0.002, 0.001];
/** The fewest lines each way. */
const MIN_LINES = 2;
/** MapLibre's tiles stop here. */
const TILE_LAT = 85;
/** Points per line across the built area, so lines curve on the globe. */
const SEGMENTS = 32;

const wrapLon = (d) => d - 360 * Math.round(d / 360);
const round = (x) => Math.round(x * 1e7) / 1e7;

/** The coarsest step giving MIN_LINES over spanDeg. */
export function stepFor(spanDeg) {
  if (!(spanDeg > 0)) return STEPS[0];
  return STEPS.find((s) => spanDeg / s >= MIN_LINES) ?? STEPS.at(-1);
}

/** "40°N", "75.25°W", "0°", "180°": as many decimals as the step has. */
export function gridLabel(deg, kind, step) {
  const v = kind === 'meridian' ? wrapLon(deg) : deg;
  const a = Math.abs(v);
  if (a < 1e-9) return '0°';
  if (kind === 'meridian' && Math.abs(a - 180) < 1e-9) return '180°';
  const decimals = String(step).split('.')[1]?.length ?? 0;
  const hemi = kind === 'meridian' ? (v > 0 ? 'E' : 'W') : (v > 0 ? 'N' : 'S');
  return `${Number(a.toFixed(decimals))}°${hemi}`;
}

/** The view's latitudes inside the tiles and its spans each way. */
function extentOf({ west, east, south, north }) {
  const lat0 = Math.max(-TILE_LAT, south);
  const lat1 = Math.min(TILE_LAT, north);
  return { lat0, lat1, latSpan: lat1 - lat0, lonSpan: Math.min(360, east - west) };
}

/** The view's steps: { lat, lon } for parallels and meridians, or null at globe level. */
export function gridSteps(view) {
  if (view.zoom < GRID_VIEW_ZOOM) return null;
  const { latSpan, lonSpan } = extentOf(view);
  return { lat: stepFor(latSpan), lon: stepFor(lonSpan) };
}

/** The steps a view wants: a change means rebuilding. */
export function gridKey(view) {
  const s = gridSteps(view);
  return s ? `${s.lat}:${s.lon}` : 'static';
}

/**
 * The lines for a view's bounds (none at globe level). Built over the view
 * grown by one view each way, so small moves reuse it: `covers` is that area
 * and `key` the steps, for the caller to tell when to rebuild.
 */
export function viewGrid(view) {
  const { west, east } = view;
  const { lat0, lat1, latSpan, lonSpan } = extentOf(view);
  const covers = {
    west: west - lonSpan,
    east: east + lonSpan,
    south: Math.max(-TILE_LAT, lat0 - latSpan),
    north: Math.min(TILE_LAT, lat1 + latSpan),
  };
  // A whole-world area: no wider than the world.
  if (covers.east - covers.west > 360) {
    covers.west = -180;
    covers.east = 180;
  }
  const features = [];
  const key = gridKey(view);
  const steps = gridSteps(view);
  if (!steps) return { data: { type: 'FeatureCollection', features }, covers, key };
  const line = (kind, deg, coordinates) => features.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: { kind, deg: round(kind === 'meridian' ? wrapLon(deg) : deg) },
  });
  const along = (from, to) => Array.from({ length: SEGMENTS + 1 }, (_, i) => round(from + ((to - from) * i) / SEGMENTS));
  // A whole-world area would draw 180 twice (as -180 and 180).
  const lastLon = covers.east - covers.west >= 360 ? covers.east - steps.lon / 2 : covers.east;
  for (let i = Math.ceil(covers.west / steps.lon); i * steps.lon <= lastLon; i++) {
    const lon = round(i * steps.lon);
    line('meridian', lon, along(covers.south, covers.north).map((lat) => [lon, lat]));
  }
  for (let i = Math.ceil(covers.south / steps.lat); i * steps.lat <= covers.north; i++) {
    const lat = round(i * steps.lat);
    line('parallel', lat, along(covers.west, covers.east).map((lon) => [lon, lat]));
  }
  return { data: { type: 'FeatureCollection', features }, covers, key };
}

/** True when a view still lies inside a built grid and wants the same steps. */
export function gridCovers(built, view) {
  if (!built || built.key !== gridKey(view)) return false;
  const { covers } = built;
  const { lat0, lat1 } = extentOf(view);
  return view.west >= covers.west && view.east <= covers.east && lat0 >= covers.south && lat1 <= covers.north;
}

/** The label steps: the view's, or the static grid's 30 degrees at globe level. */
export function labelSteps(view) {
  return gridSteps(view) ?? { lat: 30, lon: 30 };
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
