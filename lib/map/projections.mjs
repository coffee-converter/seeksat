// lib/map/projections.mjs - pure d3 projection factory for the flat map.
import { geoEquirectangular, geoAzimuthalEquidistant, geoPath } from 'd3-geo';
import { geoWinkel3, geoSatellite } from 'd3-geo-projection';
import { EARTH_RADIUS_KM } from './geometry.mjs';

export const PROJECTIONS = [
  { id: 'equirectangular', label: 'Lat/lon grid' },
  { id: 'azimuthal', label: 'Centered on you' },
  { id: 'polar-north', label: 'North pole' },
  { id: 'polar-south', label: 'South pole' },
  { id: 'winkel3', label: 'Winkel tripel' },
  { id: 'satellite', label: 'From the satellite' },
];
export const DEFAULT_PROJECTION = 'equirectangular';
/** World maps: they wrap by rotation and fill a frame taller than their aspect. Discs do neither. */
export const FILL_PROJECTIONS = ['equirectangular', 'winkel3'];

export function clampZoom(z) {
  return Math.min(8, Math.max(1, z));
}

export function projectionAvailable(id, { observer = null, sat = null } = {}) {
  if (!PROJECTIONS.some((p) => p.id === id)) return false;
  if (id === 'azimuthal') return !!observer;
  if (id === 'satellite') return !!sat;
  return true;
}

/**
 * A d3 projection fitted to the frame. World maps (FILL_PROJECTIONS) take
 * `rotLon`, the longitude at the centre: they wrap by rotating, not panning.
 */
export function makeProjection(id, { width, height, observer = null, sat = null, zoom = 1, pan = [0, 0], rotLon = 0 }) {
  const use = projectionAvailable(id, { observer, sat }) ? id : DEFAULT_PROJECTION;
  let proj;
  switch (use) {
    case 'winkel3':
      proj = geoWinkel3();
      break;
    case 'azimuthal':
      proj = geoAzimuthalEquidistant().rotate([-observer.lonDeg, -observer.latDeg]);
      break;
    case 'polar-north':
      proj = geoAzimuthalEquidistant().rotate([0, -90]).clipAngle(90);
      break;
    case 'polar-south':
      proj = geoAzimuthalEquidistant().rotate([0, 90]).clipAngle(90);
      break;
    case 'satellite': {
      const distance = 1 + sat.altKm / EARTH_RADIUS_KM;
      proj = geoSatellite().distance(distance).rotate([-sat.lonDeg, -sat.latDeg])
        .clipAngle((Math.acos(1 / distance) * 180) / Math.PI - 1e-6);
      break;
    }
    default:
      proj = geoEquirectangular();
  }
  if (FILL_PROJECTIONS.includes(use) && rotLon) proj.rotate([-rotLon, 0]);
  proj.fitExtent([[0, 0], [width, height]], { type: 'Sphere' });
  const [tx, ty] = proj.translate();
  proj.scale(proj.scale() * zoom).translate([tx + pan[0], ty + pan[1]]);
  return proj;
}

/** Projections that pan to centre a newly focused satellite. */
export const CENTRE_ON_FOCUS = ['equirectangular', 'winkel3', 'azimuthal'];

/**
 * The pan that puts [lonDeg, latDeg] at the centre of the frame at this zoom.
 * Along an axis where the map is larger than the frame the pan is limited so
 * the map still covers it; along an axis where it is smaller it stays centred.
 * Null when the point does not project.
 */
export function centredPan(id, { width, height, observer = null, sat = null, zoom = 1 }, lonDeg, latDeg) {
  const proj = makeProjection(id, { width, height, observer, sat, zoom, pan: [0, 0] });
  const pt = proj([lonDeg, latDeg]);
  if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return null;
  const [[x0, y0], [x1, y1]] = geoPath(proj).bounds({ type: 'Sphere' });
  const axis = (want, lo, hi, size) => (hi - lo <= size + 1e-6 ? 0 : Math.max(size - hi, Math.min(-lo, want)));
  return [axis(width / 2 - pt[0], x0, x1, width), axis(height / 2 - pt[1], y0, y1, height)];
}

/** A longitude in [-180, 180). */
export function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** The world map's width and height in px at zoom 1 in this frame. */
export function worldSize(id, { width, height }) {
  const [[x0, y0], [x1, y1]] = geoPath(makeProjection(id, { width, height })).bounds({ type: 'Sphere' });
  return { width: x1 - x0, height: y1 - y0 };
}

/**
 * The view that fills a frame taller than a world map's natural aspect:
 * zoom = height / (width / aspect), rotated so lonDeg is at the centre (no
 * clamp: the world wraps). Null for disc projections and for frames the map
 * already fills at zoom 1.
 */
export function fillView(id, { width, height }, lonDeg = 0) {
  if (!FILL_PROJECTIONS.includes(id) || !(width > 0) || !(height > 0)) return null;
  const mapHeight = worldSize(id, { width, height }).height;
  if (!(mapHeight > 0) || height <= mapHeight + 1) return null;
  return { zoom: clampZoom(height / mapHeight), pan: [0, 0], rotLon: wrapLon(lonDeg) };
}
