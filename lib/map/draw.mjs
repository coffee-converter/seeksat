// lib/map/draw.mjs - pure canvas drawing and hit-testing for the flat map.
import { geoPath, geoGraticule } from 'd3-geo';
import { graticuleStep } from './labels.mjs';

export const MAP_COLORS = {
  ocean: '#0f1830',
  land: '#1b2845',
  landStroke: '#2c3e63',
  graticule: 'rgba(126, 184, 255, 0.14)',
  // Drawn once per band, so deeper night stacks darker.
  night: 'rgba(3, 5, 12, 0.24)',
  observer: '#7eb8ff',
};

export const SAT_PALETTE = ['#ff9b54', '#7fe5d1', '#c084fc', '#facc15', '#f87171', '#34d399', '#a78bfa', '#fb923c'];

const SPHERE = { type: 'Sphere' };
const graticuleCache = new Map();
function graticuleFor(step) {
  if (!graticuleCache.has(step)) graticuleCache.set(step, geoGraticule().step([step, step])());
  return graticuleCache.get(step);
}
const LABEL_COLOR = 'rgba(207, 224, 255, 0.55)';
const REGION_COLOR = 'rgba(207, 224, 255, 0.35)';
const CITY_COLOR = 'rgba(207, 224, 255, 0.75)';
const FONT_FAMILY = 'system-ui, -apple-system, sans-serif';
const FUTURE_CHUNKS = 8;
const FUTURE_ALPHA_END = 0.25;
const DOT_RADIUS = 4;
const RING_WIDTH = 2;
const LABEL_FONT = '600 11px system-ui, -apple-system, sans-serif';

/**
 * Whether [lon, lat] survives the projection's clip. Calling projection()
 * directly skips d3's clipping, so far-side points would land inside the disc.
 */
export function isVisible(projection, lonLat) {
  return geoPath(projection)({ type: 'Point', coordinates: lonLat }) != null;
}

/** Projected [x, y] of a visible point, else null. */
function visiblePoint(projection, lonDeg, latDeg) {
  return isVisible(projection, [lonDeg, latDeg]) ? projection([lonDeg, latDeg]) : null;
}

function fillPath(ctx, path, obj, style) {
  ctx.beginPath();
  path(obj);
  ctx.fillStyle = style;
  ctx.fill();
}

function strokePath(ctx, path, obj, style, width) {
  ctx.beginPath();
  path(obj);
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.stroke();
}

function haloText(ctx, text, x, y, fill) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = MAP_COLORS.ocean;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawLabels(ctx, labels) {
  ctx.lineJoin = 'round';
  ctx.font = `10px ${FONT_FAMILY}`;
  for (const g of labels.graticule ?? []) {
    ctx.textAlign = g.align;
    ctx.textBaseline = g.baseline;
    haloText(ctx, g.text, g.x, g.y, LABEL_COLOR);
  }
  const places = labels.places ?? [];
  ctx.font = `11px ${FONT_FAMILY}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.letterSpacing = '1.5px';
  for (const r of places) {
    if (r.kind !== 'region') continue;
    haloText(ctx, r.text.toUpperCase(), r.x, r.y, REGION_COLOR);
  }
  ctx.letterSpacing = '0px';
  for (const c of places) {
    if (c.kind !== 'city') continue;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = CITY_COLOR;
    ctx.fill();
    const right = c.align === 'right';
    ctx.textAlign = right ? 'right' : 'left';
    haloText(ctx, c.text, c.x + (right ? -5 : 5), c.y, CITY_COLOR);
  }
}

/** The MultiLineString covering samples [from, to] (inclusive) of the flattened lines. */
function sliceLines(lines, from, to) {
  const out = [];
  let offset = 0;
  for (const line of lines) {
    const a = Math.max(from - offset, 0);
    const b = Math.min(to - offset, line.length - 1);
    if (b - a >= 1) out.push(line.slice(a, b + 1));
    offset += line.length;
  }
  return { type: 'MultiLineString', coordinates: out };
}

/** Future line in 8 consecutive chunks, alpha stepping from 1 down to 0.25. */
function drawFuture(ctx, path, future, color) {
  const lines = future.coordinates;
  const n = lines.reduce((sum, l) => sum + l.length, 0);
  if (n < 2) return;
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  for (let k = 0; k < FUTURE_CHUNKS; k++) {
    const from = Math.floor((k * n) / FUTURE_CHUNKS);
    const to = Math.floor(((k + 1) * n) / FUTURE_CHUNKS);
    const chunk = sliceLines(lines, from, k === FUTURE_CHUNKS - 1 ? n : to);
    if (!chunk.coordinates.length) continue;
    ctx.globalAlpha = 1 - ((1 - FUTURE_ALPHA_END) * k) / (FUTURE_CHUNKS - 1);
    ctx.beginPath();
    path(chunk);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Visible projected vertices of the future lines, as arrays of [x, y], one per line. */
function projectedLines(projection, future) {
  return future.coordinates
    .map((line) => line.map((c) => visiblePoint(projection, c[0], c[1])).filter(Boolean))
    .filter((l) => l.length >= 2);
}

function drawChevron(ctx, lines, color) {
  const l = lines[0];
  if (!l) return;
  const [p0, p1] = l;
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  if (!len) return;
  const ux = (p1[0] - p0[0]) / len;
  const uy = (p1[1] - p0[1]) / len;
  const tx = p0[0] + ux * 10;
  const ty = p0[1] + uy * 10;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(tx - ux * 6 - uy * 3.5, ty - uy * 6 + ux * 3.5);
  ctx.lineTo(tx, ty);
  ctx.lineTo(tx - ux * 6 + uy * 3.5, ty - uy * 6 - ux * 3.5);
  ctx.stroke();
}

function tickText(minutes) {
  return minutes >= 60 ? `+${minutes / 60}h` : `+${minutes}m`;
}

function drawTicks(ctx, projection, lines, ticks, color, labelFirst) {
  const flat = lines.flatMap((l) => l.map((p, i) => ({ p, prev: l[i - 1] ?? p, next: l[i + 1] ?? p })));
  if (!flat.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ticks.forEach((t, idx) => {
    const p = visiblePoint(projection, t.lonDeg, t.latDeg);
    if (!p) return;
    let best = flat[0];
    let bestD = Infinity;
    for (const f of flat) {
      const d = Math.hypot(f.p[0] - p[0], f.p[1] - p[1]);
      if (d < bestD) { best = f; bestD = d; }
    }
    const dx = best.next[0] - best.prev[0];
    const dy = best.next[1] - best.prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    ctx.beginPath();
    ctx.moveTo(p[0] - nx * 2.5, p[1] - ny * 2.5);
    ctx.lineTo(p[0] + nx * 2.5, p[1] + ny * 2.5);
    ctx.stroke();
    if (idx < labelFirst) {
      ctx.font = `9px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      haloText(ctx, tickText(t.minutes), p[0] + nx * 10, p[1] + ny * 10, color);
    }
  });
}

