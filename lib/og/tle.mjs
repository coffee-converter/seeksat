// lib/og/tle.mjs - fetch the current ISS TLE (same sources as
// lib/pass-finder/tle.js) with a short in-process TTL cache, plus a
// factory for the scene's issEcefAt sampler (ECEF metres) backed by
// satellite.js. Fluid Compute reuses instances, so the cache spares
// most requests a network round-trip.
import * as sat from "satellite.js";

const SOURCES = [
  { url: "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE",
    parse: async (r) => { const L = (await r.text()).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (L.length < 3) throw new Error("bad TLE"); return { name: L[0], line1: L[1], line2: L[2] }; } },
  { url: "https://api.wheretheiss.at/v1/satellites/25544/tles",
    parse: async (r) => { const j = await r.json(); if (!j.line1 || !j.line2) throw new Error("bad JSON");
      return { name: j.header || j.name || "ISS (ZARYA)", line1: j.line1, line2: j.line2 }; } },
  { url: "https://tle.ivanstanojevic.me/api/tle/25544",
    parse: async (r) => { const j = await r.json(); if (!j.line1) throw new Error("bad JSON");
      return { name: j.name || "ISS (ZARYA)", line1: j.line1, line2: j.line2 }; } },
];

const TTL_MS = 30 * 60 * 1000;
let cache = null; // { tle, atMs }

export async function getIssTle(nowMs = Date.now()) {
  if (cache && nowMs - cache.atMs < TTL_MS) return cache.tle;
  for (const s of SOURCES) {
    try {
      const resp = await fetch(s.url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) continue;
      const tle = { ...(await s.parse(resp)), source: s.url };
      cache = { tle, atMs: nowMs };
      return tle;
    } catch { /* next source */ }
  }
  if (cache) return cache.tle; // stale beats nothing
  throw new Error("all TLE sources failed");
}

// Mirror lib/pass-finder-scene.js issEcefAt exactly: ECI -> ECF, metres.
export function issEcefAtFactory(tle) {
  const satrec = sat.twoline2satrec(tle.line1, tle.line2);
  return (jsDate) => {
    const pv = sat.propagate(satrec, jsDate);
    if (!pv || !pv.position) return null;
    const ecf = sat.eciToEcf(pv.position, sat.gstime(jsDate));
    return [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000];
  };
}
