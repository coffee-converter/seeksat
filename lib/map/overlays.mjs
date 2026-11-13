// lib/map/overlays.mjs - the map's satellites, night and observer as GeoJSON
// sources, MapLibre layer specs and icon images. Pure: no DOM, no map.
import { basemapColors } from './basemap.mjs';
import { circleLine, densifyLine, greatCircle, mapPolygons, nightBands } from './geometry.mjs';
import { geodeticToEcef } from '../coords.js';
import { distanceText } from '../units.mjs';
import { satAltitudeDeg } from '../pass-finder/visibility.js';
import { emphasisOf } from './palette.mjs';
import { GRID_VIEW_ZOOM } from './grid.mjs';

export const OVERLAY_SOURCES = ['ss-graticule', 'ss-grid-view', 'ss-night', 'ss-footprint', 'ss-track-past', 'ss-track-future', 'ss-pass', 'ss-marks', 'ss-observer', 'ss-sats'];

export const CANVAS_COLORS = {
  // gridOpacity: the view grid's lines past globe level (dark needs more to show).
  dark: { observer: '#8fb4e6', night: 'rgba(3, 5, 12, 0.24)', graticule: '#a7b0bf', gridOpacity: 0.26 },
  light: { observer: '#2c5a99', night: 'rgba(20, 30, 60, 0.07)', graticule: '#3d4757', gridOpacity: 0.17 },
};

/** "421 km up" or "35,786 km up": a satellite's height, under its name
 *  (said as "up", so it is not read as the distance from you). */
export function altText(altKm) {
  return Number.isFinite(altKm) ? `${distanceText(altKm)} up` : '';
}

/** "1,578 km away": the straight-line distance from the observer. */
export function awayText(rangeKm) {
  return Number.isFinite(rangeKm) ? `${distanceText(rangeKm)} away` : '';
}

/** The middle of a line (its points between 22% and 78% of the way), for a
 *  label that must keep clear of the icons at both ends; null if too few. */
function middleOf(coords) {
  if (coords.length < 5) return null;
  const from = Math.floor(coords.length * 0.22);
  const to = Math.ceil(coords.length * 0.78);
  return coords.slice(from, to + 1);
}

/** The straight-line distance (km) and elevation (degrees) from the observer
 *  to a point altKm above (lonDeg, latDeg). */
export function sightFrom(observer, lonDeg, latDeg, altKm) {
  const sat = geodeticToEcef(latDeg, lonDeg, altKm * 1000);
  const obs = geodeticToEcef(observer.latDeg, observer.lonDeg, 0);
  const rangeKm = Math.hypot(sat[0] - obs[0], sat[1] - obs[1], sat[2] - obs[2]) / 1000;
  return { rangeKm, elDeg: satAltitudeDeg({ latDeg: observer.latDeg, lonDeg: observer.lonDeg, elevM: 0 }, sat) };
}

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

