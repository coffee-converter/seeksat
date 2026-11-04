// lib/share/view-link.mjs - a shared map view as plain query parameters.
//
// Nothing personal goes in: no location, minimum elevation, sky type, bands
// or theme. The page path says which satellite is selected (/ or /sat/<id>).
//
//   map=globe|flat   the map type (always there; it marks a shared view)
//   lock=1           locked on to the page's satellite
//   z=3.4            zoom, latitude-free on the globe (see FlatMap discZoom)
//   c=lat,lon        the map centre, only when not locked
//   sats=1,2,3       the followed satellites, in order (empty: none)
//   hide=2           followed satellites hidden from the map
//   mode=radio|visual
//   f=145800000      the radio chart's frequency (radio mode only)

import { MAX_FOLLOWING } from '../home/prefs.mjs';

export const VIEW_PARAMS = ['map', 'lock', 'z', 'c', 'sats', 'hide', 'mode', 'f'];
const MAPS = ['globe', 'flat'];
const MODES = ['radio', 'visual'];
const MAX_ZOOM = 24;

const round = (n, d) => Number(n.toFixed(d));
const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
const isId = (n) => Number.isInteger(n) && n > 0 && n < 1e9;

/**
 * @param {{ projection: string, lock?: boolean, zoom?: number | null,
 *   center?: [number, number] | null, following: number[], hidden?: number[],
 *   mode: string, freqHz?: number | null }} v  center is [lon, lat]
 * @returns {string} the query, without "?"
 */
export function viewQuery(v) {
  const q = [];
  q.push(`map=${MAPS.includes(v.projection) ? v.projection : 'flat'}`);
  if (v.lock) q.push('lock=1');
  if (v.zoom != null && Number.isFinite(v.zoom)) {
    if (v.lock) q.push(`z=${round(v.zoom, 1)}`);
    else if (v.center) {
      q.push(`z=${round(v.zoom, 1)}`);
      q.push(`c=${round(v.center[1], 1)},${round(wrapLon(v.center[0]), 1)}`);
    }
  }
  const sats = [...new Set(v.following.filter(isId))].slice(0, MAX_FOLLOWING);
  q.push(`sats=${sats.join(',')}`);
  const hide = (v.hidden ?? []).filter((id) => sats.includes(id));
  if (hide.length) q.push(`hide=${hide.join(',')}`);
  const mode = v.mode === 'radio' ? 'radio' : 'visual';
  q.push(`mode=${mode}`);
  if (mode === 'radio' && v.freqHz != null && Number.isFinite(v.freqHz) && v.freqHz > 0) q.push(`f=${Math.round(v.freqHz)}`);
  return q.join('&');
}

/** The full link: origin + path + query. */
export function viewUrl(origin, path, v) {
  return `${origin}${path}?${viewQuery(v)}`;
}

const ids = (s) => (s ? s.split(',').map(Number).filter(isId) : []);

/**
 * Reads a shared view from a query string, or null when there is none (no
 * map=). Each value that does not parse is left out (null).
 * @param {string} search  with or without "?"
 */
export function parseView(search) {
  const p = new URLSearchParams(search);
  const map = p.get('map');
  if (!map || !MAPS.includes(map)) return null;
  const lock = p.get('lock') === '1';
  const zRaw = p.get('z');
  const z = zRaw == null || zRaw === '' ? NaN : Number(zRaw);
  const zoom = Number.isFinite(z) && z >= 0 && z <= MAX_ZOOM ? z : null;
  let center = null;
  const c = (p.get('c') ?? '').split(',').map((x) => (x === '' ? NaN : Number(x)));
  if (!lock && c.length === 2 && c.every(Number.isFinite) && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180) {
    center = [c[1], c[0]];
  }
  const following = p.has('sats') ? [...new Set(ids(p.get('sats')))].slice(0, MAX_FOLLOWING) : null;
  const hidden = ids(p.get('hide')).filter((id) => (following ?? []).includes(id));
  const modeRaw = p.get('mode');
  const mode = MODES.includes(modeRaw) ? modeRaw : null;
  const f = Number(p.get('f'));
  const freqHz = mode === 'radio' && Number.isFinite(f) && f > 0 && f < 1e12 ? Math.round(f) : null;
  return {
    projection: map,
    lock,
    // A zoom without a centre means nothing unless locked on.
    zoom: lock || center ? zoom : null,
    center: zoom != null ? center : null,
    following,
    hidden,
    mode,
    freqHz,
  };
}

/** The page a link points at: an old share path drops its blob. */
export function linkPath(pathname) {
  return pathname.replace(/\/share\/[^/]*\/?$/, '') || '/';
}

/** The query left once the view's parameters are taken out ("" or "?…"). */
export function stripView(search) {
  const p = new URLSearchParams(search);
  for (const k of VIEW_PARAMS) p.delete(k);
  const s = p.toString();
  return s ? `?${s}` : '';
}
