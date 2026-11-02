// lib/map/view.mjs - the map's two views and where their cameras start. Pure.

export const PROJECTIONS = [
  { id: 'flat', label: 'Mercator' },
  { id: 'globe', label: 'Globe' },
];
export const DEFAULT_PROJECTION = 'flat';

// Saved values from the old canvas map's projection menu.
const OLD_VIEWS = {
  equirectangular: 'flat',
  winkel3: 'flat',
  azimuthal: 'globe',
  'polar-north': 'globe',
  'polar-south': 'globe',
  satellite: 'globe',
};

/** A saved projection pref as 'flat' or 'globe'. */
export function migrateProjection(v) {
  if (v === 'flat' || v === 'globe') return v;
  return Object.hasOwn(OLD_VIEWS, v) ? OLD_VIEWS[v] : DEFAULT_PROJECTION;
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

/**
 * The home camera. observer and focus are { latDeg, lonDeg } or null; width
 * and height are the map's size in CSS px.
 */
export function homeCamera(view, { observer = null, focus = null, width, height }) {
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
  const lon = focus?.lonDeg ?? observer?.lonDeg ?? 0;
  const across = Math.log2(width / TILE_PX);
  const tall = Math.log2(height / (TILE_PX * (mercY(HOME_SOUTH) - mercY(HOME_NORTH))));
  return { center: [lon, HOME_LAT], zoom: Math.max(across, tall) };
}

/** Street level; OpenFreeMap's vector tiles carry detail to about zoom 14. */
export const MAX_ZOOM = 15;

/**
 * The furthest the map may zoom out: no further than shows the whole Earth.
 * Flat: the whole world across the width (MapLibre already keeps the world
 * filling the height). Globe: the home view's disc, at the given centre
 * latitude, since MapLibre's globe zoom shifts with latitude.
 */
export function minZoomFor(view, { width, height, latDeg = 0 }) {
  if (view === 'globe') {
    return homeCamera('globe', { observer: { latDeg, lonDeg: 0 }, width, height }).zoom;
  }
  return Math.log2(width / TILE_PX);
}

/**
 * True when the home camera already centres on the focus, so entering it needs
 * no move: the flat home centres on a focus, the globe home on the observer first.
 */
export function homeCentresFocus(view, { observer = null, focus = null } = {}) {
  if (!focus) return false;
  return view === 'globe' ? !observer : true;
}

/** A globe preset's camera, or null when it has nothing to centre on. A null zoom keeps the current zoom. */
export function presetCamera(preset, { observer = null, focus = null, width = 1, height = 1 } = {}) {
  const centre = preset === 'you' ? (observer && lonLat(observer))
    : preset === 'sat' ? (focus && lonLat(focus))
      : preset === 'north' ? [0, 90]
        : preset === 'south' ? [0, -90]
          : null;
  if (!centre) return null;
  // The whole Earth in frame, as on the globe's home view, so a preset never
  // keeps a street-level zoom from before.
  const zoom = homeCamera('globe', { observer: { lonDeg: centre[0], latDeg: centre[1] }, width, height }).zoom;
  return { center: centre, zoom };
}

/**
 * The zoom floor to apply now. While the camera moves the floor may only fall:
 * a flight between the poles crosses the equator, where the globe's floor is
 * about 3.5 higher, and raising it there would drag the zoom in. The exact
 * floor is applied once the move ends.
 */
export function nextMinZoom({ current, floor, moving }) {
  return moving ? Math.min(current, floor) : floor;
}
