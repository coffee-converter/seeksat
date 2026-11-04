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

// Earth's shadow, with its atmosphere.
//
// Seen from the satellite, the Sun is a disc of angular radius a (~0.27°).
// Light from each part of it reaches the satellite along a ray that passes
// Earth at some tangent height h. That ray is:
//   - blocked below FLOOR_M (a path that low crosses clouds and haze for
//     hundreds of km),
//   - dimmed by air (Rayleigh scattering) and ozone along its edge-on path,
//   - bent toward Earth by refraction, which lets some light into the
//     geometric shadow but spreads it thin (the reason an eclipsed Moon is
//     red and dim, not dark).
// The Sun's disc is darker at its edge (limb darkening). Earth's radius is
// the WGS84 ellipsoid's at the point where the light grazes it.
//
// The result is a smooth fade: the satellite reddens and dims over several
// seconds in low orbit and a couple of minutes in GEO. The numbers are for
// the visual band on a clear atmosphere; volcanic haze makes the real fade a
// little earlier.
const AU = 149_597_870_700; // m; the Sun's distance varies ±1.7%, ignored.
const R_SUN = 696_000_000; // m
const WGS84_A = 6_378_137;
const WGS84_B = 6_356_752.3142;
const LIMB_DARKENING = 0.6; // linear coefficient, visual band
export const FLOOR_M = 10_000;
const TOP_M = 80_000; // above this the air neither dims nor bends sunlight
const STEP_M = 200;
// Visual-band zenith optical depths: air (Rayleigh, ~550 nm) and ozone
// (Chappuis band, ~300 DU).
const TAU_RAYLEIGH = 0.10;
const TAU_OZONE = 0.03;
const OZONE_PEAK_M = 22_000;
const OZONE_SIGMA_M = 6_000;
// Refractivity n - 1 of air at sea-level density (visual band).
const REFRACTIVITY_0 = 2.77e-4;
// Below this fraction of full sunlight the satellite counts as in shadow:
// 7.5 magnitudes fainter, so only refracted glow is left.
export const LIT_MIN = 1e-3;

// US Standard Atmosphere 1976 density, kg/m³, by height in km.
const DENSITY = [
  [0, 1.225], [2, 1.007], [4, 0.8194], [6, 0.6601], [8, 0.5258], [10, 0.4135],
  [12, 0.3119], [14, 0.2279], [16, 0.1665], [18, 0.1216], [20, 0.08891],
  [22, 0.06451], [24, 0.04694], [26, 0.03426], [28, 0.02508], [30, 0.01841],
  [32, 0.01355], [35, 0.008463], [40, 0.003996], [45, 0.001966],
  [50, 0.001027], [60, 0.0003097], [70, 0.00008283], [80, 0.00001846],
  [90, 0.00000340],
];

// Density relative to sea level and its height derivative (per m), log-linear
// between table rows.
function airAt(zM) {
  const zKm = zM / 1000;
  let i = 0;
  while (i < DENSITY.length - 2 && DENSITY[i + 1][0] <= zKm) i++;
  const [z0, d0] = DENSITY[i];
  const [z1, d1] = DENSITY[i + 1];
  const k = Math.log(d1 / d0) / ((z1 - z0) * 1000); // per m, negative
  const rho = (d0 * Math.exp(k * (zM - z0 * 1000))) / DENSITY[0][1];
  return { rho, slope: rho * k };
}

const ozoneAt = (zM) => Math.exp(-((zM - OZONE_PEAK_M) ** 2) / (2 * OZONE_SIGMA_M ** 2));

// For each tangent height from the floor to the top: the fraction of light
// let through (transmission) and the total bending (radians). Edge-on path
// integrals with z = h + y², so ds = sqrt(2R)·dy; R is the mean radius here,
// the local radius changes them by well under 1%.
let table = null;
function atmosphereTable() {
  if (table) return table;
  const R = 6_371_000;
  const k = Math.sqrt(2 * R);
  // Vertical columns, to scale the zenith optical depths.
  let airCol = 0, ozCol = 0;
  for (let z = 0; z < 100_000; z += 50) {
    airCol += airAt(z + 25).rho * 50;
    ozCol += ozoneAt(z + 25) * 50;
  }
  const n = Math.round((TOP_M - FLOOR_M) / STEP_M) + 1;
  const trans = new Float64Array(n);
  const bend = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const h = FLOOR_M + i * STEP_M;
    let air = 0, oz = 0, slope = 0;
    const yMax = Math.sqrt(100_000 - h + 1), dy = yMax / 600;
    for (let j = 0; j < 600; j++) {
      const y = (j + 0.5) * dy;
      const z = h + y * y;
      const a = airAt(z);
      air += a.rho * dy;
      slope += a.slope * dy;
      oz += ozoneAt(z) * dy;
    }
    // Both halves of the path.
    const tau = (TAU_RAYLEIGH * 2 * k * air) / airCol + (TAU_OZONE * 2 * k * oz) / ozCol;
    trans[i] = Math.exp(-tau);
    bend[i] = -2 * k * REFRACTIVITY_0 * slope;
  }
  table = { trans, bend };
  return table;
}

