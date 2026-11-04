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

/** Dot radius (CSS px) and opacity for a magnitude: Sirius about 2.4 px and
 *  full, a magnitude 6 star a dim 0.6 px dot that still shows. */
export function starStyle(mag) {
  return {
    r: Math.max(0.6, Math.min(2.4, 1.75 - 0.22 * mag)),
    alpha: Math.max(0.26, Math.min(1, 1.1 - 0.14 * mag)),
  };
}

/** Stars and planets brighter than this get a soft halo, as bright points
 *  do in a photograph: about the 20 brightest stars. */
export const GLOW_MAG = 1.0;

/** A point of light: a halo when bright, then the dot. */
function drawPoint(ctx, x, y, r, alpha, color, mag) {
  if (mag < GLOW_MAG) {
    // Brighter, wider: Sirius about 4x its dot, a magnitude 1 star 3x.
    const k = Math.min(1, (GLOW_MAG - mag) / 2.5);
    const R = r * (3 + k);
    const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, R);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.18 + 0.22 * k;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Draw projected stars (projectStars), faintest first so bright ones sit on top. */
export function drawStars(ctx, field, placed) {
  for (let k = placed.length - 1; k >= 0; k--) {
    const { i, x, y } = placed[k];
    const { r, alpha } = starStyle(field.mag[i]);
    drawPoint(ctx, x, y, r, alpha, field.color[i], field.mag[i]);
  }
  ctx.globalAlpha = 1;
}

/** The camera's Earth-fixed axes: forward to the Earth's centre, up and
 *  right on screen (north and east at the map's centre, turned by the
 *  bearing), and the focal length in CSS px. */
export function cameraAxes({ lonDeg, latDeg, bearingDeg = 0, fovDeg, height }) {
  const lat = latDeg * DEG, lon = lonDeg * DEG, brg = bearingDeg * DEG;
  const fwd = [-Math.cos(lat) * Math.cos(lon), -Math.cos(lat) * Math.sin(lon), -Math.sin(lat)];
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const cb = Math.cos(brg), sb = Math.sin(brg);
  const up = north.map((v, k) => cb * v + sb * east[k]);
  const right = east.map((v, k) => cb * v - sb * north[k]);
  const focal = height / 2 / Math.tan((fovDeg * DEG) / 2);
  return { fwd, up, right, focal };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Screen point (CSS px) of an Earth-fixed direction, or null behind the camera. */
function toScreen(d, axes, width, height) {
  const z = dot(d, axes.fwd);
  if (z <= 0) return null;
  return { x: width / 2 + (dot(d, axes.right) / z) * axes.focal, y: height / 2 - (dot(d, axes.up) / z) * axes.focal };
}

/**
 * Where each star lands on screen: [{ i, x, y }] in CSS px, for stars in
 * front of the camera and inside the frame (the globe, drawn over them,
 * hides those behind it).
 * @param {{ n: number, xyz: Float64Array }} field
 * @param {{ lonDeg: number, latDeg: number, bearingDeg?: number, fovDeg: number,
 *   width: number, height: number, gmstRad: number }} cam
 */
export function projectStars(field, cam) {
  const { width, height, gmstRad } = cam;
  const axes = cameraAxes(cam);
  const out = [];
  for (let i = 0; i < field.n; i++) {
    const d = eciToEcefRotate([field.xyz[i * 3], field.xyz[i * 3 + 1], field.xyz[i * 3 + 2]], gmstRad);
    const p = toScreen(d, axes, width, height);
    if (!p || p.x < -4 || p.y < -4 || p.x > width + 4 || p.y > height + 4) continue;
    out.push({ i, x: p.x, y: p.y });
  }
  return out;
}

const R_EARTH_KM = 6371;
const R_MOON_KM = 1737.4;
const SUN_RADIUS_RAD = 0.2666 * DEG;
/** The faintest planet drawn, matching the faintest star. */
export const PLANET_MAG_LIMIT = 6.0;

/**
 * The Sun, Moon and bright planets on screen, faintest first. The Sun and
 * planets are far enough to take as directions from the Earth's centre;
 * the Moon is not, so it is placed from the camera itself (camDistKm from
 * the Earth's centre, above the map's centre), which moves it a few
 * degrees against the stars, and sized from that distance. Its phase
 * comes from the angle Sun-Moon-camera, its lit limb turned toward the Sun.
 * @param {{ sunEcef: number[], moonEcef: number[], moonKm: number, camDistKm: number,
 *   planets: { name: string, dirEcef: number[], mag: number, color: string }[] }} sky
 * @param {{ lonDeg: number, latDeg: number, bearingDeg?: number, fovDeg: number,
 *   width: number, height: number }} cam
 */
export function skyBodies(sky, cam) {
  const { width, height } = cam;
  const axes = cameraAxes(cam);
  const inFrame = (p, r) => p && p.x > -r && p.y > -r && p.x < width + r && p.y < height + r;
  const out = [];

  for (const pl of sky.planets) {
    if (!(pl.mag <= PLANET_MAG_LIMIT)) continue;
    const p = toScreen(pl.dirEcef, axes, width, height);
    if (!inFrame(p, 4)) continue;
    const st = starStyle(pl.mag);
    out.push({ kind: 'planet', name: pl.name, x: p.x, y: p.y, r: st.r + 0.3, alpha: st.alpha, color: pl.color, mag: pl.mag });
  }

  const cam3 = axes.fwd.map((v) => -v * cam3Scale(sky.camDistKm));
  const rel = sky.moonEcef.map((v, k) => v * sky.moonKm - cam3[k]);
  const dist = Math.hypot(rel[0], rel[1], rel[2]);
  const mDir = rel.map((v) => v / dist);
  const mp = toScreen(mDir, axes, width, height);
  const mr = Math.asin(R_MOON_KM / dist) * axes.focal;
  if (inFrame(mp, mr * 3)) {
    const s = sky.sunEcef;
    const cosI = -dot(s, mDir); // angle at the Moon between the Sun and the camera
    const lit = (1 + cosI) / 2;
    const perp = s.map((v, k) => v - mDir[k] * dot(s, mDir));
    // Canvas angle (y down) of the lit limb, toward the Sun.
    const limb = Math.atan2(-dot(perp, axes.up), dot(perp, axes.right));
    out.push({ kind: 'moon', x: mp.x, y: mp.y, r: mr, lit, limb });
  }

  const sp = toScreen(sky.sunEcef, axes, width, height);
  const sr = SUN_RADIUS_RAD * axes.focal;
  if (inFrame(sp, sr * 8)) out.push({ kind: 'sun', x: sp.x, y: sp.y, r: sr });
  return out;
}

const cam3Scale = (km) => (Number.isFinite(km) && km > R_EARTH_KM ? km : 4 * R_EARTH_KM);

/** Camera distance from the Earth's centre in km, from MapLibre's globe
 *  transform: its distance to the map's centre plus the globe's radius,
 *  both in pixels. */
export function cameraDistanceKm(cameraToCenterPx, worldSizePx, latDeg) {
  const lat = Math.min(Math.abs(latDeg), 85.051129) * DEG;
  const globePx = worldSizePx / (2 * Math.PI) / Math.cos(lat);
  return R_EARTH_KM * (1 + cameraToCenterPx / globePx);
}

/** Draw the bodies from skyBodies on a 2D context (CSS px). */
export function drawBodies(ctx, bodies) {
  for (const b of bodies) {
    if (b.kind === 'planet') {
      drawPoint(ctx, b.x, b.y, b.r, b.alpha, b.color, b.mag);
    } else if (b.kind === 'moon') {
      const r = Math.max(b.r, 2);
      const glow = ctx.createRadialGradient(b.x, b.y, r, b.x, b.y, r * 3);
      glow.addColorStop(0, `rgba(236,230,216,${0.18 * b.lit})`);
      glow.addColorStop(1, 'rgba(236,230,216,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * 3, 0, Math.PI * 2);
      ctx.fill();
      // The dark side, faint (earthshine), then the lit part: the half
      // facing the Sun, with the terminator an ellipse of half-width
      // r(2·lit - 1), bulging into the dark half when gibbous.
      ctx.fillStyle = 'rgba(120,124,136,0.35)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.limb);
      const e = r * (2 * b.lit - 1);
      ctx.fillStyle = '#ece6d8';
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.ellipse(0, 0, Math.abs(e), r, 0, Math.PI / 2, -Math.PI / 2, e < 0);
      ctx.fill();
      ctx.restore();
    } else if (b.kind === 'sun') {
      const r = Math.max(b.r, 2.5);
      const glow = ctx.createRadialGradient(b.x, b.y, r * 0.8, b.x, b.y, r * 8);
      glow.addColorStop(0, 'rgba(255,244,214,0.75)');
      glow.addColorStop(0.25, 'rgba(255,236,190,0.22)');
      glow.addColorStop(1, 'rgba(255,236,190,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fffaf0';
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
