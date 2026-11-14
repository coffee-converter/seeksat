// lib/mcp/radio-scan.mjs - "the best radio pass from anything with a known
// downlink", fast enough to run over every such satellite (about a thousand)
// in one MCP call.
//
// The full pass engine costs about 16 ms per satellite for a day, too much
// for hundreds. So the scan is two stages:
//   1. a coarse sweep per satellite: SGP4 and the elevation only, on a fixed
//      60 s grid, jumping ahead whenever the satellite is provably too far
//      round the Earth to rise before the jump ends. It gives each pass's
//      rough times and peak elevation.
//   2. the real engine (passes.mjs findPasses) only on the best few of those,
//      over a few minutes around each, for the exact times and scores.
// Stage 1 is the same for everyone near one place in one hour, so its result
// is kept in a small LRU cache.

import * as sat from 'satellite.js';
import { geodeticToEcef } from '../coords.js';
import { apparentAltDeg } from '../refraction.js';
import { radioBars } from '../passes/quality.mjs';
import { RECENCY_UNKNOWN } from '../reception/recency.mjs';

const DEG = Math.PI / 180;
const MU_KM3_S2 = 398_600.4418;
const OMEGA_EARTH_RAD_S = 7.292115855e-5;
const UNIX_EPOCH_JD = 2440587.5;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The coarse sweep's grid. The engine searches low orbits on the same 60 s
 *  step, so a pass too short to show on it would be missed by both. */
export const COARSE_STEP_MS = 60_000;
/** Stage 1 counts a pass from this many degrees below the asked minimum: it
 *  runs for the middle of a 0.25 degree cell, and the asker may be up to
 *  about 18 km from there, which moves a low orbit's elevation by up to a
 *  degree or two. Stage 2 applies the real minimum at the real place. */
export const COARSE_MARGIN_DEG = 2;
/** Grid size for sharing stage 1 between nearby askers, degrees. */
export const CELL_DEG = 0.25;
/** Minutes of padding around a rough pass for the exact search. */
const REFINE_PAD_MS = 2 * 60_000;

/** A small least-recently-used map. Values may be promises, so callers that
 *  ask for the same key at once share one computation. */
export function createLru(max = 32) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const v = map.get(key);
      map.delete(key);
      map.set(key, v);
      return v;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > max) map.delete(map.keys().next().value);
    },
    delete(key) { map.delete(key); },
    get size() { return map.size; },
  };
}

const snap = (deg) => Math.round(deg / CELL_DEG) * CELL_DEG;

/** The middle of the 0.25 degree cell holding a place. */
export function cellOf(latDeg, lonDeg) {
  return { latDeg: snap(latDeg), lonDeg: snap(lonDeg) };
}

/** Cache key for stage 1: the cell, the hour, and everything that changes
 *  which satellites and passes it finds. */
export function scanKey({ latDeg, lonDeg, hourMs, windowHours, minElevationDeg, bands, modes }) {
  const cell = cellOf(latDeg, lonDeg);
  const list = (xs) => (xs && xs.length ? [...xs].sort().join(',') : '*');
  return [cell.latDeg.toFixed(2), cell.lonDeg.toFixed(2), hourMs, windowHours, minElevationDeg, list(bands), list(modes)].join('|');
}

/**
 * The rough passes of one satellite over an observer: SGP4 and elevation
 * only, on the grid startMs + k * stepMs.
 *
 * Between samples it jumps ahead while the satellite cannot reach the
 * horizon circle in time: the angle between the observer and the satellite,
 * seen from Earth's centre, changes no faster than the satellite's fastest
 * angular motion plus Earth's spin, so if it is X too far round, it needs at
 * least X / rate to get here. Jumps land on grid points, so the samples are
 * a subset of a plain 60 s sweep and nothing that sweep would see is missed.
 *
 * jump: false samples every grid point (for checking the jumps).
 * @returns {{ unavailable: boolean, runs: Array<{ firstMs: number, lastMs: number,
 *   peakMs: number, peakElevDeg: number, peakRangeKm: number }>, samples: number }}
 *   firstMs and lastMs are the first and last grid points above minElevDeg.
 */