function atmosphere(h) {
  const t = atmosphereTable();
  const x = (h - FLOOR_M) / STEP_M;
  const i = Math.max(0, Math.min(t.trans.length - 2, Math.floor(x)));
  const f = Math.max(0, Math.min(1, x - i));
  return {
    trans: t.trans[i] + (t.trans[i + 1] - t.trans[i]) * f,
    bend: t.bend[i] + (t.bend[i + 1] - t.bend[i]) * f,
  };
}

/** Transmission and bending of a ray grazing Earth at tangent height h (m). */
export function grazingRay(hM) {
  if (hM < FLOOR_M) return { trans: 0, bend: 0 };
  if (hM >= TOP_M) return { trans: 1, bend: 0 };
  return atmosphere(hM);
}

const clamp1 = (x) => Math.max(-1, Math.min(1, x));

// Limb-darkened Sun of angular radius a: brightness along the chord at
// offset x from its centre, and the brightness of the part beyond offset d.
function chord(x, a) {
  const w2 = a * a - x * x;
  if (w2 <= 0) return 0;
  const w = Math.sqrt(w2);
  return 2 * w * (1 - LIMB_DARKENING) + (LIMB_DARKENING * Math.PI * w2) / (2 * a);
}
function beyond(d, a) {
  if (d >= a) return 0;
  if (d <= -a) return Math.PI * a * a * (1 - LIMB_DARKENING / 3);
  const seg = a * a * Math.acos(d / a) - d * Math.sqrt(a * a - d * d);
  return (1 - LIMB_DARKENING) * seg + ((LIMB_DARKENING * Math.PI) / (2 * a)) * (a * a * (a - d) - (a ** 3 - d ** 3) / 3);
}

// Earth's radius at the point where the satellite-to-Sun line passes closest.
function grazingRadius(sat, sunDir) {
  const t = -(sat[0] * sunDir[0] + sat[1] * sunDir[1] + sat[2] * sunDir[2]);
  const px = sat[0] + t * sunDir[0];
  const py = sat[1] + t * sunDir[1];
  const pz = sat[2] + t * sunDir[2];
  const p = Math.hypot(px, py, pz);
  if (p === 0) return 6_371_000;
  const s2 = (pz / p) ** 2; // sin² of geocentric latitude
  const c2 = 1 - s2;
  return Math.sqrt(((WGS84_A ** 2) ** 2 * c2 + (WGS84_B ** 2) ** 2 * s2) / (WGS84_A ** 2 * c2 + WGS84_B ** 2 * s2));
}

/** Fraction of full sunlight reaching the satellite, 0 (in Earth's shadow)
 *  to 1. satEcef in meters; sunDir is a unit vector from Earth toward the
 *  Sun. */
export function sunlitFraction(satEcef, sunDir) {
  const r = Math.hypot(satEcef[0], satEcef[1], satEcef[2]);
  // Satellite to Sun.
  const dx = sunDir[0] * AU - satEcef[0];
  const dy = sunDir[1] * AU - satEcef[1];
  const dz = sunDir[2] * AU - satEcef[2];
  const d = Math.hypot(dx, dy, dz);
  const a = Math.asin(R_SUN / d);
  // Angle between the Sun's centre and Earth's centre, seen from the satellite.
  const c = Math.acos(clamp1(-(satEcef[0] * dx + satEcef[1] * dy + satEcef[2] * dz) / (r * d)));
  // Angles from Earth's centre are measured from the satellite: a ray seen at
  // angle u passes Earth at tangent height r·sin(u) - R.
  const R = grazingRadius(satEcef, sunDir);
  if (r <= R + TOP_M) return c > Math.PI / 2 ? 1 : 0; // re-entering; not modelled
  const uTop = Math.asin((R + TOP_M) / r);
  if (c - a >= uTop) return 1;
  const uFloor = Math.asin((R + FLOOR_M) / r);
  // Refraction lifts each ray's source by its bending: the light seen at u
  // left the Sun at u - bend.
  if (c + a <= uFloor - grazingRay(FLOOR_M).bend) return 0;
  // Light from above the atmosphere arrives unchanged. Through it, each strip
  // of tangent height [h0, h1] is seen across an apparent width du but
  // carries the part of the Sun between its source offsets x0 and x1 (bent
  // by refraction), squeezed by du/dx and dimmed by transmission.
  let total = beyond(uTop - c, a);
  let u0 = uFloor;
  let x0 = u0 - grazingRay(FLOOR_M).bend - c;
  for (let h1 = FLOOR_M + STEP_M; h1 <= TOP_M; h1 += STEP_M) {
    const u1 = Math.asin((R + h1) / r);
    const x1 = u1 - (h1 >= TOP_M ? 0 : grazingRay(h1).bend) - c;
    if (x1 > -a && x0 < a) {
      const trans = grazingRay(h1 - STEP_M / 2).trans;
      total += trans * ((u1 - u0) / (x1 - x0)) * (beyond(x0, a) - beyond(x1, a));
    }
    u0 = u1;
    x0 = x1;
  }
  const f = total / (Math.PI * a * a * (1 - LIMB_DARKENING / 3));
  return f < LIT_MIN ? 0 : Math.min(1, f);
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
