// lib/map/draw.mjs - pure canvas drawing and hit-testing for the flat map.
import { geoPath, geoGraticule } from 'd3-geo';

export const MAP_COLORS = {
  ocean: '#0f1830',
  land: '#1b2845',
  landStroke: '#2c3e63',
  graticule: 'rgba(126, 184, 255, 0.14)',
  // Drawn once per band, so deeper night stacks darker.
  night: 'rgba(3, 5, 12, 0.24)',
  observer: '#7eb8ff',
  footprint: 'rgba(126, 184, 255, 0.16)',
};

export const SAT_PALETTE = ['#ff9b54', '#7fe5d1', '#c084fc', '#facc15', '#f87171', '#34d399', '#a78bfa', '#fb923c'];

const SPHERE = { type: 'Sphere' };
const GRATICULE = geoGraticule().step([30, 30])();
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

export function drawMap(ctx, { projection, width, land, nightBands = [], sats = [], observer = null }) {
  const path = geoPath(projection, ctx);
  ctx.save();

  fillPath(ctx, path, SPHERE, MAP_COLORS.ocean);
  strokePath(ctx, path, GRATICULE, MAP_COLORS.graticule, 1);
  if (land) {
    fillPath(ctx, path, land, MAP_COLORS.land);
    strokePath(ctx, path, land, MAP_COLORS.landStroke, 0.75);
  }
  for (const band of nightBands) fillPath(ctx, path, band.feature, MAP_COLORS.night);

  const selected = sats.find((s) => s.selected && s.footprint);
  if (selected) {
    fillPath(ctx, path, selected.footprint, MAP_COLORS.footprint);
    strokePath(ctx, path, selected.footprint, selected.color, 1);
  }

  for (const s of sats) {
    if (s.track) strokePath(ctx, path, s.track, s.color, 2);
  }

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
