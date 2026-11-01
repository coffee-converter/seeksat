// lib/map/labels.mjs - pure label picking for the flat map: edge coordinates,
// plus city and region names that fit the view without overlapping.
// Places and regions come in as parameters so the data can load lazily.
import { isVisible } from './visible.mjs';
import { NAME_GAP_PX, OBSERVER_HALF_PX, dotRadius, nameFlips } from './marks.mjs';

export const CHAR_PX = 6.2;
/** Region names draw in 11 px capitals with 1.5 px letter spacing (draw.mjs).
 *  Capitals run wider than CHAR_PX: measured in Chrome, 8.0 to 8.6 px a letter
 *  with the spacing, so 7.2 + 1.5 covers them and the halo. */
export const REGION_CHAR_PX = 7.2;
export const REGION_SPACING_PX = 1.5;
const REGION_PAD_PX = 4;
export const LABEL_PX = 12;
const DOT_PX = 4;
const NUDGE_PX = 4;
const INSET_PX = 2;
const GUARANTEE_DY_PX = 24;
const DEG = Math.PI / 180;

export function graticuleStep(zoom, width = Infinity) {
  const step = zoom < 2 ? 30 : zoom < 4 ? 15 : zoom < 6 ? 10 : 5;
  // Narrow maps get a sparser grid so labels do not crowd.
  return width < 500 ? Math.max(step, 60) : step;
}

export function formatLat(deg) {
  const d = Math.round(Math.abs(deg));
  if (d === 0) return '0°';
  return `${d}°${deg > 0 ? 'N' : 'S'}`;
}

export function formatLon(deg) {
  let d = Math.round(deg) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  if (d === 0) return '0°';
  if (d === 180) return '180°';
  return `${Math.abs(d)}°${d > 0 ? 'E' : 'W'}`;
}

function textWidth(text) {
  return text.length * CHAR_PX;
}

