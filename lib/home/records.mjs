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
  // The Date header measures this browser's clock skew, as the classic app does.
  syncFromResponse(res);
  try {
    return await res.json();
  } catch {
    throw new Error(CATALOG_UNAVAILABLE);
  }
}

export async function fetchRecords(ids, { fetchImpl = fetch } = {}) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const bodies = await Promise.all(chunks.map((c) => fetchChunk(c, fetchImpl)));
  const records = new Map();
  const missing = [];
  for (const body of bodies) {
    for (const rec of body?.objects ?? []) records.set(rec.noradId, rec);
    for (const id of body?.missing ?? []) missing.push(id);
  }
  return { records, missing };
}

/** Pasted elements override the mirror record for the same id. */
export function tracksFor(records, custom = []) {
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
      tracks.set(id, makeTrack(rec, entry));
    } catch {
      // a record that cannot propagate is skipped
    }
  }
  return tracks;
}
