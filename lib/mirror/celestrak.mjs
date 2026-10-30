// lib/mirror/celestrak.mjs - CelesTrak GP (OMM JSON) client. Fetch is injected.

import { normalizeOmm } from '../sat/omm.mjs';

export const MIRROR_GROUPS = Object.freeze(['active', 'last-30-days']);

const TIMEOUT_MS = 15000;
const USER_AGENT = 'seeksat/1.0 (https://seeksat.app)';

export function groupUrl(group) {
  return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`;
}

export function catnrUrl(noradId) {
  return `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=json`;
}

async function getText(url, fetchImpl) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const resp = await fetchImpl(url, { signal: ac.signal, headers: { 'User-Agent': USER_AGENT } });
    if (!resp.ok) throw new Error(`celestrak: HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchGroup(group, { fetchImpl = fetch } = {}) {
  const body = await getText(groupUrl(group), fetchImpl);
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`celestrak: group ${group} response not JSON`);
  }
  if (!Array.isArray(data)) throw new Error(`celestrak: group ${group} response not an array`);
  return data.map(normalizeOmm).filter(Boolean);
}

export async function fetchByCatnr(noradId, { fetchImpl = fetch } = {}) {
  const body = await getText(catnrUrl(noradId), fetchImpl);
  if (/^\s*No GP data found/i.test(body)) return null;
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`celestrak: CATNR ${noradId} response not JSON`);
  }
  if (!Array.isArray(data)) throw new Error(`celestrak: CATNR ${noradId} response not an array`);
  if (data.length === 0) return null;
  return normalizeOmm(data[0]);
}
