// lib/home/records.mjs - fetch satellite records from our own API and build Tracks.

import { makeTrack } from '../sat/track.mjs';
import { CATALOG } from '../catalog.mjs';
import { parseElements } from '../sat/elements.mjs';
import { syncFromResponse } from '../pass-finder/clock-sync.js';

const CHUNK = 50;
export const CATALOG_UNAVAILABLE = 'The satellite catalog is not available right now.';

async function fetchChunk(ids, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`/api/sats?ids=${ids.join(',')}`);
  } catch {
    throw new Error(CATALOG_UNAVAILABLE);
  }
  if (!res || res.status !== 200) throw new Error(CATALOG_UNAVAILABLE);
  // The Date header measures this browser's clock skew, as the classic app does
  // (clock-sync skips a copy the service worker saved).
  syncFromResponse(res);
  // public/sw.js marks an answer it replayed from its cache while offline.
  const fromCache = Boolean(res.headers?.get?.('x-seeksat-cache'));
  try {
    return { body: await res.json(), fromCache };
  } catch {
    throw new Error(CATALOG_UNAVAILABLE);
  }
}

/** { records, missing, fromCache, generatedAtMs }: fromCache is true when any
 *  chunk was a saved copy; generatedAtMs is the oldest snapshot time seen. */
export async function fetchRecords(ids, { fetchImpl = fetch } = {}) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const answers = await Promise.all(chunks.map((c) => fetchChunk(c, fetchImpl)));
  const records = new Map();
  const missing = [];
  let fromCache = false;
  let generatedAtMs = null;
  for (const { body, fromCache: saved } of answers) {
    if (saved) fromCache = true;
    const at = body?.generatedAtMs;
    if (Number.isFinite(at) && (generatedAtMs == null || at < generatedAtMs)) generatedAtMs = at;
    for (const rec of body?.objects ?? []) records.set(rec.noradId, rec);
    // unknown (CelesTrak budget spent or fetch failed) shows like missing;
    // the server does not cache it, so the next load asks again.
    for (const id of [...(body?.missing ?? []), ...(body?.unknown ?? [])]) missing.push(id);
  }
  return { records, missing, fromCache, generatedAtMs };
}

/** Pasted elements override the mirror record for the same id. */
/** Tracks for records and pasted elements. bands: the bands the listener's
 *  radio covers (lib/radio/bands.mjs), or null for every band. */
export function tracksFor(records, custom = [], bands = null) {
  const all = new Map(records);
  for (const c of custom) {
    try {
      all.set(c.noradId, parseElements(`${c.name}\n${c.line1}\n${c.line2}`));
    } catch {
      // a bad stored entry is skipped
    }
  }
  const tracks = new Map();
  for (const [id, rec] of all) {
    try {
      const entry = CATALOG.find((s) => s.noradId === id) ?? null;
      tracks.set(id, makeTrack(rec, entry, { bands }));
    } catch {
      // a record that cannot propagate is skipped
    }
  }
  return tracks;
}