function overlaps(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function fitsCanvas(b, width, height) {
  return b.x0 >= 0 && b.y0 >= 0 && b.x1 <= width && b.y1 <= height;
}

function hitsAny(box, boxes) {
  for (const b of boxes) if (overlaps(box, b)) return true;
  return false;
}

/** Box of a graticule label from its text anchor, align and baseline. */
export function graticuleBox({ text, x, y, align, baseline }) {
  const w = textWidth(text);
  const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  const y0 = baseline === 'top' ? y : baseline === 'bottom' ? y - LABEL_PX : y - LABEL_PX / 2;
  return { x0, y0, x1: x0 + w, y1: y0 + LABEL_PX };
}

/**
 * Box of a place label. Regions centre on (x, y). Cities have a dot at (x, y)
 * with the text to its right (align 'left') or left (align 'right').
 */
export function placeBox({ text, x, y, align }) {
  const y0 = y - LABEL_PX / 2;
  const y1 = y + LABEL_PX / 2;
  if (align === 'center') {
    const w = text.length * (REGION_CHAR_PX + REGION_SPACING_PX) + REGION_PAD_PX;
    return { x0: x - w / 2, y0, x1: x + w / 2, y1 };
  }
  const w = DOT_PX + textWidth(text);
  const half = DOT_PX / 2;
  return align === 'right'
    ? { x0: x + half - w, y0, x1: x + half, y1 }
    : { x0: x - half, y0, x1: x - half + w, y1 };
}

/** Projected [x, y] of a visible [lon, lat] that lands on the canvas, else null. */
function onCanvas(projection, lonLat, width, height) {
  const p = projection(lonLat);
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  if (p[0] < 0 || p[1] < 0 || p[0] > width || p[1] > height) return null;
  return isVisible(projection, lonLat) ? p : null;
}

/** Shift a label so its box sits inside the canvas. */
function clampInside(label, width, height) {
  const b = graticuleBox(label);
  let dx = 0;
  let dy = 0;
  // The 1e-6 margin keeps float rounding from leaving the box a hair outside.
  if (b.x0 < 0) dx = 1e-6 - b.x0;
  else if (b.x1 > width) dx = width - b.x1 - 1e-6;
  if (b.y0 < 0) dy = 1e-6 - b.y0;
  else if (b.y1 > height) dy = height - b.y1 - 1e-6;
  return { ...label, x: label.x + dx, y: label.y + dy };
}

const RIM_PROJECTIONS = new Set(['polar-north', 'polar-south', 'satellite']);
const POLAR_PROJECTIONS = new Set(['polar-north', 'polar-south']);

function parallelLats(step) {
  const out = [];
  for (let lat = -90 + step; lat < 90; lat += step) out.push(lat);
  return out;
}

// -180 only, so 180° appears once.
function meridianLons(step) {
  const out = [];
  for (let lon = -180; lon < 180; lon += step) out.push(lon);
  return out;
}

function parallelSamples(projection, lat, width, height) {
  const pts = [];
  for (let lon = -180; lon <= 180; lon += 1) {
    const p = onCanvas(projection, [lon, lat], width, height);
    if (p) pts.push(p);
  }
  return pts;
}

function meridianSamples(projection, lon, width, height) {
  const pts = [];
  for (let lat = -85; lat <= 85; lat += 1) {
    const p = onCanvas(projection, [lon, lat], width, height);
    if (p) pts.push(p);
  }
  return pts;
}

/**
 * Flat maps: parallels at their leftmost point, meridians at their lowest.
 * Points on the canvas are pulled into a 2 px inset, so lines that meet the
 * very edge (like 180° on the lat/lon grid) still get a label.
 */
function edgeCandidates(projection, { width, height, step }) {
  const clamp = (p) => [Math.min(width - INSET_PX, Math.max(INSET_PX, p[0])), Math.min(height - INSET_PX, Math.max(INSET_PX, p[1]))];
  const out = [];
  for (const lat of parallelLats(step)) {
    const pts = parallelSamples(projection, lat, width, height);
    if (!pts.length) continue;
    const best = clamp(pts.reduce((a, b) => (b[0] < a[0] ? b : a)));
    out.push({ text: formatLat(lat), x: best[0] + NUDGE_PX, y: best[1], align: 'left', baseline: 'middle', line: 'parallel' });
  }
  for (const lon of meridianLons(step)) {
    const pts = meridianSamples(projection, lon, width, height);
    if (!pts.length) continue;
    const best = clamp(pts.reduce((a, b) => (b[1] > a[1] ? b : a)));
    out.push({ text: formatLon(lon), x: best[0], y: best[1] - NUDGE_PX, align: 'center', baseline: 'bottom', line: 'meridian' });
  }
  return out;
}

/** A label at p nudged 4 px toward c, aligned so its text runs inward. */
function rimLabel(p, c, text, line) {
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  const len = Math.hypot(dx, dy);
  const ux = len > 1e-9 ? dx / len : 0;
  const uy = len > 1e-9 ? dy / len : 0;
  return {
    text,
    x: p[0] - ux * NUDGE_PX,
    y: p[1] - uy * NUDGE_PX,
    align: ux > 0.35 ? 'right' : ux < -0.35 ? 'left' : 'center',
    baseline: uy > 0.35 ? 'bottom' : uy < -0.35 ? 'top' : 'middle',
    line,
  };
}

/** Of the samples farthest from c (within 1 px), the one `better` prefers. */
function rimPoint(pts, c, better) {
  let dMax = -Infinity;
  const ds = pts.map((p) => {
    const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
    if (d > dMax) dMax = d;
    return d;
  });
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    if (ds[i] >= dMax - 1 && (!best || better(pts[i], best))) best = pts[i];
  }
  return best;
}

