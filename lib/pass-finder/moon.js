// pass-finder/moon.js -- low-precision lunar ephemeris.
//
// Returns the moon's unit direction vector from Earth's center, and
// the geocentric phase angle (used for illumination fraction +
// crescent/gibbous shape on the polar sky chart). Accurate to a few
// arcminutes for dates within the 21st century - well past the
// resolution of the polar plot.
//
// Formulas from Meeus, "Astronomical Algorithms" chapter 47, with
// only the largest-amplitude periodic terms retained.

import { gmstFromDate, eciToEcefRotate } from "../coords.js";
import { sunPositionEci } from "./sun.js";

const DEG = Math.PI / 180;

// Mean orbital elements at instant `jsDate`, in degrees.
function moonElements(jsDate) {
  const jd = jsDate.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525; // Julian centuries from J2000
  // Mean longitude
  const Lp = 218.3164591 + 481267.88134236 * T;
  // Mean elongation (Moon - Sun)
  const D  = 297.8502042 + 445267.1115168 * T;
  // Sun's mean anomaly
  const M  = 357.5291092 + 35999.0502909 * T;
  // Moon's mean anomaly
  const Mp = 134.9634114 + 477198.8676313 * T;
  // Argument of latitude
  const F  =  93.2720993 + 483202.0175273 * T;
  // Mean obliquity of the ecliptic
  const eps = 23.4392911 - 0.0130042 * T;
  return { Lp, D, M, Mp, F, eps };
}

// Unit vector from Earth toward the Moon, in ECI coordinates.
export function moonPositionEci(jsDate) {
  const e = moonElements(jsDate);
  const D = e.D * DEG, M = e.M * DEG, Mp = e.Mp * DEG, F = e.F * DEG;
  // Apparent ecliptic longitude - only the biggest periodic terms.
  const lonDeg = e.Lp
    + 6.289 * Math.sin(Mp)
    - 1.274 * Math.sin(Mp - 2 * D)
    + 0.658 * Math.sin(2 * D)
    - 0.186 * Math.sin(M)
    - 0.059 * Math.sin(2 * Mp - 2 * D)
    - 0.057 * Math.sin(Mp - 2 * D + M)
    + 0.053 * Math.sin(Mp + 2 * D)
    + 0.046 * Math.sin(2 * D - M)
    + 0.041 * Math.sin(Mp - M)
    - 0.035 * Math.sin(D)
    - 0.031 * Math.sin(Mp + M);
  // Apparent ecliptic latitude.
  const latDeg = 5.128 * Math.sin(F)
    + 0.281 * Math.sin(Mp + F)
    + 0.278 * Math.sin(Mp - F)
    + 0.173 * Math.sin(2 * D - F)
    + 0.055 * Math.sin(2 * D + F - Mp)
    + 0.046 * Math.sin(2 * D - F - Mp)
    + 0.033 * Math.sin(2 * D + F)
    + 0.017 * Math.sin(2 * Mp + F);
  // Ecliptic → ECI: rotate around the x-axis by the obliquity.
  const lon = lonDeg * DEG, lat = latDeg * DEG, eps = e.eps * DEG;
  const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
  const xE = cosLat * Math.cos(lon);
  const yE = cosLat * Math.sin(lon);
  const zE = sinLat;
  const cosEps = Math.cos(eps), sinEps = Math.sin(eps);
  // Rotation around the x-axis maps ecliptic frame to equatorial (ECI).
  const x = xE;
  const y = yE * cosEps - zE * sinEps;
  const z = yE * sinEps + zE * cosEps;
  return [x, y, z];
}

// Unit vector from Earth toward the Moon, in ECEF.
export function moonPositionEcef(jsDate) {
  return eciToEcefRotate(moonPositionEci(jsDate), gmstFromDate(jsDate));
}

// Geocentric phase angle of the moon (radians).
//   0   → full moon (sun behind observer)
//   π/2 → first or last quarter
//   π   → new moon (sun behind moon)
// Computed from the angle between the geocentric sun-vector and the
// geocentric moon-vector. For lunar distances (~384,000 km) the
// difference between geocentric and topocentric phase angle is well
// under a degree - invisible at sky-chart resolution.
export function moonPhaseAngle(jsDate) {
  const m = moonPositionEci(jsDate);
  const s = sunPositionEci(jsDate);
  const dot = m[0] * s[0] + m[1] * s[1] + m[2] * s[2];
  // Both are unit vectors, so dot = cos(separation between earth-moon
  // and earth-sun). Phase angle (moon-observer-sun ≈ moon-earth-sun's
  // supplement): i = π - separation.
  const sep = Math.acos(Math.max(-1, Math.min(1, dot)));
  return Math.PI - sep;
}

// Illuminated fraction of the moon's apparent disc, 0..1.
export function moonIlluminatedFraction(jsDate) {
  return (1 + Math.cos(moonPhaseAngle(jsDate))) / 2;
}
