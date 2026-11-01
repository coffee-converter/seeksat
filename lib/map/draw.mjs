// lib/map/draw.mjs - pure canvas drawing and hit-testing for the flat map.
import { GHOST_RADIUS, NAME_GAP_PX, dotRadius, nameFlips } from './marks.mjs';
import { geoPath, geoGraticule } from 'd3-geo';
import { graticuleStep, placeLabelsAt } from './labels.mjs';
import { isVisible } from './visible.mjs';

export { isVisible };

export const MAP_COLORS = {
  ocean: '#0f1830',
  land: '#1b2845',
  landStroke: '#2c3e63',
  graticule: 'rgba(126, 184, 255, 0.14)',
  // Drawn once per band, so deeper night stacks darker.
  night: 'rgba(3, 5, 12, 0.24)',
  observer: '#7eb8ff',
};

const LABELS_DARK = {
  graticuleText: 'rgba(207, 224, 255, 0.55)',
  regionText: 'rgba(207, 224, 255, 0.35)',
  city: 'rgba(207, 224, 255, 0.75)',
  cityText: 'rgba(207, 224, 255, 0.6)',
};

export const MAP_PALETTES = {
  dark: { ...MAP_COLORS, ...LABELS_DARK },
  light: {
    ocean: '#dfe8f3',
    land: '#f7f4ec',
    landStroke: '#c9c2b0',
    graticule: 'rgba(31, 95, 191, 0.14)',
    night: 'rgba(20, 30, 60, 0.07)',
    observer: '#1f5fbf',
    graticuleText: 'rgba(27, 35, 51, 0.60)',
    regionText: 'rgba(27, 35, 51, 0.5)',
    city: 'rgba(27, 35, 51, 0.75)',
    cityText: 'rgba(27, 35, 51, 0.75)',
  },
};

export const SAT_PALETTE = ['#ff9b54', '#7fe5d1', '#c084fc', '#facc15', '#f87171', '#34d399', '#a78bfa', '#fb923c'];

export const SAT_PALETTES = {
  dark: SAT_PALETTE,
  light: ['#c0501f', '#0b7d6b', '#8b3fd9', '#8a6a00', '#d6403f', '#0f7a4f', '#6d4fd8', '#b4570c'],
};

const SPHERE = { type: 'Sphere' };
const graticuleCache = new Map();
function graticuleFor(step) {
  if (!graticuleCache.has(step)) graticuleCache.set(step, geoGraticule().step([step, step])());
  return graticuleCache.get(step);
}
const FONT_FAMILY = 'system-ui, -apple-system, sans-serif';
const FUTURE_CHUNKS = 8;
const FUTURE_ALPHA_END = 0.25;
const GHOST_ALPHA = 0.35;
const RING_WIDTH = 2;
const LABEL_FONT = '600 11px system-ui, -apple-system, sans-serif';

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

function haloText(ctx, palette, text, x, y, fill) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = palette.ocean;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawLabels(ctx, labels, projection, palette) {
  ctx.lineJoin = 'round';
  ctx.font = `10px ${FONT_FAMILY}`;
  for (const g of labels.graticule ?? []) {
    ctx.textAlign = g.align;
    ctx.textBaseline = g.baseline;
    haloText(ctx, palette, g.text, g.x, g.y, palette.graticuleText);
  }
  // Picked for a slightly older view; each name goes back on its point.
  const places = placeLabelsAt(projection, labels.places);
  ctx.font = `11px ${FONT_FAMILY}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.letterSpacing = '1.5px';
  for (const r of places) {
    if (r.kind !== 'region') continue;
    haloText(ctx, palette, r.text.toUpperCase(), r.x, r.y, palette.regionText);
  }
  ctx.letterSpacing = '0px';
  for (const c of places) {
    if (c.kind !== 'city') continue;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = palette.city;
    ctx.fill();
    const right = c.align === 'right';
    ctx.textAlign = right ? 'right' : 'left';
    haloText(ctx, palette, c.text, c.x + (right ? -5 : 5), c.y, palette.cityText);
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

/** Where each tick sits and which way its label goes (the track's normal there). */
function tickSpots(projection, lines, ticks) {
  const flat = lines.flatMap((l) => l.map((p, i) => ({ p, prev: l[i - 1] ?? p, next: l[i + 1] ?? p })));
  if (!flat.length) return [];
  const out = [];
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
    out.push({ t, idx, p, nx: -dy / len, ny: dx / len });
  });
  return out;
}

const TICK_LABEL_OFFSET = 10;
const TICK_CHAR_PX = 5.6;
const TICK_LABEL_PX = 11;

function drawTicks(ctx, palette, projection, lines, ticks, color, labelFirst) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (const { t, idx, p, nx, ny } of tickSpots(projection, lines, ticks)) {
    ctx.beginPath();
    ctx.moveTo(p[0] - nx * 2.5, p[1] - ny * 2.5);
    ctx.lineTo(p[0] + nx * 2.5, p[1] + ny * 2.5);
    ctx.stroke();
    if (idx < labelFirst) {
      ctx.font = `9px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      haloText(ctx, palette, tickText(t.minutes), p[0] + nx * TICK_LABEL_OFFSET, p[1] + ny * TICK_LABEL_OFFSET, color);
    }
  }
}