/** Round maps (polar, satellite): labels on the disc rim, measured from the view centre. */
function rimCandidates(projection, { width, height, step, projectionId }) {
  const [rl, rp] = projection.rotate();
  const c = projection([-rl, -rp]);
  if (!c) return edgeCandidates(projection, { width, height, step });
  const out = [];
  for (const lat of parallelLats(step)) {
    // Polar parallels are circles round c, so every sample ties. Put them on
    // a spoke between meridians so the text is not on the 90°W line.
    let p = POLAR_PROJECTIONS.has(projectionId) ? onCanvas(projection, [-90 - step / 2, lat], width, height) : null;
    if (!p) {
      const pts = parallelSamples(projection, lat, width, height);
      if (pts.length) p = rimPoint(pts, c, (a, b) => a[0] < b[0]);
    }
    if (p) out.push(rimLabel(p, c, formatLat(lat), 'parallel'));
  }
  for (const lon of meridianLons(step)) {
    const pts = meridianSamples(projection, lon, width, height);
    const p = pts.length ? rimPoint(pts, c, (a, b) => a[1] > b[1]) : null;
    if (p) out.push(rimLabel(p, c, formatLon(lon), 'meridian'));
  }
  return out;
}

/** Centered on you: meridians where they cross the equator, parallels on your meridian. */
function crossingCandidates(projection, { width, height, step }) {
  const obsLon = -projection.rotate()[0];
  const out = [];
  for (const lat of parallelLats(step)) {
    const p = onCanvas(projection, [obsLon, lat], width, height);
    if (p) out.push({ text: formatLat(lat), x: p[0] + NUDGE_PX, y: p[1], align: 'left', baseline: 'middle', line: 'parallel' });
  }
  for (const lon of meridianLons(step)) {
    const p = onCanvas(projection, [lon, 0], width, height);
    if (p) out.push({ text: formatLon(lon), x: p[0], y: p[1] - NUDGE_PX, align: 'center', baseline: 'bottom', line: 'meridian' });
  }
  return out;
}

/**
 * Lat/lon labels that fit the view. `projectionId` picks the placement rule:
 * the disc rim for polar and satellite views, line crossings for the
 * azimuthal view, and the left and bottom edges otherwise.
 */
export function graticuleLabels(projection, { width, height, step, projectionId = null, avoid = [] }) {
  const opts = { width, height, step, projectionId };
  const candidates = RIM_PROJECTIONS.has(projectionId ?? '')
    ? rimCandidates(projection, opts)
    : projectionId === 'azimuthal'
      ? crossingCandidates(projection, opts)
      : edgeCandidates(projection, opts);

  const out = [];
  // Boxes already taken, such as map controls laid over the canvas.
  const boxes = avoid.slice();
  for (const c of candidates) {
    const label = clampInside(c, width, height);
    const box = graticuleBox(label);
    if (hitsAny(box, boxes)) continue;
    boxes.push(box);
    out.push(label);
  }
  return out;
}

function haversine([lon1, lat1], [lon2, lat2]) {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** A region name for the view's centre: nearest region point, else the first visible one. */
function fallbackRegion(projection, { width, height, regions }) {
  const c = projection.invert ? projection.invert([width / 2, height / 2]) : null;
  if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
    let best = null;
    let bestD = Infinity;
    for (const r of regions) {
      for (const pt of r.points) {
        const d = haversine(c, pt);
        if (d < bestD) {
          bestD = d;
          best = r;
        }
      }
    }
    return best;
  }
  for (const r of regions) {
    if (r.points.some((pt) => isVisible(projection, pt))) return r;
  }
  return null;
}

/**
 * Boxes of the satellite dots and names at their current positions, so place
 * labels can keep clear of them. Hidden satellites draw nothing; ghosts are
 * a dot only.
 */
