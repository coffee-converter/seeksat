// pass-finder/tle.js -- fetch the current ISS TLE.
//
// Two source URLs, fetched in parallel; whichever returns a TLE with
// the most recent epoch wins. The TLE itself encodes its validity
// date in line 1 cols 19-32, so picking the freshest doesn't require
// trusting any HTTP timestamp the provider sends.
//
// Returns { name, line1, line2, epochMs, source } on success, or
// null if all sources fail. `epochMs` is the parsed TLE epoch (ms
// since the Unix epoch); `source` names the URL it came from for
// diagnostic display.

// Source order. Each entry is { url, parse } where parse converts the
// HTTP response body into { name, line1, line2 } or throws.
const SOURCES = [
  {
    name: "ivanstanojevic",
    url: "https://tle.ivanstanojevic.me/api/tle/25544",
    parse: async (resp) => {
      const j = await resp.json();
      if (!j.line1 || !j.line2) throw new Error("malformed JSON shape");
      return {
        name: j.name || "ISS (ZARYA)",
        line1: j.line1,
        line2: j.line2,
      };
    },
  },
  {
    name: "celestrak",
    url: "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE",
    parse: async (resp) => {
      const text = await resp.text();
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 3) throw new Error("unexpected TLE shape");
      return { name: lines[0], line1: lines[1], line2: lines[2] };
    },
  },
];

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
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${name}: HTTP ${resp.status}`);
  const tle = await parse(resp);
  const epochMs = parseTleEpoch(tle.line1);
  if (!Number.isFinite(epochMs)) {
    throw new Error(`${name}: unparseable epoch in line 1`);
  }
  return { ...tle, epochMs, source: name };
}

export async function fetchIssTle() {
  // Promise.allSettled so a slow/failed source doesn't block faster
  // ones. We deliberately wait for *all* to finish: the freshest TLE
  // wins, and the 2-3s slack across providers is invisible compared
  // to the rest of page-load.
  const results = await Promise.allSettled(SOURCES.map(fetchOne));
  const successes = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
  if (!successes.length) {
    for (const r of results) {
      if (r.status === "rejected") {
        console.warn("TLE source failed:", r.reason?.message ?? r.reason);
      }
    }
    return null;
  }
  // Pick the most recent epoch.
  successes.sort((a, b) => b.epochMs - a.epochMs);
  return successes[0];
}
