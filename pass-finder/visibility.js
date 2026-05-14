// pass-finder/visibility.js -- pure math for the simultaneous-visibility predicate.
//
// Inputs:
//   observer: { latDeg, lonDeg }  (elevation ignored — surface ~OK for visibility)
//   issEcef:  [x,y,z] in meters
//   jsDate:   Date

import { geodeticToEcef } from "../coords.js";
import { sunPositionEcef } from "./sun.js";

const DEG = Math.PI / 180;
const R_EARTH = 6_371_000; // mean radius, meters — used for shadow cylinder.

// Project ECEF vector v into observer's ENU and return altitude in degrees.
function altitudeAtObserverDeg(obs, ecefVec) {
  const obsEcef = geodeticToEcef(obs.latDeg, obs.lonDeg, 0);
  // Vector from observer to point, in ECEF.
  const dx = ecefVec[0] - obsEcef[0];
  const dy = ecefVec[1] - obsEcef[1];
  const dz = ecefVec[2] - obsEcef[2];
  // Rotate (dx,dy,dz) into ENU. ENU->ECEF basis is given by enuToEcefRotate;
  // the inverse rotates ECEF->ENU. Since the basis is orthonormal,
  // inverse = transpose. Project onto each basis vector.
  const lat = obs.latDeg * DEG, lon = obs.lonDeg * DEG;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  // East basis = (-sinLon, cosLon, 0)
  // North basis = (-sinLat*cosLon, -sinLat*sinLon, cosLat)
  // Up basis = (cosLat*cosLon, cosLat*sinLon, sinLat)
  const e = -sinLon*dx + cosLon*dy;
  const n = -sinLat*cosLon*dx - sinLat*sinLon*dy + cosLat*dz;
  const u = cosLat*cosLon*dx + cosLat*sinLon*dy + sinLat*dz;
  return Math.atan2(u, Math.hypot(e, n)) / DEG;
}

export function issAltitudeDeg(obs, issEcef) {
  return altitudeAtObserverDeg(obs, issEcef);
}

export function sunAltitudeDeg(obs, jsDate) {
  // Sun direction (unit vector) is sufficient; scale doesn't change altitude.
  const sunDirEcef = sunPositionEcef(jsDate);
  // Treat sun as "at infinity" along sunDirEcef: altitude is the angle between
  // sunDir and the observer's local up.
  const lat = obs.latDeg * DEG, lon = obs.lonDeg * DEG;
  const upX = Math.cos(lat) * Math.cos(lon);
  const upY = Math.cos(lat) * Math.sin(lon);
  const upZ = Math.sin(lat);
  const dot = sunDirEcef[0]*upX + sunDirEcef[1]*upY + sunDirEcef[2]*upZ;
  // dot = cos(zenith angle). Altitude = 90 - zenith.
  return 90 - Math.acos(Math.max(-1, Math.min(1, dot))) / DEG;
}

// Cylindrical Earth-shadow test.
// issEcef in meters, sunDir is a unit vector from Earth toward the Sun.
export function issIlluminated(issEcef, sunDir) {
  // ISS is in shadow iff it's on the anti-sun side AND inside the shadow cylinder.
  const antiSun = [-sunDir[0], -sunDir[1], -sunDir[2]];
  const along = issEcef[0]*antiSun[0] + issEcef[1]*antiSun[1] + issEcef[2]*antiSun[2];
  if (along <= 0) return true; // on the sunlit hemisphere
  const px = issEcef[0] - along*antiSun[0];
  const py = issEcef[1] - along*antiSun[1];
  const pz = issEcef[2] - along*antiSun[2];
  const perp = Math.hypot(px, py, pz);
  return perp >= R_EARTH;
}

// Combined predicate: every observer sees an illuminated ISS in their twilight sky.
export function isVisibleAtAll(observers, issEcef, jsDate, opts = {}) {
  const minIssAltDeg = opts.minIssAltDeg ?? 10;
  const maxSunAltDeg = opts.maxSunAltDeg ?? -6;
  const sunDir = sunPositionEcef(jsDate);
  if (!issIlluminated(issEcef, sunDir)) return false;
  for (const obs of observers) {
    if (issAltitudeDeg(obs, issEcef) < minIssAltDeg) return false;
    if (sunAltitudeDeg(obs, jsDate) > maxSunAltDeg) return false;
  }
  return true;
}
