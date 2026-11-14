// lib/sat/page-data.mjs - pure data for the /sat/<id> pages. No I/O; the
// route reads the record and passes it in. Everything returned is plain and
// serializable so it can cross the server/client boundary.
import { displayName, downlinksFor } from '../catalog.mjs';
import { makeTrack } from './track.mjs';
import { liveNumbers, orbitElements, elementAge, formatNumber } from './numbers.mjs';

import { parseSatParam } from './sat-param.mjs';

export { parseSatParam };

const MAX_TLE_ID = 99_999;

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

// The epoch the page states ages from: the record's, else the one inside the
// elements (the track's). null when neither is finite. The client uses the
// same rule, so the server HTML and the first client render agree.
export function elementEpochMs(recordEpochMs, track) {
  if (Number.isFinite(recordEpochMs)) return recordEpochMs;
  return Number.isFinite(track?.epochMs) ? track.epochMs : null;
}

export function satPageData(record, entry, nowMs) {
  const name = entry ? displayName(entry, record) : (record.name ?? `NORAD ${record.noradId}`);
  let elements = null;
  let live = null;
  let track = null;
  try {
    track = makeTrack(record, entry);
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
    downlinks: downlinksFor(entry, record),
    source: sourceLabel(record),
    fetchedAtMs: Number.isFinite(record.fetchedAtMs) ? record.fetchedAtMs : null,
    epochMs,
    // The epoch the age is stated from (record, else the elements' own).
    elementEpochMs: elementEpochMs(epochMs, track),
    groups: Array.isArray(record.groups) ? record.groups : [],
    elements,
    live,
    age: elementAge(elementEpochMs(epochMs, track), nowMs),
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
  const alt = `${data.name} on a globe: where it is now, with its orbit track`;
  return {
    title,
    description,
    alternates: { canonical: satPath(data.noradId) },
    openGraph: {
      type: 'website', siteName: 'SeekSat', title, description, url: satPath(data.noradId),
      images: [{ url: ogPath, width: 1200, height: 630, alt }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [{ url: ogPath, alt }] },
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
