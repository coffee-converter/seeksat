// lib/mcp/sky.mjs - every satellite the catalog knows, at one instant, as
// seen from one place: for "what's up now?" and "what was that light?".
//
// One SGP4 step per satellite per instant, so the whole catalog (about
// 15,000 objects) takes a fraction of a second. Satrecs are built once per
// catalog list (the reader hands out one list per snapshot) and kept.

import * as sat from 'satellite.js';
import { CATALOG } from '../catalog.mjs';
import { satrecFromRecord } from '../sat/satrec.mjs';
import { geodeticToEcef } from '../coords.js';
import { apparentAltDeg } from '../refraction.js';
import { sunPositionEcef } from '../pass-finder/sun.js';
import { sunAltitudeDeg, sunlitFraction } from '../pass-finder/visibility.js';
import { magnitudeAt } from '../pass-finder/ratings.js';
import { extinctionMag } from '../sky/visual-rating.mjs';
import { UNKNOWN_STD_MAG } from '../passes/engine.mjs';

const DEG = Math.PI / 180;
const DAY_MS = 86_400_000;
const UNIX_EPOCH_JD = 2440587.5;
/** The sky counts as dark for naked-eye satellites with the Sun this far
 *  down, as in the pass search (visibility.js isVisibleAtAll). */
export const DARK_SUN_ALT_DEG = -6;

const CURATED = new Map(CATALOG.map((c) => [c.noradId, c]));
const prepared = new WeakMap();

/**
 * The catalog list ([{ noradId, record, downlinks }], from the reader's
 * skyCatalog) with a satrec each, the curated name, standard magnitude and
 * tier where there is one. Elements that do not even initialise are left out.
 * Cached per list object.
 */
export function prepareSky(list) {
  let out = prepared.get(list);
  if (out) return out;
  out = [];
  for (const item of list ?? []) {
    let satrec;
    try { satrec = satrecFromRecord(item.record); } catch { continue; }
    if (!satrec || satrec.error) continue;
    const c = CURATED.get(item.noradId);
    out.push({
      noradId: item.noradId,
      name: c?.name ?? (item.record.name || `NORAD ${item.noradId}`),
      standardMag: Number.isFinite(c?.standardMag) ? c.standardMag : null,
      // The curated tier wins; a catalog item may carry its own otherwise.
      tier: c?.tier ?? item.tier ?? 'free',
      downlinks: Array.isArray(item.downlinks) ? item.downlinks : [],
      satrec,
      epochJd: satrec.jdsatepoch + (satrec.jdsatepochF ?? 0),
    });
  }
  if (list && typeof list === 'object') prepared.set(list, out);
  return out;
}

/** Earth-fixed position (m) of a prepared satellite at ms, given the sidereal
 *  angle for that instant (shared by every satellite), or null. */
export function ecefAt(s, ms, gmst) {
  const minutes = ((ms / DAY_MS + UNIX_EPOCH_JD) - s.epochJd) * 1440;
  const pv = sat.sgp4(s.satrec, minutes);
  if (!pv || !pv.position) return null;
  const c = Math.cos(gmst), sn = Math.sin(gmst);
  const p = pv.position;
  return [(p.x * c + p.y * sn) * 1000, (-p.x * sn + p.y * c) * 1000, p.z * 1000];
}

/** Azimuth, apparent elevation and range of an Earth-fixed point from the
 *  observer, with the observer's frame worked out once. */
export function observerFrame(observer) {
  const lat = observer.latDeg * DEG, lon = observer.lonDeg * DEG;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  const o = geodeticToEcef(observer.latDeg, observer.lonDeg, observer.elevM ?? 0);
  return (p) => {
    const dx = p[0] - o[0], dy = p[1] - o[1], dz = p[2] - o[2];
    const e = -sinLon * dx + cosLon * dy;
    const n = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
    const u = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;
    let az = Math.atan2(e, n) / DEG;
    if (az < 0) az += 360;
    return { azDeg: az, elDeg: apparentAltDeg(Math.atan2(u, Math.hypot(e, n)) / DEG), rangeM: Math.hypot(dx, dy, dz) };
  };
}

