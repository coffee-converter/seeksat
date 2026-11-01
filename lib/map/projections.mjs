// lib/map/projections.mjs - pure d3 projection factory for the flat map.
import { geoEquirectangular, geoAzimuthalEquidistant } from 'd3-geo';
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

export function clampZoom(z) {
  return Math.min(8, Math.max(1, z));
}

export function projectionAvailable(id, { observer = null, sat = null } = {}) {
  if (!PROJECTIONS.some((p) => p.id === id)) return false;
  if (id === 'azimuthal') return !!observer;
  if (id === 'satellite') return !!sat;
  return true;
}

export function makeProjection(id, { width, height, observer = null, sat = null, zoom = 1, pan = [0, 0] }) {
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
      proj = geoAzimuthalEquidistant().rotate([0, -90]).clipAngle(110);
      break;
    case 'polar-south':
      proj = geoAzimuthalEquidistant().rotate([0, 90]).clipAngle(110);
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
  proj.fitExtent([[0, 0], [width, height]], { type: 'Sphere' });
  const [tx, ty] = proj.translate();
  proj.scale(proj.scale() * zoom).translate([tx + pan[0], ty + pan[1]]);
  return proj;
}
