// lib/map/overlays.mjs - the map's satellites, night and observer as GeoJSON
// sources, MapLibre layer specs and icon images. Pure: no DOM, no map.
import { basemapColors } from './basemap.mjs';
import { mapPolygons, nightBands } from './geometry.mjs';
import { emphasisOf } from './palette.mjs';

export const OVERLAY_SOURCES = ['ss-night', 'ss-footprint', 'ss-track-past', 'ss-track-future', 'ss-marks', 'ss-observer', 'ss-sats'];

const CANVAS_COLORS = {
  dark: { observer: '#7eb8ff', night: 'rgba(3, 5, 12, 0.24)' },
  light: { observer: '#1f5fbf', night: 'rgba(20, 30, 60, 0.07)' },
};

/** Colours the overlay layers and images need: water (rings and halos), observer, night. */
export function overlayColors(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  return { water: basemapColors(t).water, ...CANVAS_COLORS[t] };
}

const FUTURE_CHUNKS = 8;
const FUTURE_ALPHA_END = 0.25;
const SORT_KEY = { ghost: 0, normal: 1, focus: 2 };
const RAD = Math.PI / 180;

const collection = (features) => ({ type: 'FeatureCollection', features });
const point = (coordinates, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties });
const wrapLon = (d) => d - 360 * Math.round(d / 360);

/** Degrees clockwise from north, from a to b ([lon, lat]). */
function bearing(a, b) {
  const [l1, p1] = [a[0] * RAD, a[1] * RAD];
  const [l2, p2] = [b[0] * RAD, b[1] * RAD];
  const y = Math.sin(l2 - l1) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

/** Lines of a LineString or MultiLineString. */
function linesOf(shape) {
  if (!shape) return [];
  return shape.type === 'LineString' ? [shape.coordinates] : shape.coordinates ?? [];
}

/** The lines covering points [from, to] (inclusive) of the flattened lines,
 *  never joining across a split. */
function sliceLines(lines, from, to) {
  const out = [];
  let offset = 0;
  for (const line of lines) {
    const a = Math.max(from - offset, 0);
    const b = Math.min(to - offset, line.length - 1);
    if (b - a >= 1) out.push(line.slice(a, b + 1));
    offset += line.length;
  }
  return out;
}

/** The future track cut into 8 runs by point count, fading from 1 to 0.25. */
function futureChunks(lines, props) {
  const n = lines.reduce((sum, l) => sum + l.length, 0);
  if (n < 2) return [];
  const out = [];
  for (let i = 0; i < FUTURE_CHUNKS; i++) {
    const from = Math.floor((i * n) / FUTURE_CHUNKS);
    const to = i === FUTURE_CHUNKS - 1 ? n : Math.floor(((i + 1) * n) / FUTURE_CHUNKS);
    const coordinates = sliceLines(lines, from, to);
    if (!coordinates.length) continue;
    const opacity = 1 - ((1 - FUTURE_ALPHA_END) * i) / (FUTURE_CHUNKS - 1);
    out.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates }, properties: { ...props, opacity } });
  }
  return out;
}

function tickLabel(minutes) {
  return minutes >= 60 ? `+${minutes / 60}h` : `+${minutes}m`;
}

/** Direction of travel at a tick: from the track points either side of the vertex nearest it. */
function tickBearing(lines, t) {
  let best = null;
  let bestD = Infinity;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const d = Math.hypot(wrapLon(line[i][0] - t.lonDeg), line[i][1] - t.latDeg);
      if (d < bestD) { bestD = d; best = { line, i }; }
    }
  }
  if (!best || best.line.length < 2) return 0;
  const { line, i } = best;
  return bearing(line[Math.max(i - 1, 0)], line[Math.min(i + 1, line.length - 1)]);
}

function marksFor(s, lines, focus) {
  const props = { noradId: s.noradId, color: s.color };
  const out = [];
  const first = lines.find((l) => l.length >= 2);
  if (first) {
    const [p0, p1] = first;
    const at = [p0[0] + 0.1 * wrapLon(p1[0] - p0[0]), p0[1] + 0.1 * (p1[1] - p0[1])];
    out.push(point(at, { ...props, kind: 'chevron', bearing: bearing(p0, p1) }));
  }
  (s.trackTicks ?? []).forEach((t, i) => {
    out.push(point([t.lonDeg, t.latDeg], {
      ...props,
      kind: 'tick',
      bearing: tickBearing(lines, t),
      label: focus && i < 2 ? tickLabel(t.minutes) : '',
    }));
  });
  return out;
}

/** A closed ring as lines, split where it crosses the date line, for outlining
 *  a repaired polygon without drawing its cut edges. */
function ringLines(ring) {
  const lines = [[ring[0]]];
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i - 1], q = ring[i];
    if (Math.abs(q[0] - p[0]) > 180) {
      const edge = p[0] > 0 ? 180 : -180;
      const qLon = q[0] + (p[0] > 0 ? 360 : -360);
      const lat = p[1] + ((edge - p[0]) / (qLon - p[0])) * (q[1] - p[1]);
      lines.at(-1).push([edge, lat]);
      lines.push([[-edge, lat]]);
    }
    lines.at(-1).push(q);
  }
  // The ring is closed, so its last run continues into its first.
  if (lines.length > 1) lines[0] = lines.pop().concat(lines[0].slice(1));
  return lines.filter((l) => l.length >= 2);
}