// Curved copies of a track's lines, per detail level. A track shape lives for
// a minute (useMapSats rebuilds it), so the curve is computed once, not on
// every one-second push.
const curved = new WeakMap();
function detailedLines(shape, detail) {
  const lines = linesOf(shape);
  if (!shape || detail <= 1) return lines;
  let byDetail = curved.get(shape);
  if (!byDetail) curved.set(shape, (byDetail = new Map()));
  let out = byDetail.get(detail);
  if (!out) byDetail.set(detail, (out = lines.map((l) => densifyLine(l, detail))));
  return out;
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

/** Each point's time for a track drawn at `detail` (densifyLine's points sit
 *  evenly between two samples), flattened; null when the shape has no times. */
function detailedTimes(shape, detail) {
  const times = shape?.times;
  if (!times) return null;
  const out = [];
  for (const line of times) {
    if (detail <= 1 || line.length < 2) { out.push(...line); continue; }
    for (let i = 0; i < line.length - 1; i++) {
      for (let s = 0; s < detail; s++) out.push(line[i] + ((line[i + 1] - line[i]) * s) / detail);
    }
    out.push(line.at(-1));
  }
  return out;
}

/** The future track cut into 8 runs fading from 1 to 0.25: by time when the
 *  points carry times (a highly elliptical track has extra points where it
 *  moves fast), else by point count. */
function futureChunks(lines, props, times = null) {
  const n = lines.reduce((sum, l) => sum + l.length, 0);
  if (n < 2) return [];
  const byTime = times && times.length === n && times[n - 1] > times[0];
  // The first point at or after an eighth of the way through.
  const indexAt = (i) => {
    if (!byTime) return Math.floor((i * n) / FUTURE_CHUNKS);
    const target = times[0] + ((times[n - 1] - times[0]) * i) / FUTURE_CHUNKS;
    let k = 0;
    while (k < n - 1 && times[k] < target) k++;
    return k;
  };
  const out = [];
  for (let i = 0; i < FUTURE_CHUNKS; i++) {
    const from = indexAt(i);
    const to = i === FUTURE_CHUNKS - 1 ? n : indexAt(i + 1);
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

// The chevron sits a tenth of the way along the first sampled step of the
// track, taken from the plain samples so curving more points into the line on
// zoom does not pull it toward the dot.
function marksFor(s, focus) {
  const lines = linesOf(s.trackFuture);
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

/**
 * GeoJSON for every overlay source. Hidden satellites are left out; ghosts are
 * dots only. shortTrackIds: satellites whose track is too small on screen to
 * show direction, so they get no chevron or ticks. tracks: false leaves out
 * the track line sources without building them, for a push where the tracks
 * have not changed. marks: false also skips the chevron and ticks (ss-marks
 * is left out), for the fast dot path that never sends them.
 */
export function overlayData({ sats = [], observer = null, nightDate = null, shortTrackIds = new Set(), trackDetail = 1, tracks = true, marks: marksOn = true, graticule = false } = {}) {
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
  const pass = [];
  for (const s of sats) {
    const emphasis = emphasisOf(s);
    if (emphasis === 'hidden') continue;
    const focus = emphasis === 'focus';
    if (s.position) {
      dots.push(point([s.position.lonDeg, s.position.latDeg], {
        noradId: s.noradId,
        name: emphasis === 'ghost' ? '' : s.name,
        // Its height on a second, smaller line (not for ghosts).
        alt: emphasis === 'ghost' ? '' : altText(s.altKm),
        color: s.color,
        emphasis,
        sortKey: SORT_KEY[emphasis],
        // Known radio downlinks: the dot gets the radio mark (ss-sats-radio).
        radio: s.radio === true,
      }));
    }
    if (emphasis === 'ghost') continue;
    const props = { noradId: s.noradId, color: s.color };
    if (focus && s.footprint && !footprint.length) {
      const ring = s.footprint.coordinates[0];
      // Fill only: an outline read as one more track line.
      footprint.push({ type: 'Feature', geometry: mapPolygons(ring), properties: { ...props, part: 'area' } });
    }
    // Chevron and ticks move every second, so they are built on every push.
    if (marksOn && !short.has(s.noradId)) marks.push(...marksFor(s, focus));
    // Live, with its pass open: a sight line from the observer to where it is
    // now, with how far, only while it is above the horizon. Built with the
    // marks, so it moves every second.
    if (marksOn && observer && s.passLive && s.position && Number.isFinite(s.altKm)) {
      const { rangeKm, elDeg } = sightFrom(observer, s.position.lonDeg, s.position.latDeg, s.altKm);
      if (elDeg >= 0) {
        const line = greatCircle([observer.lonDeg, observer.latDeg], [s.position.lonDeg, s.position.latDeg]);
        marks.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: { ...props, kind: 'sight' } });
        const mid = middleOf(line);
        if (mid) marks.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: mid }, properties: { ...props, kind: 'sight-label', label: awayText(rangeKm) } });
      }
    }
    if (!tracks) continue;
    // An opened pass: its path drawn bold over the track, and a sight line
    // from the observer to where it comes closest (its highest point).
    if (s.passPath) {
      // Rise to set: solid in sunlight, dashed in Earth's shadow (all solid
      // when not split). Its rise and set marks are HTML markers (FlatMap),
      // which hide on the far side of the globe.
      const split = s.passSunlit || s.passShadow;
      const pieces = split ? [['sunlit', s.passSunlit], ['shadow', s.passShadow]] : [['sunlit', s.passPath]];
      for (const [part, shape] of pieces) {
        const lines = shape ? detailedLines(shape, trackDetail).filter((l) => l.length >= 2) : [];
        if (lines.length) pass.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: lines }, properties: { ...props, part } });
      }
      // Where a satellite at this height is above the lowest pass setting
      // from the observer: every visible pass runs inside it.
      if (observer && s.passReachDeg > 0) {
        pass.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: s.passRing ?? circleLine(observer.lonDeg, observer.latDeg, s.passReachDeg) },
          properties: { ...props, part: 'reach' },
        });
      }
      // Paused at the closest approach: the sight line to it, with how far.
      if (observer && s.passPeak) {
        const away = Number.isFinite(s.passPeak.altKm)
          ? awayText(sightFrom(observer, s.passPeak.lonDeg, s.passPeak.latDeg, s.passPeak.altKm).rangeKm)
          : '';
        const line = greatCircle([observer.lonDeg, observer.latDeg], [s.passPeak.lonDeg, s.passPeak.latDeg]);
        pass.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: { ...props, part: 'sight' } });
        const mid = middleOf(line);
        if (mid && away) pass.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: mid }, properties: { ...props, part: 'sight-label', label: away } });
      }
    }
    const pastLines = detailedLines(s.trackPast, trackDetail).filter((l) => l.length >= 2);
    if (pastLines.length) past.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: pastLines }, properties: props });
    const futureLines = detailedLines(s.trackFuture, trackDetail);
    future.push(...futureChunks(futureLines, props, detailedTimes(s.trackFuture, trackDetail)));
  }
  return {
    // The view's grid (lib/map/grid.mjs) starts empty; the map fills it per view.
    ...(graticule && { 'ss-graticule': graticuleData(), 'ss-grid-view': collection([]) }),
    'ss-night': collection(night),
    'ss-footprint': collection(footprint),
    ...(tracks && {
      'ss-track-past': collection(past),
      'ss-track-future': collection(future),
      'ss-pass': collection(pass),
    }),
    ...(marksOn && { 'ss-marks': collection(marks) }),
    'ss-observer': collection(observer ? [point([observer.lonDeg, observer.latDeg], {})] : []),
    'ss-sats': collection(dots),
  };
}

