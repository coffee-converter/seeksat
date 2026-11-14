// lib/og/globe-card.mjs - The 1200x630 share image: a globe rising from the
// bottom, centred, with a satellite's ground track across it, an opened pass
// drawn bold (rise ring, set arrow, the visibility circle and the observer),
// and the title and two lines above. Everything that matters sits in the
// middle 630 x 630, so apps that crop previews to a square still show it.
// Land and lakes are Natural Earth (lib/og/earth-110m.mjs) on a true
// orthographic projection, so the far side is hidden, not drawn through.
import { geoCircle, geoDistance, geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from 'd3-geo';
import { LAKES, LAND } from './earth-110m.mjs';
import { wordmarkSvg } from './wordmark.mjs';
import { WORDMARK_PATHS } from './wordmark-paths.mjs';
import { COMPASS } from '../brand/marks.mjs';
import { SAT_PALETTE } from '../map/palette.mjs';

const W = 1200, H = 630;
const CX = 600, CY = 845, R = 580;
const SANS = "'Atkinson Hyperlegible Next', Helvetica, Arial, sans-serif";
const BRAND = "'Exo 2', 'Atkinson Hyperlegible Next', sans-serif";
const SEEK = '#aab8d4', SAT = '#7eb8ff', TEXT = '#e6ecf8', MUTED = '#93a3c4';
export const PASS_COLOR = SAT_PALETTE[0];
/** The dark edge under shared tracks and dots. */
const CASING = '#0e1428';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = (n) => Math.round(n * 10) / 10;
/** The mark (lib/brand/marks.mjs) at x, y (its top left), `size` px. */
function markSvg(x, y, size) {
  const inner = COMPASS.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<g transform="translate(${f1(x)} ${f1(y)}) scale(${f1(size / 64 * 1000) / 1000})">${inner}</g>`;
}
/** The wordmark's width at `size` px. */
const wordmarkWidth = (size, letterSpacing = 0) =>
  (WORDMARK_PATHS.width * size) / WORDMARK_PATHS.unitsPerEm + letterSpacing * (WORDMARK_PATHS.seek.length + WORDMARK_PATHS.sat.length - 1);
/** The mark and the wordmark side by side, centred on cx, baseline y. */
function lockupSvg(cx, y, size) {
  const markPx = size * 0.95, gap = size * 0.22;
  const total = markPx + gap + wordmarkWidth(size, 1);
  const left = cx - total / 2;
  return markSvg(left, y - size * 0.8, markPx)
    + wordmarkSvg({ x: left + markPx + gap, y, size, seekFill: SEEK, satFill: SAT, letterSpacing: 1 });
}
/** Rough advance widths, in ems, for the share card's faces: enough to fit
 *  text inside the square-safe middle without loading the fonts. */
function emWidth(text, brand) {
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') w += 0.26;
    else if (/[A-Z]/.test(ch)) w += brand ? 0.7 : 0.64;
    else if (/[a-z]/.test(ch)) w += brand ? 0.6 : 0.54;
    else if (/[0-9]/.test(ch)) w += brand ? 0.64 : 0.57;
    else if (/[.,:;'·()\-]/.test(ch)) w += 0.3;
    else w += 0.6;
  }
  return w;
}
/** Text inside the square-safe width: the largest size up to `max` that
 *  fits, no smaller than `min`, cut with an ellipsis if it still does not. */
const SAFE_WIDTH = 560;
function fit(text, max, min, brand) {
  let t = text;
  const sizeFor = (s) => Math.min(max, Math.floor(SAFE_WIDTH / Math.max(0.01, emWidth(s, brand))));
  while (sizeFor(t) < min && t.length > 4) t = `${t.slice(0, -2).trimEnd()}…`;
  return { text: t, size: Math.max(min, sizeFor(t)) };
}
/** Where the globe faces: the point at its centre, south of `lat` so that a
 *  place at `lat` sits in the upper, visible part of the rising globe. */
export function globeCentre(lonDeg, latDeg) {
  return { lonDeg, latDeg: Math.max(-89, Math.min(89, latDeg - 40)) };
}

/** Whether a point shows inside the card when the globe faces `centre`:
 *  on the near side of the Earth and above the card's bottom edge. */
export function onCard(centre, lonDeg, latDeg) {
  const proj = geoOrthographic().scale(R).translate([CX, CY]).rotate([-centre.lonDeg, -centre.latDeg]).clipAngle(90);
  if (geoDistance([lonDeg, latDeg], [centre.lonDeg, centre.latDeg]) >= Math.PI / 2 - 0.01) return false;
  const [x, y] = proj([lonDeg, latDeg]);
  return x > 20 && x < W - 20 && y > 260 && y < H - 20;
}

/** Pseudo-random stars, the same every time, outside the globe. */
function stars() {
  let s = 11;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out = [];
  for (let i = 0; i < 170; i++) {
    const x = r() * W, y = r() * H, m = r();
    if (Math.hypot(x - CX, y - CY) < R + 8) continue;
    out.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${(0.5 + m * 1.4).toFixed(2)}" fill="#dbe6ff" opacity="${(0.2 + m * 0.6).toFixed(2)}"/>`);
  }
  return out.join('');
}