/**
 * GeoJSON for every overlay source. Hidden satellites are left out; ghosts are
 * dots only. shortTrackIds: satellites whose track is too small on screen to
 * show direction, so they get no chevron or ticks.
 */
export function overlayData({ sats = [], observer = null, nightDate = null, shortTrackIds = new Set() } = {}) {
  const short = new Set(shortTrackIds);
  const night = nightDate
    ? nightBands(nightDate).map((b) => ({
      type: 'Feature', geometry: mapPolygons(b.feature.coordinates[0]), properties: { band: b.sunBelowDeg },
    }))
    : [];
  const footprint = [];
  const past = [];
  const future = [];
  const marks = [];
  const dots = [];
  for (const s of sats) {
    const emphasis = emphasisOf(s);
    if (emphasis === 'hidden') continue;
    const focus = emphasis === 'focus';
    if (s.position) {
      dots.push(point([s.position.lonDeg, s.position.latDeg], {
        noradId: s.noradId,
        name: emphasis === 'ghost' ? '' : s.name,
        color: s.color,
        emphasis,
        sortKey: SORT_KEY[emphasis],
      }));
    }
    if (emphasis === 'ghost') continue;
    const props = { noradId: s.noradId, color: s.color };
    if (focus && s.footprint && !footprint.length) {
      const ring = s.footprint.coordinates[0];
      footprint.push(
        { type: 'Feature', geometry: mapPolygons(ring), properties: { ...props, part: 'area' } },
        { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: ringLines(ring) }, properties: { ...props, part: 'edge' } },
      );
    }
    const pastLines = linesOf(s.trackPast).filter((l) => l.length >= 2);
    if (pastLines.length) past.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: pastLines }, properties: props });
    const futureLines = linesOf(s.trackFuture);
    future.push(...futureChunks(futureLines, props));
    if (!short.has(s.noradId)) marks.push(...marksFor(s, futureLines, focus));
  }
  return {
    'ss-night': collection(night),
    'ss-footprint': collection(footprint),
    'ss-track-past': collection(past),
    'ss-track-future': collection(future),
    'ss-marks': collection(marks),
    'ss-observer': collection(observer ? [point([observer.lonDeg, observer.latDeg], {})] : []),
    'ss-sats': collection(dots),
  };
}

// Glyphs come from the basemap's OpenFreeMap font server.
const NAME_FONT = ['Noto Sans Bold'];
const TICK_FONT = ['Noto Sans Regular'];

// A tick label sits about 10 px to the right of travel, like the canvas map.
// Expressions cannot build arrays, so step through eight 45 degree sectors.
const TICK_LABEL_EM = 1.1;
function tickLabelOffset() {
  const offset = (k) => {
    const b = (k * 45 + 90) * RAD;
    return ['literal', [Math.round(Math.sin(b) * TICK_LABEL_EM * 100) / 100, Math.round(-Math.cos(b) * TICK_LABEL_EM * 100) / 100]];
  };
  const expr = ['step', ['%', ['+', ['get', 'bearing'], 22.5], 360], offset(0)];
  for (let k = 1; k < 8; k++) expr.push(k * 45, offset(k));
  return expr;
}

