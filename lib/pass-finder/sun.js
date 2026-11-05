// pass-finder/sun.js -- low-precision solar ephemeris.
// Returns the sun's unit direction vector from Earth's center.
// Accurate to ~0.01° for dates within the 21st century - plenty for
// twilight/illumination checks. Formula from Meeus, "Astronomical Algorithms",
// chapter 25 (low-accuracy form).

import { gmstFromDate, eciToEcefRotate } from "../coords.js";

const DEG = Math.PI / 180;

// Unit vector from Earth's center toward the Sun, in ECI (J2000-ish).
export function sunPositionEci(jsDate) {
  const jd = jsDate.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;                 // days from J2000.0 TT (approx)
  const L = ((280.460 + 0.9856474 * n) % 360 + 360) % 360;  // mean longitude
  const g = ((357.528 + 0.9856003 * n) % 360 + 360) % 360;  // mean anomaly
  const lambdaDeg = L + 1.915 * Math.sin(g * DEG) + 0.020 * Math.sin(2 * g * DEG);
  const epsilonDeg = 23.439 - 0.0000004 * n;

  const lambda = lambdaDeg * DEG;
  const epsilon = epsilonDeg * DEG;
  const cosL = Math.cos(lambda), sinL = Math.sin(lambda);
  // x = cos(lambda), y = cos(eps)*sin(lambda), z = sin(eps)*sin(lambda)
  return [cosL, Math.cos(epsilon) * sinL, Math.sin(epsilon) * sinL];
}

// Earth-Sun distance in AU (Meeus ch. 25, low accuracy): about 0.983 in early
// January to 1.017 in early July.
export function sunDistanceAu(jsDate) {
  const jd = jsDate.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const g = (((357.528 + 0.9856003 * n) % 360) + 360) % 360 * DEG;
  return 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
}

// Unit vector from Earth's center toward the Sun, in ECEF.
export function sunPositionEcef(jsDate) {
  return eciToEcefRotate(sunPositionEci(jsDate), gmstFromDate(jsDate));
}