export function coarsePasses(satrec, observer, startMs, endMs, minElevDeg, { stepMs = COARSE_STEP_MS, jump = true } = {}) {
  const lat = observer.latDeg * DEG, lon = observer.lonDeg * DEG;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  const o = geodeticToEcef(observer.latDeg, observer.lonDeg, observer.elevM ?? 0).map((m) => m / 1000);
  const rObs = Math.hypot(o[0], o[1], o[2]);
  const epochJd = satrec.jdsatepoch + (satrec.jdsatepochF ?? 0);

  // Bounds for the jump: the farthest the satellite gets from Earth's centre
  // (a wider horizon circle) and its fastest angular motion (at perigee,
  // n (1 + e)^2 / (1 - e^2)^1.5), each with some slack for perturbations.
  const nRadS = satrec.no / 60;
  const e = Math.min(0.99, Math.max(0, satrec.ecco));
  const aKm = Math.cbrt(MU_KM3_S2 / (nRadS * nRadS));
  const rMaxKm = aKm * (1 + e) * 1.02;
  const rateRadMs = ((nRadS * (1 + e) ** 2) / (1 - e * e) ** 1.5 * 1.1 + OMEGA_EARTH_RAD_S) / 1000;
  // Horizon circle for an elevation a degree under the sweep's own threshold
  // (refraction and geodetic against geocentric up are both under a degree).
  const elB = Math.max(-5, minElevDeg - 1) * DEG;
  const psiMax = Math.acos(Math.min(1, (rObs / rMaxKm) * Math.cos(elB))) - elB;

  const runs = [];
  let run = null;
  let samples = 0;
  let unavailable = false;
  const close = () => {
    if (run) runs.push(run);
    run = null;
  };
  // Elevation in degrees at ms, or null when SGP4 fails; psi is set as a side
  // effect so the caller can jump.
  let psi = 0;
  let rangeKm = 0;
  const elevAt = (ms) => {
    const minutes = ((ms / DAY_MS + UNIX_EPOCH_JD) - epochJd) * 1440;
    const pv = sat.sgp4(satrec, minutes);
    if (!pv || !pv.position) return null;
    const g = sat.gstime(new Date(ms));
    const cg = Math.cos(g), sg = Math.sin(g);
    const p = pv.position;
    const x = p.x * cg + p.y * sg;
    const y = -p.x * sg + p.y * cg;
    const z = p.z;
    const r = Math.hypot(x, y, z);
    psi = Math.acos(Math.max(-1, Math.min(1, (x * o[0] + y * o[1] + z * o[2]) / (r * rObs))));
    const dx = x - o[0], dy = y - o[1], dz = z - o[2];
    rangeKm = Math.hypot(dx, dy, dz);
    const east = -sinLon * dx + cosLon * dy;
    const north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
    const up = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;
    return apparentAltDeg(Math.atan2(up, Math.hypot(east, north)) / DEG);
  };

  for (let t = startMs; t <= endMs;) {
    const el = elevAt(t);
    samples++;
    if (el == null) {
      // Not even the start propagates: the elements are no good. Later on it
      // has decayed; what came before still counts.
      if (t === startMs) unavailable = true;
      close();
      break;
    }
    if (el >= minElevDeg) {
      if (!run) run = { firstMs: t, lastMs: t, peakMs: t, peakElevDeg: el, peakRangeKm: rangeKm };
      run.lastMs = t;
      if (el > run.peakElevDeg) { run.peakElevDeg = el; run.peakMs = t; run.peakRangeKm = rangeKm; }
      t += stepMs;
      continue;
    }
    close();
    const gap = psi - psiMax;
    const skipMs = jump && gap > 0 ? Math.floor(gap / rateRadMs / stepMs) * stepMs : 0;
    t += Math.max(stepMs, skipMs);
  }
  close();
  // The grid's best sample can be well under the real peak of a high pass
  // (near the zenith a low orbit sweeps a degree a second), so narrow it.
  for (const r of runs) refinePeak(r, elevAt, stepMs, startMs, endMs, () => rangeKm);
  return { unavailable, runs, samples };
}

/** Golden-section search for the highest elevation within a step of the
 *  best grid sample; lastRangeKm reads the range elevAt last worked out. */
function refinePeak(run, elevAt, stepMs, startMs, endMs, lastRangeKm) {
  let lo = Math.max(startMs, run.peakMs - stepMs);
  let hi = Math.min(endMs, run.peakMs + stepMs);
  const k = (Math.sqrt(5) - 1) / 2;
  let a = hi - k * (hi - lo), b = lo + k * (hi - lo);
  let fa = elevAt(a) ?? -90, fb = elevAt(b) ?? -90;
  while (hi - lo > 500) {
    if (fa > fb) { hi = b; b = a; fb = fa; a = hi - k * (hi - lo); fa = elevAt(a) ?? -90; }
    else { lo = a; a = b; fa = fb; b = lo + k * (hi - lo); fb = elevAt(b) ?? -90; }
  }
  const best = fa > fb ? { ms: a, el: fa } : { ms: b, el: fb };
  if (best.el > run.peakElevDeg) {
    run.peakElevDeg = best.el;
    run.peakMs = Math.round(best.ms);
    elevAt(run.peakMs);
    run.peakRangeKm = lastRangeKm();
  }
}

/** A rough radio pass's score, ordered as the rows rank (tools.mjs
 *  byRadioRating): hearable first, then the radio bars (quality.mjs
 *  radioBars: height less range), then how recently it was heard (lower
 *  recency first), then the peak elevation as a share of 90 degrees. Each
 *  key outweighs every later one. The bars are counted from the elevation
 *  plus COARSE_MARGIN_DEG, so a rough pass near a threshold is never scored
 *  below what its exact pass could earn. */
