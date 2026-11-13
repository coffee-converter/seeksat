// Pure geometry for the map: subpoints, footprints, night bands, ground tracks.
import { geoCentroid, geoCircle } from 'd3-geo';
import { ecefToGeodetic } from '../coords.js';
import { sunPositionEcef } from '../pass-finder/sun.js';

export const EARTH_RADIUS_KM = 6371.0088;

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const HOUR_MS = 3_600_000;

export function subpoint(ecef) {
  const g = ecefToGeodetic(ecef[0], ecef[1], ecef[2]);
  return { latDeg: g.latDeg, lonDeg: g.lonDeg, altKm: g.elevM / 1000 };
}

export function footprintRadiusDeg(altKm, minElevDeg = 0) {
  const eps = minElevDeg * RAD;
  const R = EARTH_RADIUS_KM;
  return (Math.acos((R / (R + altKm)) * Math.cos(eps)) - eps) * DEG;
}

export function subsolarPoint(date) {
  const [x, y, z] = sunPositionEcef(date);
  return { latDeg: Math.asin(z) * DEG, lonDeg: Math.atan2(y, x) * DEG };
}

function circle(lonDeg, latDeg, radiusDeg) {
  return geoCircle().center([lonDeg, latDeg]).radius(radiusDeg)();
}

// Sun altitude thresholds: horizon, civil, nautical, astronomical twilight.
// sunBelowDeg is the (negative) sun altitude; a circle on the antisolar point
// with radius 90 + sunBelowDeg covers where the sun is below that altitude.
export function nightBands(date) {
  const s = subsolarPoint(date);
  const anti = { lat: -s.latDeg, lon: s.lonDeg + 180 };
  return [0, -6, -12, -18].map((sunBelowDeg) => ({
    sunBelowDeg,
    feature: circle(anti.lon, anti.lat, 90 + sunBelowDeg),
  }));
}

/** A circle of radiusDeg around a point as one closed line, longitudes
 *  continuous across the date line (MapLibre wraps them). */
export function circleLine(lonDeg, latDeg, radiusDeg) {
  const { points } = unwrapRing(circle(lonDeg, latDeg, radiusDeg).coordinates[0]);
  return [...points, points[0]];
}

export function footprintFeature(sub, altKm, minElevDeg = 0) {
  return circle(sub.lonDeg, sub.latDeg, footprintRadiusDeg(altKm, minElevDeg));
}

const wrapLon = (d) => d - 360 * Math.round(d / 360);
const onDateLine = (lon) => Math.abs(Math.abs(wrapLon(lon)) - 180) < 1e-9;

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}

/**
 * A closed spherical ring (as from geoCircle) with continuous longitudes: no
 * step between neighbours is over 180, so a ring across the date line runs on
 * past +-180 instead of jumping. Open (no repeated first point), starting at a
 * vertex off the date line, wrapped into [-180, 180]. turn is how far the
 * longitude runs over one lap: 0, or +-360 for a ring that winds a pole.
 */
function unwrapRing(ring) {
  const pts = ring.slice();
  const first = pts[0], last = pts.at(-1);
  if (pts.length > 1 && Math.abs(wrapLon(last[0] - first[0])) < 1e-9 && Math.abs(last[1] - first[1]) < 1e-9) {
    pts.pop();
  }
  const start = Math.max(0, pts.findIndex((p) => !onDateLine(p[0])));
  const order = [...pts.slice(start), ...pts.slice(0, start)];
  const points = [[wrapLon(order[0][0]), order[0][1]]];
  for (let i = 1; i < order.length; i++) {
    points.push([points[i - 1][0] + wrapLon(order[i][0] - order[i - 1][0]), order[i][1]]);
  }
  const lap = points.at(-1)[0] + wrapLon(order[0][0] - order.at(-1)[0]) - points[0][0];
  return { points, turn: 360 * Math.round(lap / 360) };
}

/**
 * Turns a closed spherical ring (as from geoCircle) into a one-polygon GeoJSON
 * MultiPolygon MapLibre fills correctly. Longitudes stay continuous, running
 * past +-180 (within +-540) where the ring crosses the date line; MapLibre
 * wraps them onto the other side and clips them per tile, so no polygon edge
 * lies on the date line and no seam shows there. A ring that winds a pole
 * runs one full turn and closes along that pole, starting off the date line.
 * The outer ring is counter-clockwise.
 */