/**
 * The share image as SVG.
 * @param {object} o
 * @param {{ lonDeg: number, latDeg: number }} o.centre   where the globe faces (globeCentre)
 * @param {[number, number][]} [o.ground]  the ground track, [lon, lat] points
 * @param {[number, number][]} [o.pass]    the opened pass, drawn bold with a rise ring and set arrow
 * @param {{ lonDeg: number, latDeg: number, radiusDeg: number }} [o.circle] where the pass can be seen
 * @param {{ lonDeg: number, latDeg: number }} [o.observer]
 * @param {{ lonDeg: number, latDeg: number }} [o.sat]    the satellite's dot
 * @param {boolean} [o.sight]  a dashed line from the observer to the satellite (closest approach)
 * @param {boolean} [o.dashed]  ground is the way to a fixed satellite, drawn dotted
 * @param {{ ground: [number, number][], sat?: { lonDeg: number, latDeg: number }, color: string }[]} [o.tracks]
 *   more satellites (a shared map), each with its track and dot in its colour
 * @param {string} [o.color]  the track's colour
 * @param {string|null} [o.titleColor]  the title's colour (the track's by default)
 * @param {string|null} [o.title]  a satellite's name; null for the SeekSat wordmark
 * @param {string[]} [o.lines]  up to three lines under the title, each smaller
 */
