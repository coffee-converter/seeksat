// lib/map/view.mjs - the map's two views and where their cameras start. Pure.

export const PROJECTIONS = [
  { id: 'flat', label: 'Flat' },
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
    const cosLat = Math.max(Math.cos((center[1] * Math.PI) / 180), 0.01);
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

/** A globe preset's camera, or null when it has nothing to centre on. A null zoom keeps the current zoom. */
export function presetCamera(preset, { observer = null, focus = null } = {}) {
  switch (preset) {
    case 'you': return observer ? { center: lonLat(observer), zoom: null } : null;
    case 'sat': return focus ? { center: lonLat(focus), zoom: null } : null;
    case 'north': return { center: [0, 90], zoom: null };
    case 'south': return { center: [0, -90], zoom: null };
    default: return null;
  }
}
