// Pure geometry for the flat map: subpoints, footprints, night bands, ground tracks, land.
import { geoCircle } from 'd3-geo';
import { feature } from 'topojson-client';
import land110 from 'world-atlas/land-110m.json' with { type: 'json' };
import { ecefToGeodetic } from '../coords.js';
import { sunPositionEcef } from '../pass-finder/sun.js';

export const EARTH_RADIUS_KM = 6371.0088;

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const HOUR_MS = 3_600_000;

export function subpoint(ecef) {
  const g = ecefToGeodetic(ecef[0], ecef[1], ecef[2]);
  return { latDeg: g.latDeg, lonDeg: g.lonDeg, altKm: g.elevM / 1000 };
}

export function footprintRadiusDeg(altKm, minElevDeg = 0) {
  const eps = minElevDeg * RAD;
  const R = EARTH_RADIUS_KM;
  return (Math.acos((R / (R + altKm)) * Math.cos(eps)) - eps) * DEG;
}

export function subsolarPoint(date) {
  const [x, y, z] = sunPositionEcef(date);
  return { latDeg: Math.asin(z) * DEG, lonDeg: Math.atan2(y, x) * DEG };
}

function circle(lonDeg, latDeg, radiusDeg) {
  return geoCircle().center([lonDeg, latDeg]).radius(radiusDeg)();
}

// Sun altitude thresholds: horizon, civil, nautical, astronomical twilight.
export function nightBands(date) {
  const s = subsolarPoint(date);
  const anti = { lat: -s.latDeg, lon: s.lonDeg + 180 };
  return [0, -6, -12, -18].map((sunBelowDeg) => ({
    sunBelowDeg,
    feature: circle(anti.lon, anti.lat, 90 - sunBelowDeg),
  }));
}

export function footprintFeature(sub, altKm, minElevDeg = 0) {
  return circle(sub.lonDeg, sub.latDeg, footprintRadiusDeg(altKm, minElevDeg));
}

export function groundTrack(track, nowMs, { steps = 240 } = {}) {
  const geo = track.orbitClass === 'geo';
  const start = geo ? nowMs - 12 * HOUR_MS : nowMs - 0.25 * track.periodMs;
  const end = geo ? nowMs + 12 * HOUR_MS : nowMs + track.periodMs;
  const lines = [];
  let line = null;
  for (let i = 0; i <= steps; i++) {
    const ecef = track.ecefAt(new Date(start + ((end - start) * i) / steps));
    if (!ecef) continue;
    const { latDeg, lonDeg } = subpoint(ecef);
    if (line && Math.abs(lonDeg - line[line.length - 1][0]) > 180) line = null;
    if (!line) { line = []; lines.push(line); }
    line.push([lonDeg, latDeg]);
  }
  return { type: 'MultiLineString', coordinates: lines };
}

let landCache = null;
export function loadLand() {
  landCache ??= feature(land110, land110.objects.land);
  return landCache;
}