export function mapPolygons(ring) {
  const { points, turn } = unwrapRing(ring);
  const [x0, y0] = points[0];
  let outer = [...points];
  if (turn !== 0) {
    // Winds a full 360: it holds the pole on the side of its centre.
    const centreLat = geoCentroid({ type: 'Polygon', coordinates: [ring] })[1];
    const poleLat = centreLat < 0 ? -90 : 90;
    outer.push([x0 + turn, y0], [x0 + turn, poleLat], [x0, poleLat]);
  }
  outer.push([x0, y0]);
  if (signedArea(outer) < 0) outer = outer.reverse();
  return { type: 'MultiPolygon', coordinates: [[outer]] };
}

// The most ground a track step may cover. Evenly timed steps stay well under
// it on low orbits; a highly elliptical one (Molniya, SMILE) races over the
// ground near perigee, so those steps are halved until they fit.
const MAX_STEP_DEG = 2.5;
const MAX_SPLITS = 8;
// Around the dot the track is sampled this finely, so the curve drawn through
// the samples passes under the dot even at street level (minutes-apart samples
// left it a few hundred metres off there). The track is rebuilt every minute,
// so the window covers the minute ahead with room to spare.
const NEAR_STEP_DEG = 0.1;
const NEAR_BEFORE_MS = 30_000;
const NEAR_AFTER_MS = 120_000;

const unitOf = (latDeg, lonDeg) => [
  Math.cos(latDeg * RAD) * Math.cos(lonDeg * RAD), Math.cos(latDeg * RAD) * Math.sin(lonDeg * RAD), Math.sin(latDeg * RAD),
];
const arcDeg = (a, b) => {
  const p = unitOf(a.latDeg, a.lonDeg), q = unitOf(b.latDeg, b.lonDeg);
  return Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]))) / RAD;
};

/** The subpoint at ms, or null where the propagator has none. */
function sampleAt(track, ms) {
  const ecef = track.ecefAt(new Date(ms));
  return ecef ? { ms, ...subpoint(ecef) } : null;
}

/** Samples strictly between a and b, halving until each step fits MAX_STEP_DEG,
 *  or NEAR_STEP_DEG where the step overlaps the near window. */
function between(track, a, b, depth, out, near) {
  const max = near && a.ms < near.to && b.ms > near.from ? NEAR_STEP_DEG : MAX_STEP_DEG;
  if (depth >= MAX_SPLITS || arcDeg(a, b) <= max) return;
  const m = sampleAt(track, (a.ms + b.ms) / 2);
  if (!m) return;
  between(track, a, m, depth + 1, out, near);
  out.push(m);
  between(track, m, b, depth + 1, out, near);
}

// Samples [startMs, endMs] into antimeridian-cut lines, `steps` even steps
// with extra samples where the ground moves fast. A line that crosses ends on
// the date line and the next starts there, so no gap shows. `times` runs
// parallel to `coordinates`: each point's time in ms, for fading the track by
// time rather than by point count. Shared by splitTrack.
function sampleLines(track, startMs, endMs, steps, near = null) {
  const samples = [];
  for (let i = 0; i <= steps; i++) {
    const s = sampleAt(track, startMs + ((endMs - startMs) * i) / steps);
    if (!s) continue;
    const prev = samples.at(-1);
    if (prev) between(track, prev, s, 0, samples, near);
    samples.push(s);
  }
  const lines = [];
  const times = [];
  let line = null;
  let lineTimes = null;
  for (const { ms, latDeg, lonDeg } of samples) {
    const prev = line?.at(-1);
    if (prev && Math.abs(lonDeg - prev[0]) > 180) {
      const edge = prev[0] > 0 ? 180 : -180;
      const lon = lonDeg + 2 * edge; // the same point, unwrapped past the edge
      const f = (edge - prev[0]) / (lon - prev[0]);
      const lat = prev[1] + f * (latDeg - prev[1]);
      const edgeMs = lineTimes.at(-1) + f * (ms - lineTimes.at(-1));
      line.push([edge, lat]);
      lineTimes.push(edgeMs);
      line = [[-edge, lat]];
      lineTimes = [edgeMs];
      lines.push(line);
      times.push(lineTimes);
    }
    if (!line) { line = []; lineTimes = []; lines.push(line); times.push(lineTimes); }
    line.push([lonDeg, latDeg]);
    lineTimes.push(ms);
  }
  return { type: 'MultiLineString', coordinates: lines, times };
}

