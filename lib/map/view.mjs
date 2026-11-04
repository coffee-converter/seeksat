// lib/map/view.mjs - the map's two views and where their cameras start. Pure.

import { subsolarPoint } from './geometry.mjs';

// Globe first in the view toggle.
export const PROJECTIONS = [
  { id: 'globe', label: 'Globe' },
  { id: 'flat', label: 'Mercator' },
];
export const DEFAULT_PROJECTION = 'flat';
// A portrait screen at most this wide (CSS px) starts on the globe.
export const PHONE_MAX_WIDTH = 600;

/** The view a visitor with no saved choice starts on: the globe on a narrow
 *  portrait screen, where a flat world is a thin strip; Mercator elsewhere. */
export function defaultProjectionFor({ width, height }) {
  return width > 0 && width <= PHONE_MAX_WIDTH && height > width ? 'globe' : DEFAULT_PROJECTION;
}

// Saved values from the old canvas map's projection menu.
const OLD_VIEWS = {
  equirectangular: 'flat',
  winkel3: 'flat',
  azimuthal: 'globe',
  'polar-north': 'globe',
  'polar-south': 'globe',
  satellite: 'globe',
};

/** A saved projection pref as 'flat' or 'globe', or null when there is no
 *  usable choice (the device default then applies). */
export function migrateProjection(v) {
  if (v === 'flat' || v === 'globe') return v;
  // Satellite's view was cut; a saved one loads as the globe.
  if (v === 'satview') return 'globe';
  return typeof v === 'string' && Object.hasOwn(OLD_VIEWS, v) ? OLD_VIEWS[v] : null;
}

// MapLibre's world is 512 px across at zoom 0.
const TILE_PX = 512;
// The band of latitude a flat home view fills when the frame is tall.
const HOME_SOUTH = -60;
const HOME_NORTH = 75;
const HOME_LAT = 20;
// The globe's disc fits its frame with a margin at this zoom above
// log2(min side / 512), tuned by eye at 1440x1000 and on a phone.
const GLOBE_ZOOM_OFFSET = 1.7;
// The latitude past which the globe's size correction stops growing.
const SIZE_FIX_MAX_LAT = 85.05;

/** Web Mercator y in world units (0 at the top, 1 at the bottom). */
function mercY(latDeg) {
  const phi = (latDeg * Math.PI) / 180;
  return (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2;
}

const lonLat = (p) => [p.lonDeg, p.latDeg];

// Points the flat home view fits sit at least this share of the width inside its edges.
const FIT_MARGIN = 0.05;
const DEG = Math.PI / 180;

/** How far a longitude sits east of a centre, -180 to 180. */
const lonOffset = (lon, centre) => ((((lon - centre) % 360) + 540) % 360) - 180;

/** The circular mean longitude of some points, or null when they cancel out. */
function meanLon(points) {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += Math.cos(p.lonDeg * DEG);
    y += Math.sin(p.lonDeg * DEG);
  }
  if (Math.hypot(x, y) < 1e-9 * Math.max(points.length, 1)) return null;
  return Math.atan2(y, x) / DEG;
}

/**
 * The home camera. observer and focus are { latDeg, lonDeg } or null; width
 * and height are the map's size in CSS px. points are the satellites' current
 * { lonDeg, latDeg }: with no focus the flat view centres on the circular mean
 * of the observer and the points, and zooms out until they all fit across
 * (never past the whole world across). The globe ignores them.
 */