// The lat/lon grid: static, so built once. Lines every 5 degrees, ranked so
// the layer can show 30 degree lines zoomed out and finer ones zoomed in.
// Parallels carry a point every 2 degrees so they curve on the globe.
let grid = null;
const rankOf = (deg) => (deg === 0 ? 30 : deg % 30 === 0 ? 30 : deg % 10 === 0 ? 10 : 5);
function graticuleData() {
  if (grid) return grid;
  const lines = [];
  for (let lon = -175; lon <= 180; lon += 5) {
    const coords = [];
    for (let lat = -90; lat <= 90; lat += 2) coords.push([lon, lat]);
    lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { kind: 'meridian', deg: lon, rank: rankOf(lon) } });
  }
  for (let lat = -85; lat <= 85; lat += 5) {
    const coords = [];
    for (let lon = -180; lon <= 180; lon += 2) coords.push([lon, lat]);
    lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { kind: 'parallel', deg: lat, rank: lat === 0 ? 'equator' : rankOf(lat) } });
  }
  grid = collection(lines);
  return grid;
}

// Faint enough that the basemap reads through.
export const FOOTPRINT_FILL_OPACITY = 0.08;

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
  // drawn: false keeps a layer's symbols placed (other names make room for
  // them) without drawing them.
  const satsLayer = (id, filter, drawn = true) => ({
    id,
    type: 'symbol',
    source: 'ss-sats',
    filter,
    layout: {
      'icon-image': byEmphasis('ss-dot-focus', 'ss-dot', 'ss-dot-ghost'),
      'icon-allow-overlap': true,
      'icon-ignore-placement': false,
      // The name, and under it the height in smaller type.
      'text-field': ['format',
        ['get', 'name'], {},
        ['case', ['!=', ['coalesce', ['get', 'alt'], ''], ''], ['concat', '\n', ['get', 'alt']], ''], { 'font-scale': 0.85 }],
      'text-font': NAME_FONT,
      'text-size': 11,
      // Right of the dot first, else left. The radio mark's arcs sit up and
      // to the left, so a name pushed left sits further out (1.5 em, past the
      // outer arc and its halo) on a dot that has them.
      'text-variable-anchor-offset': ['case', ['get', 'radio'],
        ['literal', ['left', [0.8, 0], 'right', [-1.5, 0]]],
        ['literal', ['left', [0.8, 0], 'right', [-0.8, 0]]]],
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
      'icon-opacity': drawn ? byEmphasis(1, 1, 0.35) : 0,
      'text-opacity': drawn ? 1 : 0,
      'text-color': ['get', 'color'],
      'text-halo-color': colors.water,
      'text-halo-width': 1.5,
    },
  });
  // Opacity by rank and zoom: 30 degree lines always, 10 from zoom 3, 5 from
  // zoom 5; the equator a touch stronger.
  // Ranks are compared as text: a match may not mix string and number cases.
  const rank = ['to-string', ['get', 'rank']];
  const gridOpacity = (rank30, rank10, rank5) => ['match', rank, 'equator', rank30 * 1.6, '30', rank30, '10', rank10, rank5];
  return [
    {
      id: 'ss-graticule',
      type: 'line',
      source: 'ss-graticule',
      paint: {
        'line-color': colors.graticule,
        'line-width': ['match', rank, 'equator', 0.9, 0.6],
        // Globe level only: at GRID_VIEW_ZOOM the view's grid
        // (ss-graticule-fine) takes over, drawing the same 30 degree lines at
        // the same strength (lib/map/grid.mjs STATIC_STEP), so the handover
        // is a swap, not a fade through no lines at all.
        'line-opacity': ['step', ['zoom'], gridOpacity(colors.gridOpacity, 0, 0), GRID_VIEW_ZOOM, 0],
      },
    },
    {
      // Past globe level: 2 to 3 lines each way, built for the view
      // (lib/map/grid.mjs), taking over from the static grid.
      id: 'ss-graticule-fine',
      type: 'line',
      source: 'ss-grid-view',
      paint: {
        'line-color': colors.graticule,
        'line-width': ['case', ['all', ['==', ['get', 'kind'], 'parallel'], ['==', ['get', 'deg'], 0]], 0.9, 0.6],
        'line-opacity': colors.gridOpacity,
      },
    },
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
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': FOOTPRINT_FILL_OPACITY, 'fill-antialias': false },
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
      id: 'ss-pass-reach',
      type: 'line',
      source: 'ss-pass',
      filter: ['==', ['get', 'part'], 'reach'],
      paint: { 'line-color': colors.observer, 'line-width': 1.5, 'line-opacity': 0.75, 'line-dasharray': [4, 3] },
    },
    {
      // A casing under the whole pass line, so the plain track never shows
      // through the shadow part's dashes.
      id: 'ss-pass-casing',
      type: 'line',
      source: 'ss-pass',
      filter: ['in', ['get', 'part'], ['literal', ['sunlit', 'shadow']]],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': colors.water, 'line-width': 8, 'line-opacity': 1 },
    },
    {
      id: 'ss-pass-shadow',
      type: 'line',
      source: 'ss-pass',
      filter: ['==', ['get', 'part'], 'shadow'],
      paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.8, 'line-dasharray': [1.2, 1.2] },
    },
    {
      id: 'ss-pass-sunlit',
      type: 'line',
      source: 'ss-pass',
      filter: ['==', ['get', 'part'], 'sunlit'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 0.95 },
    },
    {
      id: 'ss-pass-sight',
      type: 'line',
      source: 'ss-pass',
      filter: ['==', ['get', 'part'], 'sight'],
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.9, 'line-dasharray': [2, 2] },
    },
    {
      id: 'ss-pass-sight-label',
      type: 'symbol',
      source: 'ss-pass',
      filter: ['==', ['get', 'part'], 'sight-label'],
      layout: {
        'symbol-placement': 'line-center',
        'text-field': ['get', 'label'],
        'text-font': TICK_FONT,
        // The size of the height line under a satellite's name.
        'text-size': 9.5,
        'text-offset': [0, -0.9],
        'text-keep-upright': true,
        'text-allow-overlap': true,
        'text-ignore-placement': false,
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': colors.water, 'text-halo-width': 1.6 },
    },
    {
      id: 'ss-marks',
      type: 'symbol',
      source: 'ss-marks',
      filter: ['in', ['get', 'kind'], ['literal', ['chevron', 'tick']]],
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
      id: 'ss-live-sight',
      type: 'line',
      source: 'ss-marks',
      filter: ['==', ['get', 'kind'], 'sight'],
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.9, 'line-dasharray': [2, 2] },
    },
    {
      id: 'ss-live-sight-label',
      type: 'symbol',
      source: 'ss-marks',
      filter: ['==', ['get', 'kind'], 'sight-label'],
      layout: {
        'symbol-placement': 'line-center',
        'text-field': ['get', 'label'],
        'text-font': TICK_FONT,
        // The size of the height line under a satellite's name.
        'text-size': 9.5,
        'text-offset': [0, -0.9],
        'text-keep-upright': true,
        'text-allow-overlap': true,
        'text-ignore-placement': false,
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': colors.water, 'text-halo-width': 1.6 },
    },
    {
      id: 'ss-observer',
      type: 'symbol',
      source: 'ss-observer',
      layout: { 'icon-image': 'ss-observer', 'icon-allow-overlap': true },
    },
    // The focus has its own layer on top: MapLibre places the top layer's
    // symbols first, so the focus name wins its place and other names make
    // room. The map draws the focused dot and name itself, moved every frame
    // (components/home/FlatMap.tsx), so this layer only holds that place.
    // Radio arcs round dots with known downlinks, under the dots. Normal dots
    // only: ghosts stay plain, and the map draws the focus mark itself.
    {
      id: 'ss-sats-radio',
      type: 'symbol',
      source: 'ss-sats',
      filter: ['all', ['==', ['get', 'radio'], true], ['==', ['get', 'emphasis'], 'normal']],
      layout: {
        'icon-image': 'ss-radio',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'sortKey'],
      },
      paint: {
        'icon-color': ['get', 'color'],
        'icon-halo-color': colors.water,
        'icon-halo-width': 1,
      },
    },
    satsLayer('ss-sats', ['!=', ['get', 'emphasis'], 'focus']),
    satsLayer('ss-sats-focus', ['==', ['get', 'emphasis'], 'focus'], false),
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

