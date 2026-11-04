// pass-finder/visibility.js -- pure math for the simultaneous-visibility predicate.
//
// Inputs:
//   observer: { latDeg, lonDeg, elevM? }
//   satEcef:  [x,y,z] in meters
//   jsDate:   Date

import { geodeticToEcef } from "../coords.js";
import { sunPositionEcef } from "./sun.js";
import { apparentAltDeg } from "../refraction.js";

const DEG = Math.PI / 180;
const R_EARTH = 6_371_000; // mean radius, meters - used for the shadow.

// Project ECEF vector v into observer's ENU and return altitude/azimuth in
// degrees. Azimuth is measured from north, clockwise (E=90, S=180, W=270).
function altAzAtObserverDeg(obs, ecefVec) {
  const obsEcef = geodeticToEcef(obs.latDeg, obs.lonDeg, obs.elevM ?? 0);
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
  const e = -sinLon*dx + cosLon*dy;
  const n = -sinLat*cosLon*dx - sinLat*sinLon*dy + cosLat*dz;
  const u = cosLat*cosLon*dx + cosLat*sinLon*dy + sinLat*dz;
  const alt = Math.atan2(u, Math.hypot(e, n)) / DEG;
  let az = Math.atan2(e, n) / DEG;
  if (az < 0) az += 360;
  return { alt, az };
}

export function satAltitudeDeg(obs, satEcef) {
  return altAzAtObserverDeg(obs, satEcef).alt;
}

export function satAltAzDeg(obs, satEcef) {
  return altAzAtObserverDeg(obs, satEcef);
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

// Earth's shadow, cone model. Seen from the satellite, the Sun is a disc of
// angular radius a and Earth a disc of radius b; the fraction of the Sun's
// disc that Earth leaves uncovered is how much direct sunlight it gets. This
// gives the umbra (none), the penumbra (some) and the umbra's taper with
// distance, so shadow entry is gradual: a few seconds in low orbit, a minute
// or more in GEO.
const AU = 149_597_870_700; // m; the Sun's distance varies ±1.7%, ignored.
const R_SUN = 696_000_000; // m
// Sunlight that grazes the lower atmosphere is mostly absorbed or scattered,
// so Earth blocks light as if about 20 km larger than its mean radius.
export const SHADOW_ATMOSPHERE_M = 20_000;
const R_SHADOW = R_EARTH + SHADOW_ATMOSPHERE_M;

const clamp1 = (x) => Math.max(-1, Math.min(1, x));

/** Fraction of the Sun's disc visible from the satellite, 0 (umbra) to 1
 *  (full sunlight). satEcef in meters; sunDir is a unit vector from Earth
 *  toward the Sun. */
export function sunlitFraction(satEcef, sunDir) {
  const r = Math.hypot(satEcef[0], satEcef[1], satEcef[2]);
  if (r <= R_SHADOW) return 0;
  // Satellite to Sun.
  const dx = sunDir[0] * AU - satEcef[0];
  const dy = sunDir[1] * AU - satEcef[1];
  const dz = sunDir[2] * AU - satEcef[2];
  const d = Math.hypot(dx, dy, dz);
  const a = Math.asin(R_SUN / d);
  const b = Math.asin(R_SHADOW / r);
  // Angle between the Sun's centre and Earth's centre, seen from the satellite.
  const c = Math.acos(clamp1(-(satEcef[0] * dx + satEcef[1] * dy + satEcef[2] * dz) / (r * d)));
  if (c >= a + b) return 1;
  if (c <= b - a) return 0;
  if (c <= a - b) return 1 - (b * b) / (a * a); // Earth inside the Sun's disc
  // Two overlapping discs (small angles, so flat geometry).
  const x = (c * c + a * a - b * b) / (2 * c);
  const y = Math.sqrt(Math.max(0, a * a - x * x));
  const overlap = a * a * Math.acos(clamp1(x / a)) + b * b * Math.acos(clamp1((c - x) / b)) - c * y;
  return Math.max(0, Math.min(1, 1 - overlap / (Math.PI * a * a)));
}

/** Any direct sunlight on the satellite (outside the umbra). */
export function satIlluminated(satEcef, sunDir) {
  return sunlitFraction(satEcef, sunDir) > 0;
}

// Combined predicate: every observer sees an illuminated satellite in their twilight
// sky. Uses apparent (refraction-corrected) altitude for the threshold check -
// refraction lifts low objects ~5' at 10° altitude, ~34' at the horizon, so
// the geometric and apparent thresholds differ noticeably near the limit.
export function isVisibleAtAll(observers, satEcef, jsDate, opts = {}) {
  const minSatAltDeg = opts.minSatAltDeg ?? 10;
  const maxSunAltDeg = opts.maxSunAltDeg ?? -6;
  const sunDir = sunPositionEcef(jsDate);
  if (!satIlluminated(satEcef, sunDir)) return false;
  for (const obs of observers) {
    if (apparentAltDeg(satAltitudeDeg(obs, satEcef)) < minSatAltDeg) return false;
    if (apparentAltDeg(sunAltitudeDeg(obs, jsDate)) > maxSunAltDeg) return false;
  }
  return true;
}

// Radio-reception predicate: all observers have geometric line-of-sight
// to the satellite at apparent elevation ≥ minSatAltDeg. No sun-below-horizon
// or satellite-illuminated check - radio links work day or night and cloud/
// twilight effects on VHF/UHF are negligible. This is the "coordinated
// multi-station reachable" predicate that mirrors the visual joint
// gate: every observer must be above the threshold simultaneously.
export function isRadioReachable(observers, satEcef, jsDate, opts = {}) {
  const minSatAltDeg = opts.minSatAltDeg ?? 10;
  for (const obs of observers) {
    if (apparentAltDeg(satAltitudeDeg(obs, satEcef)) < minSatAltDeg) return false;
  }
  return true;
}