function drawTrack(ctx, path, projection, s) {
  if (s.trackPast) {
    ctx.setLineDash([2, 4]);
    ctx.globalAlpha = 0.5;
    strokePath(ctx, path, s.trackPast, s.color, 1.5);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }
  if (!s.trackFuture) return;
  drawFuture(ctx, path, s.trackFuture, s.color);
  const lines = projectedLines(projection, s.trackFuture);
  drawChevron(ctx, lines, s.color);
  if (s.trackTicks?.length) drawTicks(ctx, projection, lines, s.trackTicks, s.color, s.selected ? 2 : 0);
}

export function drawMap(ctx, {
  projection, width, land, nightBands = [], sats = [], observer = null, zoom = 1, labels = null,
}) {
  const path = geoPath(projection, ctx);
  ctx.save();

  fillPath(ctx, path, SPHERE, MAP_COLORS.ocean);
  strokePath(ctx, path, graticuleFor(graticuleStep(zoom)), MAP_COLORS.graticule, 1);
  if (land) {
    fillPath(ctx, path, land, MAP_COLORS.land);
    strokePath(ctx, path, land, MAP_COLORS.landStroke, 0.75);
  }
  for (const band of nightBands) fillPath(ctx, path, band.feature, MAP_COLORS.night);

  if (labels) drawLabels(ctx, labels);

  const selected = sats.find((s) => s.selected && s.footprint);
  if (selected) {
    ctx.globalAlpha = 0.18;
    fillPath(ctx, path, selected.footprint, selected.color);
    ctx.globalAlpha = 1;
    ctx.setLineDash([6, 5]);
    strokePath(ctx, path, selected.footprint, selected.color, 1.5);
    ctx.setLineDash([]);
  }

  for (const s of sats) drawTrack(ctx, path, projection, s);

  if (observer) {
    const p = visiblePoint(projection, observer.lonDeg, observer.latDeg);
    if (p) {
      ctx.strokeStyle = MAP_COLORS.observer;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p[0] - 9, p[1]);
      ctx.lineTo(p[0] + 9, p[1]);
      ctx.moveTo(p[0], p[1] - 9);
      ctx.lineTo(p[0], p[1] + 9);
      ctx.stroke();
    }
  }

  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'middle';
  for (const s of sats) {
    const p = s.position && visiblePoint(projection, s.position.lonDeg, s.position.latDeg);
    if (!p) continue;
    const r = s.selected ? DOT_RADIUS + 1 : DOT_RADIUS;
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.strokeStyle = MAP_COLORS.ocean;
    ctx.lineWidth = RING_WIDTH;
    ctx.stroke();

    // Flip the label to the left of the dot near the right edge.
    const flip = width != null && p[0] > width - 90;
    ctx.textAlign = flip ? 'right' : 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = MAP_COLORS.ocean;
    ctx.strokeText(s.name, p[0] + (flip ? -(r + 5) : r + 5), p[1]);
    ctx.fillStyle = s.color;
    ctx.fillText(s.name, p[0] + (flip ? -(r + 5) : r + 5), p[1]);
  }

  ctx.restore();
}

/** The noradId of the satellite dot nearest (x, y) within radiusPx, else null. */
export function hitTest(sats, projection, x, y, radiusPx = 22) {
  let best = null;
  let bestD = radiusPx;
  for (const s of sats) {
    const p = s.position && visiblePoint(projection, s.position.lonDeg, s.position.latDeg);
    if (!p) continue;
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d <= bestD) { best = s.noradId; bestD = d; }
  }
  return best;
}