/** MapLibre layers for the overlays, bottom to top. colors: overlayColors(theme). */
export function overlayLayers(colors) {
  const byEmphasis = (focus, normal, ghost) => ['match', ['get', 'emphasis'], 'focus', focus, 'ghost', ghost, normal];
  const satsLayer = (id, filter) => ({
    id,
    type: 'symbol',
    source: 'ss-sats',
    filter,
    layout: {
      'icon-image': byEmphasis('ss-dot-focus', 'ss-dot', 'ss-dot-ghost'),
      'icon-allow-overlap': true,
      'icon-ignore-placement': false,
      'text-field': ['get', 'name'],
      'text-font': NAME_FONT,
      'text-size': 11,
      'text-variable-anchor': ['left', 'right'],
      'text-radial-offset': 0.8,
      'text-justify': 'auto',
      'text-optional': true,
      // Lower keys draw first, so ghosts sit under normal dots.
      'symbol-sort-key': ['get', 'sortKey'],
    },
    paint: {
      'icon-color': ['get', 'color'],
      'icon-halo-color': colors.water,
      // Ghosts are faint dots with no ring.
      'icon-halo-width': byEmphasis(2, 2, 0),
      'icon-opacity': byEmphasis(1, 1, 0.35),
      'text-color': ['get', 'color'],
      'text-halo-color': colors.water,
      'text-halo-width': 1.5,
    },
  });
  return [
    {
      // Each band paints the night colour once; where bands overlap they
      // stack, so deeper twilight is darker.
      id: 'ss-night',
      type: 'fill',
      source: 'ss-night',
      paint: {
        'fill-color': colors.night,
        'fill-opacity': ['match', ['get', 'band'], [0, -6, -12, -18], 1, 0],
        // Antialiased edges would show the date-line cuts as seams.
        'fill-antialias': false,
      },
    },
    {
      id: 'ss-footprint-fill',
      type: 'fill',
      source: 'ss-footprint',
      filter: ['==', ['get', 'part'], 'area'],
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.18, 'fill-antialias': false },
    },
    {
      id: 'ss-footprint-line',
      type: 'line',
      source: 'ss-footprint',
      filter: ['==', ['get', 'part'], 'edge'],
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-dasharray': [4, 3.3] },
    },
    {
      id: 'ss-track-past',
      type: 'line',
      source: 'ss-track-past',
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.5, 'line-dasharray': [1.3, 2.7] },
    },
    {
      id: 'ss-track-future',
      type: 'line',
      source: 'ss-track-future',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': ['get', 'opacity'] },
    },
    {
      id: 'ss-marks',
      type: 'symbol',
      source: 'ss-marks',
      layout: {
        'icon-image': ['match', ['get', 'kind'], 'chevron', 'ss-chevron', 'ss-tick'],
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': ['get', 'label'],
        'text-font': TICK_FONT,
        'text-size': 9,
        'text-offset': tickLabelOffset(),
        'text-optional': true,
      },
      paint: {
        'icon-color': ['get', 'color'],
        'text-color': ['get', 'color'],
        'text-halo-color': colors.water,
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'ss-observer',
      type: 'symbol',
      source: 'ss-observer',
      layout: { 'icon-image': 'ss-observer', 'icon-allow-overlap': true },
    },
    // The focus has its own layer on top: MapLibre places the top layer's
    // symbols first and draws it last, so the focus name wins and its dot is
    // never under another.
    satsLayer('ss-sats', ['!=', ['get', 'emphasis'], 'focus']),
    satsLayer('ss-sats-focus', ['==', ['get', 'emphasis'], 'focus']),
  ];
}

// --- Icons, rasterised by hand so this runs without a DOM or canvas. ---

/** Distance from p to segment ab. */
function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Distance from p to a polyline. */
function polylineDistance(p, pts) {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segmentDistance(p, pts[i - 1], pts[i]));
  return d;
}

// MapLibre reads an SDF icon's alpha as distance: 0.75 at the edge, one
// eighth per pixel (its SDF_PX), so halos can reach up to 6 px outside.
const SDF_EDGE = 0.75;
const SDF_PX = 8;

/** A white SDF image; inside(x, y) is the signed distance into the shape at a pixel centre. */
function sdfImage(id, size, inside) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.max(0, Math.min(1, SDF_EDGE + inside(x + 0.5, y + 0.5) / SDF_PX)) * 255);
    }
  }
  return { id, width: size, height: size, data, sdf: true };
}

// Room past a shape's edge for a 2 px halo and the edge's antialiasing.
const SDF_PAD = 4;

function dotImage(id, radius) {
  const size = 2 * (radius + SDF_PAD);
  const c = size / 2;
  return sdfImage(id, size, (x, y) => radius - Math.hypot(x - c, y - c));
}

/** A stroke of half width w along a polyline (drawn pointing north). */
function strokeImage(id, size, pts, w) {
  return sdfImage(id, size, (x, y) => w - polylineDistance([x, y], pts));
}

function parseHex(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`overlay colours must be #rrggbb: ${hex}`);
  return [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
}

/** The observer mark: a 5 px ring with 9 px crosshair arms, 2 px strokes, antialiased. */
function observerImage(color) {
  const size = 22;
  const c = size / 2;
  const [r, g, b] = parseHex(color);
  const half = 1;
  const arms = [[[c - 9, c], [c + 9, c]], [[c, c - 9], [c, c + 9]]];
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = [x + 0.5, y + 0.5];
      const d = Math.min(
        Math.abs(Math.hypot(p[0] - c, p[1] - c) - 5),
        ...arms.map(([a, z]) => segmentDistance(p, a, z)),
      );
      const i = (y * size + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
      data[i + 3] = Math.round(Math.max(0, Math.min(1, half + 0.5 - d)) * 255);
    }
  }
  return { id: 'ss-observer', width: size, height: size, data, sdf: false };
}

/** Icon images the overlay layers name. Dots, chevrons and ticks are white SDF
 *  shapes coloured by icon-color; the observer is drawn in its own colour. */
export function overlayImages(colors) {
  // Chevron points north with its tip just above centre; a tick lies across
  // the track, so rotating either by the bearing lines it up.
  const chevron = strokeImage('ss-chevron', 16, [[8 - 3.5, 8 + 3], [8, 8 - 3], [8 + 3.5, 8 + 3]], 0.75);
  const tick = strokeImage('ss-tick', 14, [[7 - 2.5, 7], [7 + 2.5, 7]], 0.75);
  return [
    chevron,
    tick,
    dotImage('ss-dot', 4),
    dotImage('ss-dot-focus', 5),
    dotImage('ss-dot-ghost', 3),
    observerImage(colors.observer),
  ];
}
