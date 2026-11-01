// lib/og/tle.mjs - the current orbit record (any satellite) from our CelesTrak mirror snapshot
// (never CelesTrak itself), falling back to the CORS mirrors used by
// lib/pass-finder/tle.js, with a short in-process TTL cache, plus a
// factory for the scene's ecefAt sampler (ECEF metres) backed by
// satellite.js. Fluid Compute reuses instances, so the cache spares
// most requests a network round-trip.
import * as sat from "satellite.js";
import { satrecFromRecord } from "../sat/satrec.mjs";
import { getCatalogReader } from "../mirror/server.mjs";

const SOURCES = [
  { url: "https://api.wheretheiss.at/v1/satellites/25544/tles",
    parse: async (r) => { const j = await r.json(); if (!j.line1 || !j.line2) throw new Error("bad JSON");
      return { name: j.header || j.name || "ISS (ZARYA)", line1: j.line1, line2: j.line2 }; } },
  { url: "https://tle.ivanstanojevic.me/api/tle/25544",
    parse: async (r) => { const j = await r.json(); if (!j.line1) throw new Error("bad JSON");
      return { name: j.name || "ISS (ZARYA)", line1: j.line1, line2: j.line2 }; } },
];

const TTL_MS = 30 * 60 * 1000;
const ISS_ID = 25544;
const cache = new Map(); // noradId -> { rec, atMs }

async function fromMirror(noradId, reader) {
  try {
    const rec = await reader.getSnapshotRecord(noradId);
    if (rec && (rec.omm || (rec.line1 && rec.line2))) return rec;
  } catch { /* ISS only: fall back to the CORS mirrors */ }
  return null;
}

// Orbit record for the OG renderer: the mirror snapshot for any id, plus
// the (non-CelesTrak) CORS fallbacks for the ISS only. Throws if none.
export async function getOgRecord(noradId, nowMs = Date.now(), reader = getCatalogReader()) {
  const hit = cache.get(noradId);
  if (hit && nowMs - hit.atMs < TTL_MS) return hit.rec;
  const mirrored = await fromMirror(noradId, reader);
  if (mirrored) {
    cache.set(noradId, { rec: mirrored, atMs: nowMs });
    return mirrored;
  }
  if (noradId === ISS_ID) {
    for (const s of SOURCES) {
      try {
        const resp = await fetch(s.url, { signal: AbortSignal.timeout(8000) });
        if (!resp.ok) continue;
        const rec = { noradId, ...(await s.parse(resp)), source: s.url };
        cache.set(noradId, { rec, atMs: nowMs });
        return rec;
      } catch { /* next source */ }
    }
  }
  if (hit) return hit.rec; // stale beats nothing
  throw new Error(`no orbit record for ${noradId}`);
}

export function getIssTle(nowMs = Date.now(), reader = getCatalogReader()) {
  return getOgRecord(ISS_ID, nowMs, reader);
}

// Same ECI -> ECF conversion as the app's pass engine: ECI -> ECF, metres.
export function ecefAtFactory(record) {
  const satrec = satrecFromRecord(record);
  return (jsDate) => {
    const pv = sat.propagate(satrec, jsDate);
    if (!pv || !pv.position) return null;
    const ecf = sat.eciToEcf(pv.position, sat.gstime(jsDate));
    return [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000];
  };
}