export function groundTrack(track, nowMs, { steps = 240 } = {}) {
  const geo = track.orbitClass === 'geo';
  const start = geo ? nowMs - 12 * HOUR_MS : nowMs - 0.25 * track.periodMs;
  const end = geo ? nowMs + 12 * HOUR_MS : nowMs + track.periodMs;
  return sampleLines(track, start, end, steps);
}

/** The ground path of one pass, rise to set, as antimeridian-cut lines. */
export function passLine(track, startMs, endMs, { steps = 60 } = {}) {
  const { type, coordinates, times } = sampleLines(track, startMs, endMs, steps);
  const keep = coordinates.map((l) => l.length >= 2);
  return { type, coordinates: coordinates.filter((_, i) => keep[i]), times: times.filter((_, i) => keep[i]) };
}

/** A great-circle line from a to b ([lon, lat]), n segments, for a line that
 *  curves on the globe. Longitudes stay continuous (may pass +-180). */
export function greatCircle(a, b, n = 24) {
  const va = toVecLL(a);
  const vb = toVecLL(b);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const w = Math.acos(dot);
  if (w < 1e-9) return [a, b];
  const out = [];
  let prevLon = a[0];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const k1 = Math.sin((1 - t) * w) / Math.sin(w);
    const k2 = Math.sin(t * w) / Math.sin(w);
    const v = [0, 1, 2].map((j) => k1 * va[j] + k2 * vb[j]);
    const lat = Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD;
    let lon = Math.atan2(v[1], v[0]) / RAD;
    while (lon - prevLon > 180) lon -= 360;
    while (prevLon - lon > 180) lon += 360;
    prevLon = lon;
    out.push([lon, lat]);
  }
  return out;
}
const toVecLL = ([lon, lat]) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];

/** Minutes between time ticks on a ground track: 10 under a 3 h period, else 60. */
export function tickStepMin(periodMs) {
  return periodMs < 3 * HOUR_MS ? 10 : 60;
}

/** The future window of a ground track: +-12 h for GEO, else one period. */
const futureWindowMs = (track) => (track.orbitClass === 'geo' ? 12 * HOUR_MS : track.periodMs);

/**
 * Time ticks on the future track relative to nowMs: sub-points at +step,
 * +2 step, ... minutes (tickStepMin) up to the end of the drawn future line.
 * That line starts at lineFromMs (redrawn once a minute, so it can be up to a
 * minute behind the clock) and runs one future window. Cheap enough to redo
 * every second.
 */
export function trackTicks(track, nowMs, lineFromMs = nowMs) {
  const stepMin = tickStepMin(track.periodMs);
  const futureMs = futureWindowMs(track);
  const endMs = Math.min(lineFromMs, nowMs) + futureMs;
  const ticks = [];
  for (let m = stepMin; nowMs + m * 60_000 <= endMs; m += stepMin) {
    const ecef = track.ecefAt(new Date(nowMs + m * 60_000));
    if (!ecef) continue;
    const { latDeg, lonDeg } = subpoint(ecef);
    ticks.push({ lonDeg, latDeg, minutes: m });
  }
  return ticks;
}

/**
 * groundTrack split at nowMs: past (-1/4 orbit to now), future (now to +1 orbit;
 * GEO is +-12 h), and time ticks on the future part (every 10 min when the
 * period is under 3 h, else hourly). Both parts include the now point.
 */
