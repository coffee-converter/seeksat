// lib/home/places.mjs - the home place and the last few places before it.

export const RECENT_MAX = 5;
export const SOURCES = ['gps', 'place', 'grid', 'coords'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function cleanLocation(v) {
  if (!isObj(v)) return null;
  if (!inRange(v.latDeg, -90, 90) || !inRange(v.lonDeg, -180, 180)) return null;
  if (!SOURCES.includes(v.source)) return null;
  const name = typeof v.name === 'string' ? v.name.slice(0, 120) : '';
  return { name, latDeg: v.latDeg, lonDeg: v.lonDeg, source: v.source };
}

/** Same spot: lat and lon equal to 4 decimals (about 10 m). */
export function samePlace(a, b) {
  if (!a || !b) return false;
  return a.latDeg.toFixed(4) === b.latDeg.toFixed(4) && a.lonDeg.toFixed(4) === b.lonDeg.toFixed(4);
}

/** Cleaned recent places, newest first, no duplicates, at most RECENT_MAX. */
export function cleanRecent(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const e of v) {
    const p = cleanLocation(e);
    if (p && !out.some((o) => samePlace(o, p))) out.push(p);
    if (out.length >= RECENT_MAX) break;
  }
  return out;
}

/** The location and recent list after choosing `location`: the old place
 *  moves to the front of recent; the current place is never in recent. */
export function withPlace(prefs, location) {
  const old = prefs.location;
  const rest = (prefs.recent ?? []).filter((p) => !samePlace(p, location));
  const recent = old && !samePlace(old, location) ? [old, ...rest] : rest;
  return { location, recent: recent.slice(0, RECENT_MAX) };
}