export function homeCamera(view, { observer = null, focus = null, width, height, points = [] }) {
  if (view === 'globe') {
    const center = observer ? lonLat(observer) : focus ? lonLat(focus) : [0, HOME_LAT];
    // MapLibre scales the globe by 1 / cos(centre latitude) to match Mercator
    // there; the cos term undoes that so the disc is the same size anywhere.
    // Clamped where MapLibre clamps its own globe scaling (85.05 degrees).
    const lat = Math.min(Math.abs(center[1]), SIZE_FIX_MAX_LAT);
    const cosLat = Math.cos((lat * Math.PI) / 180);
    return {
      center,
      zoom: Math.log2(Math.min(width, height) / TILE_PX) + GLOBE_ZOOM_OFFSET + Math.log2(cosLat),
    };
  }
  const across = Math.log2(width / TILE_PX);
  const tall = Math.log2(height / (TILE_PX * (mercY(HOME_SOUTH) - mercY(HOME_NORTH))));
  const zoom = Math.max(across, tall);
  if (focus || points.length === 0) {
    return { center: [focus?.lonDeg ?? observer?.lonDeg ?? 0, HOME_LAT], zoom };
  }
  const shown = observer ? [observer, ...points] : points;
  const lon = meanLon(shown) ?? observer?.lonDeg ?? 0;
  const far = Math.max(...shown.map((p) => Math.abs(lonOffset(p.lonDeg, lon))));
  // At zoom z the view spans 360 * width / (512 * 2^z) degrees; the furthest
  // point must sit inside it with the margin on each side.
  const fit = far > 0 ? Math.log2(((1 - 2 * FIT_MARGIN) * 180 * width) / (TILE_PX * far)) : zoom;
  return { center: [lon, HOME_LAT], zoom: Math.max(across, Math.min(zoom, fit)) };
}

/** Street level; OpenFreeMap's vector tiles carry detail to about zoom 14. */
export const MAX_ZOOM = 15;
// MapLibre's own lowest zoom: its setMinZoom throws below this.
const MAPLIBRE_MIN_ZOOM = -2;

/**
 * The furthest the map may zoom out: no further than shows the whole Earth,
 * and never below MapLibre's -2. Flat: the whole world across the width
 * (MapLibre already keeps the world filling the height). Globe: the home
 * view's zoom at the equator. MapLibre lowers a globe's floor by
 * log2(cos latitude) itself, which keeps that disc size at any centre.
 */
export function minZoomFor(view, { width, height }) {
  const floor = view === 'globe'
    ? homeCamera('globe', { observer: { latDeg: 0, lonDeg: 0 }, width, height }).zoom
    : Math.log2(width / TILE_PX);
  return Math.max(floor, MAPLIBRE_MIN_ZOOM);
}

/**
 * True when the home camera already centres on the focus, so entering it needs
 * no move: the flat home centres on a focus, the globe home on the observer first.
 */
export function homeCentresFocus(view, { observer = null, focus = null } = {}) {
  if (!focus) return false;
  return view === 'globe' ? !observer : true;
}

/** The antisolar point (the side of the Earth in shadow) as [lon, lat]. */
function antisolar(date) {
  const sun = subsolarPoint(date);
  return [((((sun.lonDeg + 180) + 540) % 360) - 180), -sun.latDeg];
}

/**
 * A globe preset's camera, or null when it has nothing to centre on. A null zoom keeps the current zoom.
 * Night centres on the antisolar point (the side of the Earth in shadow).
 */
export function presetCamera(preset, { observer = null, focus = null, width = 1, height = 1, date = new Date() } = {}) {
  const centre = preset === 'you' ? (observer && lonLat(observer))
    : preset === 'sat' ? (focus && lonLat(focus))
      : preset === 'north' ? [0, 90]
        : preset === 'south' ? [0, -90]
          : preset === 'night' ? antisolar(date)
            : null;
  if (!centre) return null;
  // The whole Earth in frame, as on the globe's home view, so a preset never
  // keeps a street-level zoom from before.
  const zoom = homeCamera('globe', { observer: { lonDeg: centre[0], latDeg: centre[1] }, width, height }).zoom;
  return { center: centre, zoom };
}

// A zoom change too small to see.
const ZOOM_NUDGE = 1e-6;

/**
 * The zoom to ease a preset to from the current zoom. MapLibre's globe ease
 * scales the Earth smoothly between latitudes only when the zoom number
 * changes. Pole to pole keeps the same number, so the Earth would shrink
 * toward the equator, meet the zoom floor there and land far zoomed in; a
 * hair of zoom keeps it the same size the whole way.
 */
export function easeZoom(current, target) {
  return Math.abs(target - current) < ZOOM_NUDGE ? current + ZOOM_NUDGE : target;
}
