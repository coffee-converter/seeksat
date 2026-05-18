// coords.js -- pure JS coord helpers. No Cesium dependency.

const DEG = Math.PI / 180;
const HOUR = Math.PI / 12;

// "40°30'15.9\"N" | "40.5083" | "-75.26" -> decimal degrees. N/E positive, S/W negative.
// Normalize a coordinate-string by mapping Unicode look-alikes onto
// the ASCII characters the parsers expect. Browser auto-formatting
// and chat-pasted values commonly use typographic minus / dashes
// and prime / double-prime marks that the strict regexes below
// would otherwise refuse.
function normalizeCoordString(str) {
  return String(str).trim()
    .replace(/[−–—‐‑‒―]/g, "-") // various dashes/minus → ASCII -
    .replace(/′/g, "'")
    .replace(/″/g, '"');
}

export function parseDmsToDecimal(str) {
  if (str == null) throw new Error('parseDmsToDecimal: null input');
  const s = normalizeCoordString(str);
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = s.match(
    /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['m]?\s*(?:(\d+(?:\.\d+)?)\s*["s]?)?)?\s*([NSEWnsew])?\s*$/
  );
  if (!m) throw new Error(`parseDmsToDecimal: cannot parse "${str}"`);
  const deg = parseFloat(m[1]);
  const min = m[2] ? parseFloat(m[2]) : 0;
  const sec = m[3] ? parseFloat(m[3]) : 0;
  if (min >= 60 || sec >= 60) {
    throw new Error(`parseDmsToDecimal: minutes/seconds out of range in "${str}"`);
  }
  const hemi = m[4] && m[4].toUpperCase();
  const hemiSign = (hemi === 'S' || hemi === 'W') ? -1 : 1;
  if (deg < 0 && hemiSign === -1) {
    throw new Error(`parseDmsToDecimal: ambiguous sign (negative degree + ${hemi} hemisphere) in "${str}"`);
  }
  const baseSign = deg < 0 ? -1 : 1;
  return baseSign * hemiSign * (Math.abs(deg) + min / 60 + sec / 3600);
}

// "5h 30m 52.4110s" | "5 30 52.411" | "5.5145586" -> hours.
export function parseRaToHours(str) {
  const s = normalizeCoordString(str);
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = s.match(
    /^\s*(\d+(?:\.\d+)?)\s*[h:\s]\s*(\d+(?:\.\d+)?)\s*[m':\s]\s*(\d+(?:\.\d+)?)\s*[s"]?\s*$/
  );
  if (!m) throw new Error(`parseRaToHours: cannot parse "${str}"`);
  return parseFloat(m[1]) + parseFloat(m[2]) / 60 + parseFloat(m[3]) / 3600;
}

// "41° 51' 10.0489\"" | "-12 30 45" | decimal -> decimal degrees.
export function parseDecToDegrees(str) {
  return parseDmsToDecimal(str);
}

export function raDecToEciDir(raHours, decDeg) {
  const ra = raHours * HOUR;
  const dec = decDeg * DEG;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}

export function altAzToEnuDir(altDeg, azDeg) {
  const alt = altDeg * DEG;
  const az = azDeg * DEG;
  const ca = Math.cos(alt);
  return [Math.sin(az) * ca, Math.cos(az) * ca, Math.sin(alt)];
}

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export function geodeticToEcef(latDeg, lonDeg, elevM = 0) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return [
    (N + elevM) * cosLat * Math.cos(lon),
    (N + elevM) * cosLat * Math.sin(lon),
    (N * (1 - WGS84_E2) + elevM) * sinLat,
  ];
}

// Inverse of geodeticToEcef. Closed-form Bowring (1985) — converges to
// sub-millimeter latitude in a single pass for any earth-surface or
// LEO-altitude point. Returns degrees + meters above the WGS-84
// ellipsoid (height can be negative below sea level).
export function ecefToGeodetic(x, y, z) {
  const a = WGS84_A;
  const e2 = WGS84_E2;
  const b = a * Math.sqrt(1 - e2);
  const ep2 = (a * a - b * b) / (b * b);
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);
  const th = Math.atan2(z * a, p * b);
  const sinTh = Math.sin(th), cosTh = Math.cos(th);
  const lat = Math.atan2(
    z + ep2 * b * sinTh * sinTh * sinTh,
    p - e2 * a * cosTh * cosTh * cosTh,
  );
  const sinLat = Math.sin(lat);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const h = p / Math.cos(lat) - N;
  return { latDeg: lat / DEG, lonDeg: lon / DEG, elevM: h };
}

// GMST in radians via IAU 1982 model. Accurate to a few arc-seconds
// for ISS-altitude work -- well below amateur eyeball angular noise.
export function gmstFromDate(jsDate) {
  const jd = jsDate.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525.0;
  let gmstSec = 67310.54841
    + (876600 * 3600 + 8640184.812866) * T
    + 0.093104 * T * T
    - 6.2e-6 * T * T * T;
  gmstSec = ((gmstSec % 86400) + 86400) % 86400;
  return (gmstSec / 86400) * 2 * Math.PI;
}

// Rotate an ECI vector to ECEF via R_z(-GMST).
export function eciToEcefRotate(v, gmst) {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  return [c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2]];
}

// Rotate a local ENU vector at (lat, lon) into ECEF.
export function enuToEcefRotate(v, latDeg, lonDeg) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  const [e, n, u] = v;
  return [
    -sinLon * e - sinLat * cosLon * n + cosLat * cosLon * u,
     cosLon * e - sinLat * sinLon * n + cosLat * sinLon * u,
                  cosLat * n          + sinLat * u,
  ];
}
