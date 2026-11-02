// lib/home/prefs.mjs - device-only home screen preferences. Storage can be
// missing, full or corrupt; nothing here throws.

import { parseElements } from '../sat/elements.mjs';
import { LS_STATE_KEY, decodeStateBlob } from '../pass-finder/state-blob.js';
import { DEFAULT_PROJECTION, migrateProjection } from '../map/view.mjs';

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
    minElevDeg: 0,
    projection: DEFAULT_PROJECTION,
    observers: [],
    hidden: [],
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

/** Ids hidden from the map: cleaned like following, and only followed ones. */
function cleanHidden(v, following) {
  return (cleanFollowing(v) ?? []).filter((id) => following.includes(id));
}

export function parsePrefs(raw) {
  const d = defaultPrefs();
  let v = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return d; }
  }
  if (!isObj(v)) return d;
  const following = cleanFollowing(v.following) ?? d.following;
  return {
    location: cleanLocation(v.location),
    following,
    custom: cleanCustom(v.custom) ?? d.custom,
    mode: v.mode === 'visual' || v.mode === 'radio' ? v.mode : d.mode,
    minElevDeg: inRange(v.minElevDeg, 0, 45) ? v.minElevDeg : d.minElevDeg,
    projection: migrateProjection(v.projection),
    observers: cleanObservers(v.observers) ?? d.observers,
    hidden: cleanHidden(v.hidden, following),
  };
}

/** Carry the classic app's saved observers into home prefs. Null when there
 *  is nothing usable. Never throws. */
export function migrateClassicState(storage = globalThis.localStorage) {
  try {
    const d = decodeStateBlob(storage.getItem(LS_STATE_KEY));
    if (!d || d.observers.length === 0) return null;
    const [first, ...rest] = d.observers;
    return parsePrefs({
      location: { name: first.name || 'Your location', latDeg: first.latDeg, lonDeg: first.lonDeg, source: 'coords' },
      mode: d.mode,
      minElevDeg: d.minElevDeg,
      observers: rest.slice(0, MAX_EXTRA_OBSERVERS).map((o, i) => ({ id: `obs-${i + 1}`, name: o.name, latDeg: o.latDeg, lonDeg: o.lonDeg })),
    });
  } catch {
    return null;
  }
}

export function loadPrefs(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(PREFS_KEY);
    if (raw == null) {
      const migrated = migrateClassicState(storage);
      if (migrated) {
        savePrefs(migrated, storage);
        return migrated;
      }
    }
    return parsePrefs(raw);
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
