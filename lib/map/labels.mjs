// lib/map/labels.mjs - pure label picking for the flat map: edge coordinates,
// plus city and region names that fit the view without overlapping.
// Places and regions come in as parameters so the data can load lazily.
import { isVisible } from './draw.mjs';

export const CHAR_PX = 6.2;
export const LABEL_PX = 12;
const DOT_PX = 4;
const NUDGE_PX = 4;
const INSET_PX = 2;
const DEG = Math.PI / 180;

export function graticuleStep(zoom) {
  if (zoom < 2) return 30;
  if (zoom < 4) return 15;
  if (zoom < 6) return 10;
  return 5;
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
    const w = textWidth(text);
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
  if (b.x0 < 0) dx = -b.x0;
  else if (b.x1 > width) dx = width - b.x1;
  if (b.y0 < 0) dy = -b.y0;
  else if (b.y1 > height) dy = height - b.y1;
  return { ...label, x: label.x + dx, y: label.y + dy };
}

/**
 * Lat/lon labels on the map edge or disc rim. Points on the canvas are pulled
 * into a 2 px inset, so lines that meet the very edge (like 180° on the
 * lat/lon grid) still get a label.
 */
export function graticuleLabels(projection, { width, height, step }) {
  const lo = INSET_PX;
  const hiX = width - INSET_PX;
  const hiY = height - INSET_PX;
  const sample = (lonLat) => {
    const p = onCanvas(projection, lonLat, width, height);
    if (!p) return null;
    return [Math.min(hiX, Math.max(lo, p[0])), Math.min(hiY, Math.max(lo, p[1]))];
  };

  const candidates = [];
  for (let lat = -90 + step; lat < 90; lat += step) {
    let best = null;
    for (let lon = -180; lon <= 180; lon += 1) {
      const p = sample([lon, lat]);
      if (p && (!best || p[0] < best[0])) best = p;
    }
    if (best) candidates.push({ text: formatLat(lat), x: best[0] + NUDGE_PX, y: best[1], align: 'left', baseline: 'middle' });
  }
  // -180 only, so 180° appears once.
  for (let lon = -180; lon < 180; lon += step) {
    let best = null;
    for (let lat = -85; lat <= 85; lat += 1) {
      const p = sample([lon, lat]);
      if (p && (!best || p[1] > best[1])) best = p;
    }
    if (best) candidates.push({ text: formatLon(lon), x: best[0], y: best[1] - NUDGE_PX, align: 'center', baseline: 'bottom' });
  }

  const out = [];
  const boxes = [];
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
 * City and region labels that fit the view. Regions first (best rank first,
 * one point each), then cities in file order up to a budget set by canvas
 * area and zoom. Never empty when any region can name the view.
 */
export function pickPlaceLabels(projection, { width, height, zoom = 1, places, regions }) {
  const maxCities = Math.min(60, Math.max(3, Math.round(((width * height) / 9000) * Math.min(zoom, 4) / 2)));
  const maxRank = 2 + 2 * Math.log2(zoom);
  const out = [];
  const boxes = [];
  const accept = (label) => {
    const box = placeBox(label);
    if (!fitsCanvas(box, width, height) || hitsAny(box, boxes)) return false;
    boxes.push(box);
    out.push(label);
    return true;
  };

  const ranked = regions.map((r, i) => ({ r, i })).sort((a, b) => a.r.rank - b.r.rank || a.i - b.i);
  for (const { r } of ranked) {
    for (const pt of r.points) {
      const p = onCanvas(projection, pt, width, height);
      if (p && accept({ text: r.name, x: p[0], y: p[1], kind: 'region', align: 'center' })) break;
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
    if (r) out.push({ text: r.name, x: width / 2, y: height / 2, kind: 'region', align: 'center' });
  }
  return out;
}