export function satBoxes(projection, sats, width) {
  const out = [];
  for (const s of sats ?? []) {
    const emphasis = s.emphasis ?? (s.selected ? 'focus' : 'normal');
    if (emphasis === 'hidden' || !s.position) continue;
    const lonLat = [s.position.lonDeg, s.position.latDeg];
    const p = projection(lonLat);
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !isVisible(projection, lonLat)) continue;
    const r = dotRadius(emphasis);
    out.push({ x0: p[0] - r, y0: p[1] - r, x1: p[0] + r, y1: p[1] + r });
    if (emphasis === 'ghost' || !s.name) continue;
    const w = textWidth(s.name);
    const flip = nameFlips(p[0], width);
    const x = flip ? p[0] - (r + NAME_GAP_PX) : p[0] + r + NAME_GAP_PX;
    out.push({ x0: flip ? x - w : x, y0: p[1] - LABEL_PX / 2, x1: flip ? x : x + w, y1: p[1] + LABEL_PX / 2 });
  }
  return out;
}

/** The observer crosshair's box, when it is on the map; else null. */
export function observerBox(projection, observer) {
  if (!observer) return null;
  const lonLat = [observer.lonDeg, observer.latDeg];
  const p = projection(lonLat);
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !isVisible(projection, lonLat)) return null;
  return { x0: p[0] - OBSERVER_HALF_PX, y0: p[1] - OBSERVER_HALF_PX, x1: p[0] + OBSERVER_HALF_PX, y1: p[1] + OBSERVER_HALF_PX };
}

/** Seas name the view only when there is room: zoomed in, or a canvas of 600 x 400 or more. */
export function seasAllowed(width, height, zoom = 1) {
  return zoom >= 2 || width * height >= 600 * 400;
}

/** At most this many region names: one per 60,000 px of canvas, never fewer than 2. */
export function maxRegionLabels(width, height) {
  return Math.max(2, Math.round((width * height) / 60000));
}

/**
 * City and region labels that fit the view. Regions first (best rank first,
 * one point each, seas only with room, capped by canvas area), then cities in
 * file order up to a budget set by canvas area and zoom. `avoid` holds boxes
 * already taken (lat/lon labels, satellite dots and names). Never empty when
 * any region can name the view.
 */
export function pickPlaceLabels(projection, { width, height, zoom = 1, places, regions, avoid = [] }) {
  const maxCities = Math.min(60, Math.max(3, Math.round(((width * height) / 9000) * Math.min(zoom, 4) / 2)));
  const maxRank = 2 + 2 * Math.log2(zoom);
  const seas = seasAllowed(width, height, zoom);
  const maxRegions = maxRegionLabels(width, height);
  const out = [];
  // Boxes already taken, such as the lat/lon labels.
  const boxes = avoid.slice();
  const accept = (label) => {
    const box = placeBox(label);
    if (!fitsCanvas(box, width, height) || hitsAny(box, boxes)) return false;
    boxes.push(box);
    out.push(label);
    return true;
  };

  const ranked = regions.map((r, i) => ({ r, i })).sort((a, b) => a.r.rank - b.r.rank || a.i - b.i);
  let regionCount = 0;
  for (const { r } of ranked) {
    if (regionCount >= maxRegions) break;
    if (r.kind === 'sea' && !seas) continue;
    for (const pt of r.points) {
      const p = onCanvas(projection, pt, width, height);
      if (p && accept({ text: r.name, x: p[0], y: p[1], kind: 'region', align: 'center' })) {
        regionCount++;
        break;
      }
    }
  }

  let cities = 0;
  for (const [name, lat, lon, rank] of places) {
    if (cities >= maxCities) break;
    if (rank > maxRank) continue;
    const p = onCanvas(projection, [lon, lat], width, height);
    if (!p) continue;
    const right = { text: name, x: p[0], y: p[1], kind: 'city', align: 'left' };
    const flip = placeBox(right).x1 > width;
    if (accept(flip ? { ...right, align: 'right' } : right)) cities++;
  }

  if (out.length === 0) {
    const r = fallbackRegion(projection, { width, height, regions });
    // Below centre, clear of the satellite dot in the satellite view.
    if (r) out.push({ text: r.name, x: width / 2, y: height / 2 + GUARANTEE_DY_PX, kind: 'region', align: 'center' });
  }
  return out;
}
