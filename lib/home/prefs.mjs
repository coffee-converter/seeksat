// lib/home/prefs.mjs - device-only home screen preferences. Storage can be
// missing, full or corrupt; nothing here throws.

import { parseElements } from '../sat/elements.mjs';
import { PROJECTIONS, DEFAULT_PROJECTION } from '../map/projections.mjs';

export const POPULAR_IDS = [25544, 48274, 57166, 33591];
export const PREFS_KEY = 'seeksat.home.v1';
export const MAX_FOLLOWING = 20;
export const MAX_CUSTOM = 10;
export const MAX_EXTRA_OBSERVERS = 3;
const SOURCES = ['gps', 'place', 'grid', 'coords'];

export function defaultPrefs() {
  return {
    location: null,
    following: [...POPULAR_IDS],
    custom: [],
    mode: 'radio',
    minElevDeg: 10,
    projection: DEFAULT_PROJECTION,
    observers: [],
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

function cleanLocation(v) {
  if (!isObj(v)) return null;
  if (!inRange(v.latDeg, -90, 90) || !inRange(v.lonDeg, -180, 180)) return null;
  if (!SOURCES.includes(v.source)) return null;
  const name = typeof v.name === 'string' ? v.name.slice(0, 120) : '';
  return { name, latDeg: v.latDeg, lonDeg: v.lonDeg, source: v.source };
}

function cleanFollowing(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const id of v) {
    if (Number.isInteger(id) && id >= 1 && id <= 999999999 && !out.includes(id)) out.push(id);
    if (out.length >= MAX_FOLLOWING) break;
  }
  return out;
}

function cleanCustom(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const e of v) {
    if (!isObj(e)) continue;
    try {
      const rec = parseElements(`${e.name ?? ''}\n${e.line1}\n${e.line2}`);
      if (out.some((c) => c.noradId === rec.noradId)) continue;
      out.push({ noradId: rec.noradId, name: rec.name, line1: rec.line1, line2: rec.line2 });
    } catch {
      // drop entries that no longer parse
    }
    if (out.length >= MAX_CUSTOM) break;
  }
  return out;
}

function cleanObservers(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const e of v) {
    if (!isObj(e)) continue;
    if (typeof e.id !== 'string' || !/^obs-\d+$/.test(e.id) || out.some((o) => o.id === e.id)) continue;
    if (!inRange(e.latDeg, -90, 90) || !inRange(e.lonDeg, -180, 180)) continue;
    const name = typeof e.name === 'string' ? e.name.slice(0, 60) : '';
    out.push({ id: e.id, name, latDeg: e.latDeg, lonDeg: e.lonDeg });
    if (out.length >= MAX_EXTRA_OBSERVERS) break;
  }
  return out;
}

export function parsePrefs(raw) {
  const d = defaultPrefs();
  let v = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return d; }
  }
  if (!isObj(v)) return d;
  return {
    location: cleanLocation(v.location),
    following: cleanFollowing(v.following) ?? d.following,
    custom: cleanCustom(v.custom) ?? d.custom,
    mode: v.mode === 'visual' || v.mode === 'radio' ? v.mode : d.mode,
    minElevDeg: inRange(v.minElevDeg, 0, 45) ? v.minElevDeg : d.minElevDeg,
    projection: PROJECTIONS.some((p) => p.id === v.projection) ? v.projection : d.projection,
    observers: cleanObservers(v.observers) ?? d.observers,
  };
}

export function loadPrefs(storage = globalThis.localStorage) {
  try {
    return parsePrefs(storage.getItem(PREFS_KEY));
  } catch {
    return defaultPrefs();
  }
}

export function savePrefs(prefs, storage = globalThis.localStorage) {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