export function splitTrack(track, nowMs, { steps = 240 } = {}) {
  const geo = track.orbitClass === 'geo';
  const pastMs = geo ? 12 * HOUR_MS : 0.25 * track.periodMs;
  const futureMs = geo ? 12 * HOUR_MS : track.periodMs;
  const pastSteps = Math.max(2, Math.round((steps * pastMs) / (pastMs + futureMs)));
  const futureSteps = Math.max(2, steps - pastSteps);
  const near = { from: nowMs - NEAR_BEFORE_MS, to: nowMs + NEAR_AFTER_MS };
  const past = sampleLines(track, nowMs - pastMs, nowMs, pastSteps, near);
  const future = sampleLines(track, nowMs, nowMs + futureMs, futureSteps, near);
  const ticks = trackTicks(track, nowMs);
  return { past, future, ticks };
}

// Ground tracks are sampled every ~30 s on low orbits; drawn straight between
// samples they show corners once the map is zoomed in. densifyLine curves
// through the samples with a centripetal Catmull-Rom spline on unit vectors
// (so it behaves the same near the poles), adding factor - 1 points per
// segment. Centripetal, because the samples are not evenly spaced on the
// ground (a highly elliptical orbit's speed varies tenfold, and extra samples
// are added where it is fast): the uniform form overshoots and bends sharply
// at every sample when neighbouring steps differ in length.
const toVec = ([lon, lat]) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
function toLonLat(v, nearLon) {
  const r = Math.hypot(v[0], v[1], v[2]);
  const lat = Math.asin(Math.max(-1, Math.min(1, v[2] / r))) / RAD;
  let lon = Math.atan2(v[1], v[0]) / RAD;
  // Stay on the input's side of the date line (its lines end at +-180).
  if (lon - nearLon > 180) lon -= 360;
  else if (nearLon - lon > 180) lon += 360;
  return [Math.max(-180, Math.min(180, lon)), lat];
}
const lerp = (a, b, ta, tb, t) => {
  const w = tb === ta ? 0 : (t - ta) / (tb - ta);
  return a.map((x, k) => x + (b[k] - x) * w);
};
/** Centripetal Catmull-Rom (Barry and Goldman's form) between p1 and p2, at u in [0, 1]. */
const catmull = (p0, p1, p2, p3, u) => {
  // Knot spacing: the square root of each chord, floored so repeated points
  // never divide by zero.
  const knot = (a, b) => Math.max(1e-9, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
  const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const a1 = lerp(p0, p1, t0, t1, t), a2 = lerp(p1, p2, t1, t2, t), a3 = lerp(p2, p3, t2, t3, t);
  const b1 = lerp(a1, a2, t0, t2, t), b2 = lerp(a2, a3, t1, t3, t);
  return lerp(b1, b2, t1, t2, t);
};

/** A [lon, lat] line with factor - 1 curved points added in each segment. */
export function densifyLine(coords, factor) {
  if (factor <= 1 || coords.length < 2) return coords;
  const v = coords.map(toVec);
  const at = (i) => {
    if (i < 0) return v[0].map((x, k) => 2 * x - v[1][k]);
    if (i >= v.length) return v[v.length - 1].map((x, k) => 2 * x - v[v.length - 2][k]);
    return v[i];
  };
  const out = [coords[0]];
  for (let i = 0; i < v.length - 1; i++) {
    for (let s = 1; s < factor; s++) {
      out.push(toLonLat(catmull(at(i - 1), v[i], v[i + 1], at(i + 2), s / factor), out[out.length - 1][0]));
    }
    out.push(coords[i + 1]);
  }
  return out;
}

// The stretch is capped so the pole itself gives a finite split.
const MIN_COS_LAT = 0.1;

/** Points per track segment for a zoom and the view's centre latitude: a
 *  segment's bulge shrinks with the square of the split, while each zoom level
 *  doubles the pixels, so the split grows by sqrt(2) a level from zoom 3 and
 *  stays under a pixel. Both views stretch the map by 1 / cos(latitude), so
 *  near the poles the same step is longer on screen and counts as more zoom. */
export function trackDetailFor(zoom, latDeg = 0) {
  const stretch = 1 / Math.max(MIN_COS_LAT, Math.cos(latDeg * RAD));
  const z = zoom + Math.log2(stretch);
  return Math.max(1, Math.min(64, Math.ceil(2 ** ((z - 3) / 2))));
}
