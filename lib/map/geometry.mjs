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
const clampLon = (lon) => Math.max(-180, Math.min(180, lon));

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}

// Date-line cuts (180 + 360k) a segment from unwrapped lon a to b passes, in
// travel order. Half-open, so a vertex sitting on a cut counts once.
function cutsBetween(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const cuts = [];
  for (let k = Math.floor((lo - 180) / 360) + 1; 180 + 360 * k <= hi; k++) cuts.push(180 + 360 * k);
  return a <= b ? cuts : cuts.reverse();
}

function cutPoint(p, q, c) {
  const t = (c - p[0]) / (q[0] - p[0]);
  return [c, p[1] + t * (q[1] - p[1])];
}

// A ring that winds no pole: split it into arcs at each cut, close each arc
// along its cut, and shift each into [-180, 180].
function cutPieces(u) {
  const loop = [...u, u[0]];
  const pieces = [];
  let current = [];
  for (let i = 0; i < u.length; i++) {
    const p = loop[i], q = loop[i + 1];
    current.push(p);
    for (const c of cutsBetween(p[0], q[0])) {
      const x = cutPoint(p, q, c);
      current.push(x);
      pieces.push(current);
      current = [x];
    }
  }
  if (pieces.length) pieces[0] = current.concat(pieces[0]);
  else pieces.push(current);
  return pieces.map((piece) => {
    const mean = piece.reduce((s, p) => s + p[0], 0) / piece.length;
    const shift = -360 * Math.floor((mean + 180) / 360);
    return piece.map(([lon, lat]) => [clampLon(lon + shift), lat]);
  });
}

// A ring that winds a pole: open it at its one date-line cut so it runs from
// one edge of the map to the other, then close it along the pole.
function polarPiece(u, turn, poleLat) {
  const m = u.length;
  const at = (i) => [u[i % m][0] + Math.floor(i / m) * turn, u[i % m][1]];
  for (let j = 0; j < m; j++) {
    const p = at(j), q = at(j + 1);
    const [c] = cutsBetween(p[0], q[0]);
    if (c === undefined) continue;
    const start = cutPoint(p, q, c);
    const east = turn > 0;
    const shift = (east ? -180 : 180) - c;
    const path = [start];
    for (let i = j + 1; i <= j + m; i++) path.push(at(i));
    const shifted = path.map(([lon, lat]) => [clampLon(lon + shift), lat]);
    const from = east ? -180 : 180;
    return [
      [from, start[1]], ...shifted.slice(1), [-from, start[1]], [-from, poleLat], [from, poleLat],
    ];
  }
  throw new Error('a ring that winds a pole must cross the date line');
}

/**
 * Turns a closed spherical ring (as from geoCircle) into a GeoJSON MultiPolygon
 * MapLibre fills correctly: longitudes in [-180, 180], cut at the date line,
 * closed along the pole a ring winds around, outer rings counter-clockwise.
 */
export function mapPolygons(ring) {
  const pts = ring.slice();
  const first = pts[0], last = pts.at(-1);
  if (pts.length > 1 && Math.abs(wrapLon(last[0] - first[0])) < 1e-9 && Math.abs(last[1] - first[1]) < 1e-9) {
    pts.pop();
  }
  const u = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i < pts.length; i++) u.push([u[i - 1][0] + wrapLon(pts[i][0] - pts[i - 1][0]), pts[i][1]]);
  const turn = u.at(-1)[0] + wrapLon(pts[0][0] - pts.at(-1)[0]) - u[0][0];
  let pieces;
  if (Math.abs(turn) > 180) {
    // Winds a full 360: it holds the pole on the side of its centre.
    const centreLat = geoCentroid({ type: 'Polygon', coordinates: [ring] })[1];
    pieces = [polarPiece(u, 360 * Math.sign(turn), centreLat < 0 ? -90 : 90)];
  } else {
    pieces = cutPieces(u);
  }
  const coordinates = [];
  for (const piece of pieces) {
    const closed = [...piece, piece[0].slice()];
    const area = signedArea(closed);
    if (Math.abs(area) < 1e-10) continue; // a ring only touching the date line leaves a sliver
    coordinates.push([area < 0 ? closed.reverse() : closed]);
  }
  return { type: 'MultiPolygon', coordinates };
}

// Samples [startMs, endMs] into antimeridian-cut lines. Shared by splitTrack.
function sampleLines(track, startMs, endMs, steps) {
  const lines = [];
  let line = null;
  for (let i = 0; i <= steps; i++) {
    const ecef = track.ecefAt(new Date(startMs + ((endMs - startMs) * i) / steps));
    if (!ecef) continue;
    const { latDeg, lonDeg } = subpoint(ecef);
    if (line && Math.abs(lonDeg - line[line.length - 1][0]) > 180) line = null;
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
