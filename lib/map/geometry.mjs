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

/** The same ring as one continuous line for outlining it (longitudes as in mapPolygons). */
// MapLibre's tiles stop at Mercator's limit; points past it are squashed onto
// it, which drags a line round the pole (a lobe on the globe). Lines are cut
// there instead: the globe's own polar cap covers the rest.
const TILE_LAT = 85.0511;

function clipToTiles(line) {
  const out = [];
  let cur = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const inside = Math.abs(p[1]) <= TILE_LAT;
    const prev = line[i - 1];
    if (prev) {
      const prevIn = Math.abs(prev[1]) <= TILE_LAT;
      if (prevIn !== inside) {
        const edge = Math.sign(inside ? prev[1] : p[1]) * TILE_LAT;
        const f = (edge - prev[1]) / (p[1] - prev[1]);
        const cross = [prev[0] + (p[0] - prev[0]) * f, edge];
        if (prevIn) { cur.push(cross); out.push(cur); cur = []; } else cur.push(cross);
      }
    }
    if (inside) cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out.filter((l) => l.length >= 2);
}

export function ringLine(ring) {
  const { points, turn } = unwrapRing(ring);
  return { type: 'MultiLineString', coordinates: clipToTiles([...points, [points[0][0] + turn, points[0][1]]]) };
}

// Samples [startMs, endMs] into antimeridian-cut lines. A line that crosses
// ends on the date line and the next starts there, so no gap shows. Shared by
// splitTrack.
function sampleLines(track, startMs, endMs, steps) {
  const lines = [];
  let line = null;
  for (let i = 0; i <= steps; i++) {
    const ecef = track.ecefAt(new Date(startMs + ((endMs - startMs) * i) / steps));
    if (!ecef) continue;
    const { latDeg, lonDeg } = subpoint(ecef);
    const prev = line?.at(-1);
    if (prev && Math.abs(lonDeg - prev[0]) > 180) {
      const edge = prev[0] > 0 ? 180 : -180;
      const lon = lonDeg + 2 * edge; // the same point, unwrapped past the edge
      const lat = prev[1] + ((edge - prev[0]) / (lon - prev[0])) * (latDeg - prev[1]);
      line.push([edge, lat]);
      line = [[-edge, lat]];
      lines.push(line);
    }
    if (!line) { line = []; lines.push(line); }
    line.push([lonDeg, latDeg]);
  }
  return { type: 'MultiLineString', coordinates: lines };
}

export function groundTrack(track, nowMs, { steps = 240 } = {}) {
  const geo = track.orbitClass === 'geo';
  const start = geo ? nowMs - 12 * HOUR_MS : nowMs - 0.25 * track.periodMs;
  const end = geo ? nowMs + 12 * HOUR_MS : nowMs + track.periodMs;
  return sampleLines(track, start, end, steps);
}

/** Minutes between time ticks on a ground track: 10 under a 3 h period, else 60. */
export function tickStepMin(periodMs) {
  return periodMs < 3 * HOUR_MS ? 10 : 60;
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
  const past = sampleLines(track, nowMs - pastMs, nowMs, pastSteps);
  const future = sampleLines(track, nowMs, nowMs + futureMs, futureSteps);
  const stepMin = tickStepMin(track.periodMs);
  const ticks = [];
  for (let m = stepMin; m * 60_000 <= futureMs; m += stepMin) {
    const ecef = track.ecefAt(new Date(nowMs + m * 60_000));
    if (!ecef) continue;
    const { latDeg, lonDeg } = subpoint(ecef);
    ticks.push({ lonDeg, latDeg, minutes: m });
  }
  return { past, future, ticks };
}

// Ground tracks are sampled every ~30 s; drawn straight between samples they
// show corners once the map is zoomed in. densifyLine curves through the
// samples with a Catmull-Rom spline on unit vectors (so it behaves the same
// near the poles), adding factor - 1 points per segment. The samples are
// evenly spaced in time, which is what uniform Catmull-Rom assumes.
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
const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return p1.map((_, k) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t
    + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
    + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3));
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

/** Points per track segment for a zoom: a segment's bulge shrinks with the
 *  square of the split, while each zoom level doubles the pixels, so the split
 *  grows by sqrt(2) a level from zoom 5 and stays under a pixel. */
export function trackDetailFor(zoom) {
  return Math.max(1, Math.min(64, Math.ceil(2 ** ((zoom - 5) / 2))));
}
