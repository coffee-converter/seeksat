// lib/map/stars.mjs - the star field behind the globe: each catalogue star
// (lib/map/star-data.mjs) at its true direction for the map's camera and the
// moment, sized and dimmed by magnitude and coloured by temperature.
//
// The stars are at infinity, so where one lands on screen depends only on
// which way the camera looks, not how far out it is. With pitch locked at 0
// the globe's camera sits straight above the map's centre, looking down at
// the Earth's centre, north up (turned by the bearing); MapLibre draws it in
// perspective with its vertical field of view. Positions are J2000; the
// quarter degree of precession since is far below a dot's size here.

import { eciToEcefRotate } from '../coords.js';

const DEG = Math.PI / 180;

/** Unit vectors (J2000 equatorial), magnitudes and colours for packed star
 *  data: [raHours x 1000, decDeg x 100, mag x 100, bv x 100, ...]. */
export function starField(packed) {
  const n = packed.length / 4;
  const xyz = new Float64Array(n * 3);
  const mag = new Float32Array(n);
  const color = new Array(n);
  for (let i = 0; i < n; i++) {
    const ra = (packed[i * 4] / 1000) * 15 * DEG;
    const dec = (packed[i * 4 + 1] / 100) * DEG;
    xyz[i * 3] = Math.cos(dec) * Math.cos(ra);
    xyz[i * 3 + 1] = Math.cos(dec) * Math.sin(ra);
    xyz[i * 3 + 2] = Math.sin(dec);
    mag[i] = packed[i * 4 + 2] / 100;
    color[i] = rgbCss(bvToRgb(packed[i * 4 + 3] / 100));
  }
  return { n, xyz, mag, color };
}

/** Surface temperature (K) from the B-V colour index (Ballesteros 2012). */
export function bvToKelvin(bv) {
  const b = Math.max(-0.4, Math.min(2, bv));
  return 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
}

/** A star's colour as the eye sees it: the blackbody colour at its
 *  temperature (Tanner Helland's fit to Mitchell Charity's table), then
 *  eased halfway to white, since stars look pale, not saturated. [r, g, b]. */
export function bvToRgb(bv) {
  const t = bvToKelvin(bv) / 100;
  const clamp = (x) => Math.max(0, Math.min(255, x));
  const r = t <= 66 ? 255 : clamp(329.698727446 * (t - 60) ** -0.1332047592);
  const g = t <= 66 ? clamp(99.4708025861 * Math.log(t) - 161.1195681661) : clamp(288.1221695283 * (t - 60) ** -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  const pale = (c) => Math.round(c + (255 - c) * 0.5);
  return [pale(r), pale(g), pale(b)];
}

const rgbCss = ([r, g, b]) => `rgb(${r},${g},${b})`;

/** Dot radius (CSS px) and opacity for a magnitude: Sirius about 2.3 px and
 *  full, a magnitude 5.5 star a dim 0.65 px dot that still shows. */
export function starStyle(mag) {
  return {
    r: Math.max(0.65, Math.min(2.4, 1.75 - 0.22 * mag)),
    alpha: Math.max(0.32, Math.min(1, 1.1 - 0.14 * mag)),
  };
}

/**
 * Where each star lands on screen: [{ i, x, y }] in CSS px, for stars in
 * front of the camera and inside the frame (the globe, drawn over them,
 * hides those behind it).
 * @param {{ n: number, xyz: Float64Array }} field
 * @param {{ lonDeg: number, latDeg: number, bearingDeg?: number, fovDeg: number,
 *   width: number, height: number, gmstRad: number }} cam
 */
export function projectStars(field, { lonDeg, latDeg, bearingDeg = 0, fovDeg, width, height, gmstRad }) {
  const lat = latDeg * DEG, lon = lonDeg * DEG, brg = bearingDeg * DEG;
  // Earth-fixed camera axes: forward to the Earth's centre, north and east
  // at the map's centre, turned by the bearing.
  const fwd = [-Math.cos(lat) * Math.cos(lon), -Math.cos(lat) * Math.sin(lon), -Math.sin(lat)];
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const cb = Math.cos(brg), sb = Math.sin(brg);
  const up = north.map((v, k) => cb * v + sb * east[k]);
  const right = east.map((v, k) => cb * v - sb * north[k]);
  const focal = height / 2 / Math.tan((fovDeg * DEG) / 2);
  const out = [];
  for (let i = 0; i < field.n; i++) {
    const d = eciToEcefRotate([field.xyz[i * 3], field.xyz[i * 3 + 1], field.xyz[i * 3 + 2]], gmstRad);
    const z = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
    if (z <= 0) continue;
    const x = width / 2 + ((d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / z) * focal;
    const y = height / 2 - ((d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / z) * focal;
    if (x < -4 || y < -4 || x > width + 4 || y > height + 4) continue;
    out.push({ i, x, y });
  }
  return out;
}
