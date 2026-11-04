// lib/mirror/celestrak.mjs - CelesTrak GP (OMM JSON) client. Fetch is injected.

import { normalizeOmm } from '../sat/omm.mjs';
import { SITE_URL } from '../site.mjs';

// active + last-30-days hold only live and new objects. visual adds the
// brightest objects (many spent rocket bodies) and weather adds retired
// weather satellites. (molniya, raduga and gorizont are not GP groups:
// CelesTrak answers them with a plain-text error.)
// gps-ops adds no satellites ('active' holds them) but names GPS ones as
// people know them, by block and PRN (lib/mirror/snapshot.mjs NAME_GROUPS).
export const MIRROR_GROUPS = Object.freeze(['active', 'last-30-days', 'visual', 'weather', 'gps-ops']);

const TIMEOUT_MS = 15000;
// CelesTrak asks callers to identify themselves with a working contact.
const USER_AGENT = `seeksat/1.0 (${SITE_URL})`;

// CelesTrak firewalls addresses that keep asking after a refusal (about 50
// errors in 2 hours, redirects included) and 403s a repeat download of an
// unchanged set inside its 2-hour update cycle. Any failed request pauses
// every CelesTrak call from this instance for PAUSE_MS.
export const PAUSE_MS = 2 * 3_600_000;

export function createCelestrakGuard({ now = Date.now, log = console } = {}) {
  let pausedUntilMs = 0;
  return {
    isPaused: () => now() < pausedUntilMs,
    pausedUntilMs: () => pausedUntilMs,
    trip(reason) {
      pausedUntilMs = now() + PAUSE_MS;
      log.warn(`celestrak: pausing requests for 2 h after ${reason}`);
    },
  };
}

const defaultGuard = createCelestrakGuard();

export function groupUrl(group) {
  return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`;
}

export function catnrUrl(noradId) {
  return `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=json`;
}

async function getText(url, fetchImpl, guard) {
  if (guard.isPaused()) throw new Error('celestrak: paused after an earlier failed request');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let resp;
  let body;
  try {
    // Redirects are never followed: CelesTrak counts them as errors.
    resp = await fetchImpl(url, { signal: ac.signal, redirect: 'manual', headers: { 'User-Agent': USER_AGENT } });
    if (resp.ok) body = await resp.text();
  } catch (err) {
    guard.trip(`network error: ${err?.message ?? err}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    guard.trip(`HTTP ${resp.status}`);
    throw new Error(`celestrak: HTTP ${resp.status}`);
  }
  if (/^\s*</.test(body)) {
    guard.trip('an HTML page');
    throw new Error('celestrak: HTML page instead of data');
  }
  return body;
}

export async function fetchGroup(group, { fetchImpl = fetch, guard = defaultGuard } = {}) {
  const body = await getText(groupUrl(group), fetchImpl, guard);
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    guard.trip('a non-JSON body');
    throw new Error(`celestrak: group ${group} response not JSON`);
  }
  if (!Array.isArray(data)) guard.trip('a non-array body');
  if (!Array.isArray(data)) throw new Error(`celestrak: group ${group} response not an array`);
  return data.map(normalizeOmm).filter(Boolean);
}

export async function fetchByCatnr(noradId, { fetchImpl = fetch, guard = defaultGuard } = {}) {
  const body = await getText(catnrUrl(noradId), fetchImpl, guard);
  if (/^\s*No GP data found/i.test(body)) return null;
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    guard.trip('a non-JSON body');
    throw new Error(`celestrak: CATNR ${noradId} response not JSON`);
  }
  if (!Array.isArray(data)) guard.trip('a non-array body');
  if (!Array.isArray(data)) throw new Error(`celestrak: CATNR ${noradId} response not an array`);
  if (data.length === 0) return null;
  return normalizeOmm(data[0]);
}