/** The radio mark: two arcs up and to the left of a dot, like a signal
 *  symbol, clear of the dot (radius 4) and its 2 px halo. Names sit to the
 *  right first, so the arcs keep out of their way. */
const RADIO_ARCS = [7, 10];
const RADIO_SPAN = 40 * RAD;
const RADIO_DIR = -135 * RAD;
function radioImage(id) {
  const w = 0.8;
  const size = 2 * Math.ceil(RADIO_ARCS[RADIO_ARCS.length - 1] + w + SDF_PAD);
  const c = size / 2;
  return sdfImage(id, size, (x, y) => {
    const dx = x - c;
    const dy = y - c;
    const r = Math.hypot(dx, dy);
    // How far round from the arcs' middle direction, 0 to pi.
    const t = Math.atan2(dy, dx) - RADIO_DIR;
    const a = Math.abs(Math.atan2(Math.sin(t), Math.cos(t)));
    let best = Infinity;
    for (const R of RADIO_ARCS) {
      if (a <= RADIO_SPAN) best = Math.min(best, Math.abs(r - R));
      else {
        // Past the arc's ends: the distance to the nearer end point.
        for (const end of [RADIO_DIR - RADIO_SPAN, RADIO_DIR + RADIO_SPAN]) {
          best = Math.min(best, Math.hypot(dx - R * Math.cos(end), dy - R * Math.sin(end)));
        }
      }
    }
    return w - best;
  });
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
    radioImage('ss-radio'),
    observerImage(colors.observer),
  ];
}
