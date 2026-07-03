// pass-finder/tle.js -- fetch the current TLE for any satellite by NORAD id.
//
// Tries each source in order with a per-source timeout. The first
// one that returns a parseable TLE wins; nothing waits for slower or
// dead sources. (An earlier Promise.allSettled fan-out blocked on
// the slowest source no matter what - bad behavior when one
// provider is in a 508 outage or CORS-blocked.)
//
// Every successful response is also handed to clock-sync.js, which
// pulls the server-set `Date:` header off it to estimate the user's
// clock skew. Costs nothing extra - the header is already on the
// wire whether we read it or not.
//
// Returns { name, line1, line2, epochMs, source } on success, or
// null if all sources fail. `epochMs` is the parsed TLE epoch (ms
// since the Unix epoch); `source` names the URL it came from for
// diagnostic display.

import { syncFromResponse } from "./clock-sync.js";

const PER_SOURCE_TIMEOUT_MS = 6000;

// Returns an array of { name, url, parse } source objects for the given
// NORAD id. Each source's parse fn converts the HTTP response body into
// { name, line1, line2 } or throws.
export function tleSourcesFor(noradId) {
  const id = String(noradId);
  return [
    {
      // Primary: CORS-enabled (Access-Control-Allow-Origin: *) and
      // reliable. JSON payload carries the proper object name under
      // `header` ("ISS (ZARYA)"); `name` is a lowercased slug ("iss").
      name: "wheretheiss",
      url: `https://api.wheretheiss.at/v1/satellites/${id}/tles`,
      parse: async (resp) => {
        const j = await resp.json();
        if (!j.line1 || !j.line2) throw new Error("malformed JSON shape");
        return { name: j.header || j.name || "", line1: j.line1, line2: j.line2 };
      },
    },
    {
      // Backup: also CORS-enabled, but prone to shared-host 508
      // "Resource Limit Is Reached" outages - hence not primary.
      name: "ivanstanojevic",
      url: `https://tle.ivanstanojevic.me/api/tle/${id}`,
      parse: async (resp) => {
        const j = await resp.json();
        if (!j.line1 || !j.line2) throw new Error("malformed JSON shape");
        return { name: j.name || "", line1: j.line1, line2: j.line2 };
      },
    },
    {
      // Last resort: CelesTrak does not send CORS headers, so browser
      // fetches hang until the per-source timeout aborts them. Kept
      // only because it works server-side / from permissive origins.
      name: "celestrak",
      url: `https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`,
      parse: async (resp) => {
        const text = await resp.text();
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length < 3) throw new Error("unexpected TLE shape");
        return { name: lines[0], line1: lines[1], line2: lines[2] };
      },
    },
  ];
}

/** Parse the epoch field from TLE line 1 (cols 19-32, 0-indexed
 *  18-32). Returns ms-since-Unix-epoch, or NaN if the line shape is
 *  unrecognized. Encoding: "YY DDD.dddddddd" where YY is the 2-digit
 *  year (NORAD convention: 57-99 → 1957-1999, 00-56 → 2000-2056),
 *  DDD is day-of-year, dddddddd is fractional day. */
export function parseTleEpoch(line1) {
  if (typeof line1 !== "string" || line1.length < 32) return NaN;
  const yy = parseInt(line1.slice(18, 20), 10);
  const dayFrac = parseFloat(line1.slice(20, 32));
  if (!Number.isFinite(yy) || !Number.isFinite(dayFrac)) return NaN;
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  // Jan 1 of `year` at 00:00 UTC, then add (dayFrac - 1) days. dayFrac
  // of 1.0 is Jan 1 00:00 UTC; 1.5 is Jan 1 noon; etc.
  const jan1 = Date.UTC(year, 0, 1);
  return jan1 + (dayFrac - 1) * 86_400_000;
}

async function fetchOne({ name, url, parse }) {
  // AbortController so the network request itself stops, not just
  // the awaited promise. Important when a source hangs (CelesTrak
  // CORS-blocking from certain origins, ivanstanojevic 508s, etc.) -
  // the fetch in the browser would otherwise sit pending for ~30s.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PER_SOURCE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ac.signal });
    if (!resp.ok) throw new Error(`${name}: HTTP ${resp.status}`);
    syncFromResponse(resp);
    const tle = await parse(resp);
    const epochMs = parseTleEpoch(tle.line1);
    if (!Number.isFinite(epochMs)) {
      throw new Error(`${name}: unparseable epoch in line 1`);
    }
    return { ...tle, epochMs, source: name };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTle(noradId) {
  // Try sources in order. Each is bounded by PER_SOURCE_TIMEOUT_MS.
  // The first source to return a valid TLE wins; we don't wait for
  // any subsequent source. Total worst-case wait is N × timeout if
  // every source fails, which is bounded and acceptable.
  for (const src of tleSourcesFor(noradId)) {
    try {
      return await fetchOne(src);
    } catch (e) {
      console.warn(`TLE source failed: ${e?.message ?? e}`);
    }
  }
  return null;
}

// Back-compat shim for the triangulate page's TLE panel, which only ever
// wants the ISS. Pass-finder code uses fetchTle(noradId) directly.
export const fetchIssTle = () => fetchTle(25544);