export function buildGlobeCardSvg({ centre, ground = null, pass = null, circle = null, observer = null, sat = null, sight = false, dashed = false, tracks = [], color = PASS_COLOR, titleColor = null, title = null, lines = [] }) {
  const proj = geoOrthographic().scale(R).translate([CX, CY]).rotate([-centre.lonDeg, -centre.latDeg]).clipAngle(90).precision(0.3);
  const path = geoPath(proj);
  const p = (geo) => path(geo) ?? '';
  const facing = [centre.lonDeg, centre.latDeg];
  const seen = (lon, lat) => geoDistance([lon, lat], facing) < Math.PI / 2 - 0.01;
  const line = (coords) => p({ type: 'LineString', coordinates: coords });

  const parts = [];
  // Each shared track on a dark casing, as the map draws them, so every
  // palette colour keeps 3:1 over the globe's land (lib/map/palette.mjs).
  for (const t of tracks) {
    if (t.ground?.length > 1) {
      const d = line(t.ground);
      parts.push(`<path d="${d}" fill="none" stroke="${CASING}" stroke-width="6.5" stroke-opacity="0.85" stroke-linecap="round"/>`);
      parts.push(`<path d="${d}" fill="none" stroke="${t.color}" stroke-width="3" stroke-opacity="0.9" stroke-linecap="round"/>`);
    }
  }
  for (const t of tracks) {
    if (t.sat && seen(t.sat.lonDeg, t.sat.latDeg)) {
      const [x, y] = proj([t.sat.lonDeg, t.sat.latDeg]);
      parts.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="9" fill="${t.color}" stroke="${CASING}" stroke-width="3.5"/>`);
    }
  }
  if (circle) {
    const c = geoCircle().center([circle.lonDeg, circle.latDeg]).radius(circle.radiusDeg).precision(1)();
    parts.push(`<path d="${p(c)}" fill="#9cc3ff" fill-opacity="0.06" stroke="#9cc3ff" stroke-width="3" stroke-dasharray="11 9" stroke-opacity="0.85"/>`);
  }
  if (ground?.length > 1) {
    // Dashed: the way to a satellite that stays put, rather than a track.
    const dash = dashed ? ' stroke-dasharray="2 12" stroke-width="5"' : ' stroke-width="3"';
    parts.push(`<path d="${line(ground)}" fill="none" stroke="${color}"${dash} stroke-opacity="0.8" stroke-linecap="round"/>`);
  }
  if (pass?.length > 1) {
    parts.push(`<path d="${line(pass)}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"/>`);
    const [rl, ra] = pass[0];
    if (seen(rl, ra)) {
      const [x, y] = proj([rl, ra]);
      parts.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="9" fill="#16264f" stroke="${color}" stroke-width="5"/>`);
    }
    // The set arrow points the way the path runs, on screen.
    const end = pass[pass.length - 1];
    const before = pass[Math.max(0, pass.length - 4)];
    if (seen(end[0], end[1]) && seen(before[0], before[1])) {
      const [bx, by] = proj(end);
      const [ax, ay] = proj(before);
      const ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      parts.push(`<g transform="translate(${f1(bx)} ${f1(by)}) rotate(${f1(ang)})"><path d="M14 0 L-10 -11 L-10 11 Z" fill="${color}"/></g>`);
    }
  }
  if (sight && observer && sat) {
    // The way to it at closest approach, as the map's distance line draws it.
    const at = geoInterpolate([observer.lonDeg, observer.latDeg], [sat.lonDeg, sat.latDeg]);
    const way = Array.from({ length: 25 }, (_, i) => at(i / 24));
    parts.push(`<path d="${line(way)}" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="9 8" stroke-opacity="0.9"/>`);
  }
  if (sat && seen(sat.lonDeg, sat.latDeg)) {
    const [x, y] = proj([sat.lonDeg, sat.latDeg]);
    parts.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="11" fill="#ffe2c7" stroke="#16264f" stroke-width="4"/>`);
  }
  if (observer && seen(observer.lonDeg, observer.latDeg)) {
    const [x, y] = proj([observer.lonDeg, observer.latDeg]).map(f1);
    parts.push(`<g stroke="#cfe0ff" stroke-width="3.5" fill="none"><circle cx="${x}" cy="${y}" r="11"/><path d="M${x} ${f1(y - 20)}v10M${x} ${f1(y + 10)}v10M${f1(x - 20)} ${y}h10M${f1(x + 10)} ${y}h10"/></g>`);
  }

  // Three lines: the block moves up so the last stays off the globe.
  const lift = lines.length > 2 ? 22 : 0;
  const head = title == null
    ? lockupSvg(CX, 140 - lift, 104)
    : (() => {
      const t = fit(title, 100, 44, true);
      // A title that starts with the name takes the wordmark's two tones
      // ("SeekSat MCP"); the rest is in titleColor.
      const brand = /^SeekSat(?=\s|$)/.test(t.text);
      const body = brand
        ? `<tspan fill="${SEEK}">Seek</tspan><tspan fill="${SAT}">Sat</tspan>${esc(t.text.slice(7))}`
        : esc(t.text);
      return `${lockupSvg(118, 58, 30)}<text data-title="1" x="${CX}" y="${140 - lift}" text-anchor="middle" font-family="${BRAND}" font-weight="600" font-size="${t.size}" fill="${titleColor ?? color}">${body}</text>`;
    })();
  const top = 196 - lift;
  const SIZE = [34, 26, 22];
  const text = lines.slice(0, 3).map((l, i) => {
    const t = fit(l, SIZE[i], 18, false);
    return `<text x="${CX}" y="${top + [0, 40, 76][i]}" text-anchor="middle" font-family="${SANS}" font-size="${t.size}" fill="${i === 0 ? TEXT : MUTED}">${esc(t.text)}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#060912"/><stop offset="1" stop-color="#0d1328"/></linearGradient>
    <radialGradient id="ocean" cx="${CX - R * 0.35}" cy="${CY - R * 0.45}" r="${R * 1.4}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#22386c"/><stop offset="0.55" stop-color="#16264f"/><stop offset="1" stop-color="#0b1430"/></radialGradient>
    <radialGradient id="shade" cx="${CX + R * 0.5}" cy="${CY + R * 0.5}" r="${R * 1.3}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="0.6" stop-color="#000" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${stars()}
  <circle cx="${CX}" cy="${CY}" r="${R + 7}" fill="#7eb8ff" opacity="0.10"/>
  <path d="${p({ type: 'Sphere' })}" fill="url(#ocean)"/>
  <path d="${p(geoGraticule10())}" fill="none" stroke="#7eb8ff" stroke-opacity="0.13" stroke-width="1.4"/>
  <path d="${p(LAND)}" fill="#3a5288" stroke="#5f7cb8" stroke-width="1.2" stroke-opacity="0.6"/>
  <path d="${p(LAKES)}" fill="#1b2d5c" stroke="#5f7cb8" stroke-width="0.8" stroke-opacity="0.5"/>
  <path d="${p({ type: 'Sphere' })}" fill="url(#shade)"/>
  ${parts.join('\n  ')}
  ${head}
  ${text}
</svg>`;
}