export function roughScore(run, { hearable = true, recency = RECENCY_UNKNOWN } = {}) {
  const bars = radioBars(run.peakElevDeg + COARSE_MARGIN_DEG, run.peakRangeKm);
  return (hearable ? 1000 : 0) + bars * 10 + (4 - recency) * 2 + run.peakElevDeg / 90;
}

/** Start of the hour holding ms: stage 1 runs from there, so one result
 *  serves every ask in that hour. */
export function hourOf(ms) {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

/** A sweep hands the event loop back after this many satellites, so one
 *  long scan does not hold up every other request on the instance. */
export const SCAN_YIELD_EVERY = 16;

/** Let other work run (I/O, timers, other requests) before going on. */
export const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve));

/** Stage 1 cache keys: a window rounded up to whole hours (a longer sweep
 *  covers a shorter ask) and a minimum elevation rounded down to half a
 *  degree (a lower one finds every pass a higher one does), so asks that
 *  differ by a fraction share one sweep. The sweep runs on these values;
 *  stage 2 uses the exact ones. */
export function stageWindowHours(windowHours) {
  return Math.ceil(windowHours);
}
export function stageMinElevation(minElevationDeg) {
  return Math.floor(minElevationDeg * 2) / 2;
}

/**
 * Stage 1 over many satellites: [{ noradId, satrec, hearable?, recency? }]
 * in (see roughScore for the last two), every rough pass out, as [{ noradId, firstMs, lastMs, peakMs, peakElevDeg, score }], plus
 * the ids whose elements would not propagate. Yields to the event loop
 * every SCAN_YIELD_EVERY satellites.
 */
export async function coarseScan(sats, observer, startMs, endMs, minElevDeg) {
  const passes = [];
  const unavailable = [];
  let samples = 0;
  let i = 0;
  for (const { noradId, satrec, hearable, recency } of sats) {
    if (++i % SCAN_YIELD_EVERY === 0) await yieldToLoop();
    const r = coarsePasses(satrec, observer, startMs, endMs, minElevDeg);
    samples += r.samples;
    if (r.unavailable) { unavailable.push(noradId); continue; }
    for (const run of r.runs) passes.push({ noradId, ...run, score: roughScore(run, { hearable, recency }) });
  }
  return { passes, unavailable, samples };
}

/** Rough passes to check with the full engine: at least REFINE_MIN, at most
 *  REFINE_MAX, and every one scoring within REFINE_SLACK of the last place
 *  asked for, since the rough score can be that far off the real one. */
export const REFINE_MIN = 20;
export const REFINE_MAX = 150;
export const REFINE_SLACK = 0.05;

/** Rough passes in the order the real ones are ranked (radio): score (the
 *  peak elevation), then the longer, then the sooner. */
export function byRoughScore(a, b) {
  return (b.score - a.score) || ((b.lastMs - b.firstMs) - (a.lastMs - a.firstMs)) || (a.firstMs - b.firstMs);
}

/**
 * The best rough passes inside [startMs, endMs] (see REFINE_MIN) as windows
 * for the exact search: grouped per satellite, padded, clamped to the asked
 * window, and merged where they touch. `compare` orders the rough passes
 * best first (radio: byRoughScore); `slack` is how far below the last place
 * asked for (in score units) a rough pass may score and still be checked.
 * @returns {Map<number, Array<{ startMs: number, endMs: number }>>}
 */
export function refineWindows(passes, startMs, endMs, limit, compare = byRoughScore, slack = REFINE_SLACK) {
  const inWindow = passes.filter((p) => p.lastMs + COARSE_STEP_MS > startMs && p.firstMs - COARSE_STEP_MS < endMs);
  inWindow.sort(compare);
  const floor = (inWindow[Math.min(limit, inWindow.length) - 1]?.score ?? 0) - slack;
  let count = REFINE_MIN;
  while (count < inWindow.length && count < REFINE_MAX && inWindow[count].score >= floor) count++;
  const out = new Map();
  for (const p of inWindow.slice(0, count)) {
    const w = {
      startMs: Math.max(startMs, p.firstMs - COARSE_STEP_MS - REFINE_PAD_MS),
      endMs: Math.min(endMs, p.lastMs + COARSE_STEP_MS + REFINE_PAD_MS),
    };
    if (w.endMs <= w.startMs) continue;
    const list = out.get(p.noradId) ?? [];
    list.push(w);
    out.set(p.noradId, list);
  }
  for (const [id, list] of out) {
    list.sort((a, b) => a.startMs - b.startMs);
    const merged = [];
    for (const w of list) {
      const last = merged[merged.length - 1];
      if (last && w.startMs <= last.endMs) last.endMs = Math.max(last.endMs, w.endMs);
      else merged.push({ ...w });
    }
    out.set(id, merged);
  }
  return out;
}
