// pass-finder/planets.js -- low-precision planetary ephemerides.
//
// Returns geocentric direction (and approximate apparent magnitude) for
// the five classical naked-eye planets - Mercury, Venus, Mars, Jupiter,
// Saturn - using truncated Keplerian elements at J2000 with linear
// secular drift. Accurate to a few arcminutes for dates in the 21st
// century, well past polar-chart resolution.
//
// Elements: NASA JPL "Approximate Positions of the Planets", table 1.
// https://ssd.jpl.nasa.gov/planets/approx_pos.html

import { gmstFromDate, eciToEcefRotate } from "../coords.js";

const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

// Per planet: orbital elements at J2000 + rates per Julian century.
//   a  = semi-major axis (AU)
//   e  = eccentricity
//   I  = inclination (deg)
//   L  = mean longitude (deg)
//   lp = longitude of perihelion (deg)
//   om = longitude of ascending node (deg)
//   m0 = absolute-magnitude-ish reference (mag at r=Δ=1 AU, phase 0)
const ELEMENTS = {
  mercury: {
    a:  0.38709927, e:  0.20563593, I:  7.00497902,
    L: 252.25032350, lp:  77.45779628, om:  48.33076593,
    da: 0.00000037, de: 0.00001906, dI: -0.00594749,
    dL: 149472.67411175, dlp: 0.16047689, dom: -0.12534081,
    m0: -0.42,
  },
  venus: {
    a:  0.72333566, e:  0.00677672, I:  3.39467605,
    L: 181.97909950, lp: 131.60246718, om:  76.67984255,
    da: 0.00000390, de: -0.00004107, dI: -0.00078890,
    dL: 58517.81538729, dlp: 0.00268329, dom: -0.27769418,
    m0: -4.40,
  },
  earth: {
    a:  1.00000261, e:  0.01671123, I: -0.00001531,
    L: 100.46457166, lp: 102.93768193, om:   0.0,
    da: 0.00000562, de: -0.00004392, dI: -0.01294668,
    dL: 35999.37244981, dlp: 0.32327364, dom: 0.0,
  },
  mars: {
    a:  1.52371034, e:  0.09339410, I:  1.84969142,
    L:  -4.55343205, lp: -23.94362959, om:  49.55953891,
    da: 0.00001847, de: 0.00007882, dI: -0.00813131,
    dL: 19140.30268499, dlp: 0.44441088, dom: -0.29257343,
    m0: -1.52,
  },
  jupiter: {
    a:  5.20288700, e:  0.04838624, I:  1.30439695,
    L:  34.39644051, lp:  14.72847983, om: 100.47390909,
    da: -0.00011607, de: -0.00013253, dI: -0.00183714,
    dL: 3034.74612775, dlp: 0.21252668, dom: 0.20469106,
    m0: -9.40,
  },
  saturn: {
    a:  9.53667594, e:  0.05386179, I:  2.48599187,
    L:  49.95424423, lp:  92.59887831, om: 113.66242448,
    da: -0.00125060, de: -0.00050991, dI: 0.00193609,
    dL: 1222.49362201, dlp: -0.41897216, dom: -0.28867794,
    m0: -8.88,
  },
};

function julianCenturiesT(jsDate) {
  const jd = jsDate.getTime() / 86400000 + 2440587.5;
  return (jd - 2451545.0) / 36525;
}

// Mean obliquity of the ecliptic (radians) at time T centuries from J2000.
function obliquityRad(T) {
  return (23.4392911 - 0.0130042 * T) * DEG;
}

// Heliocentric position in J2000 ecliptic coordinates (AU).
function heliocentricEcliptic(name, T) {
  const E = ELEMENTS[name];
  const a  = E.a  + E.da  * T;
  const e  = E.e  + E.de  * T;
  const I  = (E.I  + E.dI  * T) * DEG;
  const L  = (E.L  + E.dL  * T) * DEG;
  const lp = (E.lp + E.dlp * T) * DEG;
  const om = (E.om + E.dom * T) * DEG;
  const w  = lp - om;                  // argument of perihelion
  // Mean anomaly normalized to (-π, π].
  let M = ((L - lp) % TWO_PI + TWO_PI) % TWO_PI;
  if (M > Math.PI) M -= TWO_PI;
  // Kepler's equation: E_an - e sin E_an = M. Newton-Raphson.
  let Ean = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) {
    const dE = (Ean - e * Math.sin(Ean) - M) / (1 - e * Math.cos(Ean));
    Ean -= dE;
    if (Math.abs(dE) < 1e-11) break;
  }
  // Coordinates in the orbital plane, +x toward perihelion.
  const xp = a * (Math.cos(Ean) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(Ean);
  // Rotate to J2000 ecliptic frame: argument of perihelion (w) in
  // plane, inclination (I) about node line, longitude of node (om)
  // about ecliptic-z.
  const cw = Math.cos(w),  sw = Math.sin(w);
  const cO = Math.cos(om), sO = Math.sin(om);
  const cI = Math.cos(I),  sI = Math.sin(I);
  const x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  const y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  const z = (sw * sI) * xp + (cw * sI) * yp;
  return [x, y, z];
}

// Geocentric position vector of planet in J2000 equatorial (ECI) frame,
// in AU.
export function planetPositionEci(name, jsDate) {
  const T = julianCenturiesT(jsDate);
  const p = heliocentricEcliptic(name, T);
  const e = heliocentricEcliptic("earth", T);
  const xe = p[0] - e[0], ye = p[1] - e[1], ze = p[2] - e[2];
  // Ecliptic → equatorial: rotate about x-axis by obliquity.
  const eps = obliquityRad(T);
  const c = Math.cos(eps), s = Math.sin(eps);
  return [xe, ye * c - ze * s, ye * s + ze * c];
}

// Unit-vector geocentric direction in ECEF.
export function planetPositionEcef(name, jsDate) {
  const v = planetPositionEci(name, jsDate);
  const len = Math.hypot(v[0], v[1], v[2]);
  const unit = [v[0] / len, v[1] / len, v[2] / len];
  return eciToEcefRotate(unit, gmstFromDate(jsDate));
}

// Approximate apparent magnitude. Treats phase function as 0 - fine for
// the outer planets, and the resulting size error on Venus/Mercury
// reads as "looks roughly that bright" on the chart.
//   m = m0 + 5 log10(r * Δ)
// where r is heliocentric distance and Δ is geocentric distance, both
// in AU. m0 is the magnitude that planet would have at r=Δ=1 AU.
export function planetApparentMagnitude(name, jsDate) {
  const E = ELEMENTS[name];
  if (!E || E.m0 == null) return null;
  const T = julianCenturiesT(jsDate);
  const p = heliocentricEcliptic(name, T);
  const e = heliocentricEcliptic("earth", T);
  const r = Math.hypot(p[0], p[1], p[2]);
  const d = Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]);
  return E.m0 + 5 * Math.log10(r * d);
}

// Render metadata. Color is rough naked-eye tint, glyph is the
// traditional astrological symbol.
export const PLANET_STYLE = {
  mercury: { name: "Mercury", color: "#c8c2a5", glyph: "☿" }, // ☿
  venus:   { name: "Venus",   color: "#fbf2d6", glyph: "♀" }, // ♀
  mars:    { name: "Mars",    color: "#dc6e4a", glyph: "♂" }, // ♂
  jupiter: { name: "Jupiter", color: "#dec79c", glyph: "♃" }, // ♃
  saturn:  { name: "Saturn",  color: "#d4ba7c", glyph: "♄" }, // ♄
};

export const PLANET_NAMES = ["mercury", "venus", "mars", "jupiter", "saturn"];
