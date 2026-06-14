// lib/mcp/tle-fetch.mjs — fetch a current TLE for ANY NORAD id.
// Generalizes lib/pass-finder/tle.js (which is hardwired to 25544) by
// parameterizing the catalog number in each source URL. Source order
// and parse shapes match the existing module. fetch is injectable so
// the source-ladder logic is unit-testable without network.

import { parseTleEpoch } from '../pass-finder/tle.js';

const PER_SOURCE_TIMEOUT_MS = 6000;

export function buildSourceUrls(noradId) {
  return [
    {
      name: 'wheretheiss',
      url: `https://api.wheretheiss.at/v1/satellites/${noradId}/tles`,
      parse: async (resp) => {
        const j = await resp.json();
        if (!j.line1 || !j.line2) throw new Error('malformed JSON shape');
        return { name: j.header || j.name || String(noradId), line1: j.line1, line2: j.line2 };
      },
    },
    {
      name: 'ivanstanojevic',
      url: `https://tle.ivanstanojevic.me/api/tle/${noradId}`,
      parse: async (resp) => {
        const j = await resp.json();
        if (!j.line1 || !j.line2) throw new Error('malformed JSON shape');
        return { name: j.name || String(noradId), line1: j.line1, line2: j.line2 };
      },
    },
    {
      name: 'celestrak',
      url: `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=TLE`,
      parse: async (resp) => {
        const text = await resp.text();
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length < 3) throw new Error('unexpected TLE shape');
        return { name: lines[0], line1: lines[1], line2: lines[2] };
      },
    },
  ];
}

async function fetchOne(src, fetchImpl) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PER_SOURCE_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(src.url, { signal: ac.signal });
    if (!resp.ok) throw new Error(`${src.name}: HTTP ${resp.status}`);
    const tle = await src.parse(resp);
    const epochMs = parseTleEpoch(tle.line1);
    if (!Number.isFinite(epochMs)) throw new Error(`${src.name}: unparseable epoch`);
    return { ...tle, epochMs, source: src.name };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTleForId(noradId, { fetchImpl = fetch } = {}) {
  for (const src of buildSourceUrls(noradId)) {
    try {
      return await fetchOne(src, fetchImpl);
    } catch (e) {
      console.warn(`TLE source failed (${noradId}): ${e?.message ?? e}`);
    }
  }
  return null;
}
