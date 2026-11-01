// lib/sat/page-data.mjs - pure data for the /sat/<id> pages. No I/O; the
// route reads the record and passes it in. Everything returned is plain and
// serializable so it can cross the server/client boundary.
import { displayName } from '../catalog.mjs';
import { makeTrack } from './track.mjs';
import { liveNumbers, orbitElements, elementAge, formatNumber } from './numbers.mjs';

const MAX_PARAM_ID = 999_999_999;
const MAX_TLE_ID = 99_999;

export function parseSatParam(param) {
  const m = /^(\d{1,9})(-[a-z0-9-]*)?$/i.exec(String(param ?? ''));
  if (!m) return null;
  const id = Number(m[1]);
  if (!Number.isInteger(id) || id < 1 || id > MAX_PARAM_ID) return null;
  return { id, canonical: param === String(id) };
}

export function satPath(id) {
  return `/sat/${id}`;
}

export function rawElements(record, name) {
  const hasTle = Boolean(record.line1 && record.line2);
  return {
    twoLine: hasTle ? `${record.line1}\n${record.line2}` : null,
    threeLine: hasTle ? `${name}\n${record.line1}\n${record.line2}` : null,
    omm: record.omm ? JSON.stringify(record.omm, null, 2) : null,
    tooBigForTle: record.noradId > MAX_TLE_ID,
  };
}

export function sourceLabel(record) {
  if (record.source === 'celestrak-gp') {
    const groups = Array.isArray(record.groups) ? record.groups : [];
    return groups.length
      ? `CelesTrak GP data (groups: ${groups.join(', ')})`
      : 'CelesTrak GP data';
  }
  if (record.source === 'celestrak-catnr') return 'CelesTrak, looked up by catalog number';
  return String(record.source ?? 'unknown source');
}

export function satPageData(record, entry, nowMs) {
  const name = entry ? displayName(entry, record) : (record.name ?? `NORAD ${record.noradId}`);
  let elements = null;
  let live = null;
  try {
    const track = makeTrack(record, entry);
    try { elements = orbitElements(track); } catch { elements = null; }
    try { live = liveNumbers(track, new Date(nowMs)); } catch { live = null; }
  } catch {
    elements = null;
    live = null;
  }
  const epochMs = Number.isFinite(record.epochMs) ? record.epochMs : null;
  return {
    noradId: record.noradId,
    name,
    shortName: entry?.shortName ?? name,
    intlDesignator: record.omm?.OBJECT_ID ?? null,
    note: entry?.viewingHint ?? null,
    record,
    downlinks: entry?.downlinks ?? [],
    source: sourceLabel(record),
    fetchedAtMs: Number.isFinite(record.fetchedAtMs) ? record.fetchedAtMs : null,
    epochMs,
    groups: Array.isArray(record.groups) ? record.groups : [],
    elements,
    live,
    age: elementAge(epochMs ?? nowMs, nowMs),
    raw: rawElements(record, name),
    renderedAtMs: nowMs,
  };
}

export function satMetadata(data) {
  const e = data.elements;
  const ogPath = `/api/og/sat/${data.noradId}`;
  const description = e
    ? `Live position, speed and passes for ${data.name}, NORAD ${data.noradId}. `
      + `Orbit ${formatNumber(e.perigeeAltKm, 0)} by ${formatNumber(e.apogeeAltKm, 0)} km, `
      + `period ${formatNumber(e.periodMin, 1)} min, inclination ${formatNumber(e.inclinationDeg, 1)}°.`
    : `Live position and passes for ${data.name}, NORAD ${data.noradId}.`;
  const title = `${data.name} (NORAD ${data.noradId}): live position and passes`;
  return {
    title,
    description,
    alternates: { canonical: satPath(data.noradId) },
    openGraph: {
      type: 'website', siteName: 'SeekSat', title, description, url: satPath(data.noradId),
      images: [{ url: ogPath, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [ogPath] },
  };
}

// Resolve a /sat/<param> request against the catalog reader. Throws when the
// catalog is unavailable, or the on-demand answer is unknown (undefined), so
// the caller does not cache a false 404.
export async function lookupSat(reader, param) {
  const parsed = parseSatParam(param);
  if (!parsed) return { kind: 'not-found' };
  if (!parsed.canonical) return { kind: 'redirect', path: satPath(parsed.id) };
  const record = await reader.getRecord(parsed.id);
  if (record === undefined) throw new Error('The satellite catalog is not available right now.');
  if (!record) {
    if (!(await reader.ready())) throw new Error('The satellite catalog is not available right now.');
    return { kind: 'not-found' };
  }
  return { kind: 'ok', id: parsed.id, record };
}