/** Boxes of the tick labels drawn for a focused satellite, from the same geometry draw uses. */
export function tickLabelBoxes(sat, projection) {
  if (!sat?.trackFuture || !sat.trackTicks?.length || emphasisOf(sat) !== 'focus') return [];
  const lines = projectedLines(projection, sat.trackFuture);
  return tickSpots(projection, lines, sat.trackTicks)
    .filter((s) => s.idx < 2)
    .map(({ t, p, nx, ny }) => {
      const x = p[0] + nx * TICK_LABEL_OFFSET;
      const y = p[1] + ny * TICK_LABEL_OFFSET;
      const w = tickText(t.minutes).length * TICK_CHAR_PX + 3;
      return { x0: x - w / 2, y0: y - TICK_LABEL_PX / 2, x1: x + w / 2, y1: y + TICK_LABEL_PX / 2 };
    });
}

/** focus, normal, ghost or hidden; a sat without one is focus when selected. */
export function emphasisOf(s) {
  return s.emphasis ?? (s.selected ? 'focus' : 'normal');
}
const DOT_ORDER = { ghost: 0, normal: 1, focus: 2 };

function drawTrack(ctx, path, projection, s, palette) {
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
  if (s.trackTicks?.length) drawTicks(ctx, palette, projection, lines, s.trackTicks, s.color, emphasisOf(s) === 'focus' ? 2 : 0);
}

export function drawMap(ctx, {
  projection, width, land, nightBands = [], sats = [], observer = null, zoom = 1, labels = null, palette = MAP_PALETTES.dark,
}) {
  const path = geoPath(projection, ctx);
  ctx.save();

  fillPath(ctx, path, SPHERE, palette.ocean);
  strokePath(ctx, path, graticuleFor(graticuleStep(zoom, width)), palette.graticule, 1);
  if (land) {
    fillPath(ctx, path, land, palette.land);
    strokePath(ctx, path, land, palette.landStroke, 0.75);
  }
  for (const band of nightBands) fillPath(ctx, path, band.feature, palette.night);

  if (labels) drawLabels(ctx, labels, projection, palette);

  const focus = sats.find((s) => emphasisOf(s) === 'focus' && s.footprint);
  if (focus) {
    ctx.globalAlpha = 0.18;
    fillPath(ctx, path, focus.footprint, focus.color);
    ctx.globalAlpha = 1;
    ctx.setLineDash([6, 5]);
    strokePath(ctx, path, focus.footprint, focus.color, 1.5);
    ctx.setLineDash([]);
  }

  // Ghosts are dots only; hidden satellites are not drawn.
  const shown = sats.filter((s) => emphasisOf(s) !== 'hidden');
  for (const s of shown) if (emphasisOf(s) !== 'ghost') drawTrack(ctx, path, projection, s, palette);

  if (observer) {
    const p = visiblePoint(projection, observer.lonDeg, observer.latDeg);
    if (p) {
      ctx.strokeStyle = palette.observer;
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
  // Ghosts under the rest, the focus on top.
  const dots = [...shown].sort((a, b) => DOT_ORDER[emphasisOf(a)] - DOT_ORDER[emphasisOf(b)]);
  for (const s of dots) {
    const p = s.position && visiblePoint(projection, s.position.lonDeg, s.position.latDeg);
    if (!p) continue;
    const emphasis = emphasisOf(s);
    if (emphasis === 'ghost') {
      ctx.globalAlpha = GHOST_ALPHA;
      ctx.beginPath();
      ctx.arc(p[0], p[1], GHOST_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    const r = dotRadius(emphasis);
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.strokeStyle = palette.ocean;
    ctx.lineWidth = RING_WIDTH;
    ctx.stroke();

    // Flip the label to the left of the dot near the right edge.
    const flip = nameFlips(p[0], width);
    ctx.textAlign = flip ? 'right' : 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.ocean;
    ctx.strokeText(s.name, p[0] + (flip ? -(r + NAME_GAP_PX) : r + NAME_GAP_PX), p[1]);
    ctx.fillStyle = s.color;
    ctx.fillText(s.name, p[0] + (flip ? -(r + NAME_GAP_PX) : r + NAME_GAP_PX), p[1]);
  }

  ctx.restore();
}

/** The noradId of the satellite dot nearest (x, y) within radiusPx, else null.
 *  Ghosts can be tapped; hidden satellites cannot. */
export function hitTest(sats, projection, x, y, radiusPx = 22) {
  let best = null;
  let bestD = radiusPx;
  for (const s of sats) {
    if (emphasisOf(s) === 'hidden') continue;
    const p = s.position && visiblePoint(projection, s.position.lonDeg, s.position.latDeg);
    if (!p) continue;
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d <= bestD) { best = s.noradId; bestD = d; }
  }
  return best;
}