/** Every prepared satellite above minElDeg at ms: [{ sat, ecef, azDeg,
 *  elDeg, rangeM }], plus how many propagated at all. */
export function skyAt(sats, observer, ms, minElDeg) {
  const look = observerFrame(observer);
  const gmst = sat.gstime(new Date(ms));
  const up = [];
  let propagated = 0;
  for (const s of sats) {
    const ecef = ecefAt(s, ms, gmst);
    if (!ecef) continue;
    propagated++;
    const v = look(ecef);
    if (v.elDeg >= minElDeg) up.push({ sat: s, ecef, ...v });
  }
  return { up, propagated };
}

/** The observer's Sun altitude (apparent, degrees) and whether the sky is
 *  dark enough for naked-eye satellites. */
export function skyDarkness(observer, ms) {
  const sunAltDeg = apparentAltDeg(sunAltitudeDeg(observer, new Date(ms)));
  return { sunAltDeg, dark: sunAltDeg <= DARK_SUN_ALT_DEG };
}

/** Sunlight and brightness of a satellite at one instant: how lit it is
 *  (0 in Earth's shadow), and its extinction-corrected magnitude, estimated
 *  from a small satellite's size (UNKNOWN_STD_MAG) when its own is not known.
 *  The magnitude is null in shadow or when only its dark side faces us. */
export function brightnessAt(s, observer, ecef, ms, elDeg) {
  const sunDir = sunPositionEcef(new Date(ms));
  const lit = sunlitFraction(ecef, sunDir);
  const estimated = s.standardMag == null;
  const m = lit > 0 ? magnitudeAt(observer, ecef, sunDir, estimated ? UNKNOWN_STD_MAG : s.standardMag, lit) : null;
  return {
    sunlit: lit > 0,
    magnitude: m == null ? null : m + extinctionMag(elDeg, observer.elevM ?? 0),
    magnitudeEstimated: estimated,
  };
}

const POINTS16 = ['n', 'nne', 'ne', 'ene', 'e', 'ese', 'se', 'sse', 's', 'ssw', 'sw', 'wsw', 'w', 'wnw', 'nw', 'nnw'];

/** Degrees from north for a compass word: "NE", "nne", "north-east",
 *  "Northeast", "westward". Null for anything else. */
export function parseCompass(word) {
  if (typeof word !== 'string') return null;
  const s = word.trim().toLowerCase().replace(/wards?$/, '').replace(/[^a-z]/g, '')
    .replace(/north/g, 'n').replace(/south/g, 's').replace(/east/g, 'e').replace(/west/g, 'w');
  const i = POINTS16.indexOf(s);
  return i < 0 ? null : i * 22.5;
}

/** Angle between two directions in the sky, degrees. */
export function angularSeparationDeg(az1, el1, az2, el2) {
  const a1 = az1 * DEG, e1 = el1 * DEG, a2 = az2 * DEG, e2 = el2 * DEG;
  const c = Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos(a1 - a2);
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

/** Smallest difference between two bearings, 0 to 180 degrees. */
export function bearingDiffDeg(a, b) {
  const d = (((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

const unitEnu = (azDeg, elDeg) => {
  const a = azDeg * DEG, e = elDeg * DEG;
  return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
};

/** Which way a satellite is moving across the sky, as a compass bearing:
 *  the level part of its change in direction between two looks (before and
 *  after). Something rising in the south-west and climbing overhead is
 *  heading north-east, as an observer would say. */
export function travelBearingDeg(before, after) {
  const u0 = unitEnu(before.azDeg, before.elDeg);
  const u1 = unitEnu(after.azDeg, after.elDeg);
  let b = Math.atan2(u1[0] - u0[0], u1[1] - u0[1]) / DEG;
  if (b < 0) b += 360;
  return b;
}
