// lib/pass-finder/state-blob.js - pure encoder/decoder for the
// pass-finder's URL share-blob + localStorage payload.
//
// Schema (kept short for casual share URLs):
//   { o: [[name, lat, lon], …],
//     t?: passTimeMs (only when a window is selected),
//     m?: "r"          (only in radio mode),
//     f?: downlinkHz   (only in radio mode with a selected frequency),
//     e?: minElevDeg   (only when ≠ 10) }
//
// The scene's persistState() / buildShareUrl() / loadInitialObservers
// build a snapshot and call encodeStateBlob; decodeStateBlob is used
// to seed observers from URL or localStorage on first paint.

import { localStore } from '../safe-storage.mjs';
export const LS_STATE_KEY = "iss-triangulation/state/v1";

// URL-safe base64 (a.k.a. base64url): +/= replaced so it survives in
// query strings without needing further URL-encoding.
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// Decodes UTF-8; falls back to the raw Latin-1 string for blobs made by
// the old encoder.
function b64urlDecode(b64) {
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (_) { return bin; }
}

/**
 * @param {{
 *   observers: Array<{name: string, latDeg: number, lonDeg: number}>,
 *   activePassMs?: number | null,
 *   mode?: "visual" | "radio",
 *   downlinkHz?: number | null,
 *   minElevDeg?: number,
 *   noradId?: number | null,
 * }} snap
 */
export function encodeStateBlob(snap) {
  const obj = {
    o: snap.observers.map(o => [o.name, +o.latDeg.toFixed(5), +o.lonDeg.toFixed(5)]),
  };
  if (snap.noradId != null) obj.n = snap.noradId;
  if (snap.activePassMs != null) obj.t = snap.activePassMs;
  if (snap.mode === "radio") obj.m = "r";
  if (snap.mode === "radio" && snap.downlinkHz) obj.f = snap.downlinkHz;
  if (snap.minElevDeg != null && snap.minElevDeg !== 10) obj.e = snap.minElevDeg;
  return b64urlEncode(JSON.stringify(obj));
}

/**
 * Returns null when the blob is malformed / empty.
 * @returns {null | {
 *   observers: Array<{name: string, latDeg: number, lonDeg: number}>,
 *   passTimeMs: number | null,
 *   mode: "visual" | "radio",
 *   downlinkHz: number | null,
 *   minElevDeg: number,
 *   noradId: number | null,
 * }}
 */
export function decodeStateBlob(blob) {
  if (!blob) return null;
  try {
    const obj = JSON.parse(b64urlDecode(blob));
    const observers = Array.isArray(obj.o)
      ? obj.o
          .map(e => Array.isArray(e) && e.length >= 3
            ? { name: String(e[0] || "Observer"), latDeg: +e[1], lonDeg: +e[2] }
            : null)
          .filter(o => o && Number.isFinite(o.latDeg) && Number.isFinite(o.lonDeg)
            && Math.abs(o.latDeg) <= 90 && Math.abs(o.lonDeg) <= 180)
      : [];
    return {
      noradId: Number.isInteger(obj.n) && obj.n > 0 ? obj.n : null,
      observers,
      passTimeMs: Number.isFinite(obj.t) ? Number(obj.t) : null,
      mode: obj.m === "r" ? "radio" : "visual",
      downlinkHz: obj.m === "r" && typeof obj.f === "number" ? obj.f : null,
      minElevDeg: Number.isFinite(obj.e) ? Math.max(0, Math.min(80, +obj.e)) : 10,
    };
  } catch (_) {
    return null;
  }
}

/** Read the persisted blob from localStorage. Silent on errors so
 *  private-browsing / quota-blocked environments don't crash boot. */
export function readPersistedBlob() {
  const store = localStore();
  if (!store) return null;
  try { return store.getItem(LS_STATE_KEY); }
  catch (_) { return null; }
}

/** Write the persisted blob; silent on errors. */
export function writePersistedBlob(blob) {
  const store = localStore();
  if (!store) return;
  try { store.setItem(LS_STATE_KEY, blob); }
  catch (_) { /* private browsing etc. - silently skip */ }
}
