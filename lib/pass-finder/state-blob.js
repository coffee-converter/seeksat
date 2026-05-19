// lib/pass-finder/state-blob.js — pure encoder/decoder for the
// pass-finder's URL share-blob + localStorage payload.
//
// Schema (kept short for casual share URLs):
//   { o: [[name, lat, lon], …],
//     t?: passTimeMs (only when a window is selected),
//     m?: "r"          (only in radio mode),
//     e?: minElevDeg   (only when ≠ 10) }
//
// The scene's persistState() / buildShareUrl() / loadInitialObservers
// build a snapshot and call encodeStateBlob; decodeStateBlob is used
// to seed observers from URL or localStorage on first paint.

export const LS_STATE_KEY = "iss-triangulation/state/v1";

// URL-safe base64 (a.k.a. base64url): +/= replaced so it survives in
// query strings without needing further URL-encoding.
function b64urlEncode(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(b64) {
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return atob(b64.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

/**
 * @param {{
 *   observers: Array<{name: string, latDeg: number, lonDeg: number}>,
 *   activePassMs?: number | null,
 *   mode?: "visual" | "radio",
 *   minElevDeg?: number,
 * }} snap
 */
export function encodeStateBlob(snap) {
  const obj = {
    o: snap.observers.map(o => [o.name, +o.latDeg.toFixed(5), +o.lonDeg.toFixed(5)]),
  };
  if (snap.activePassMs != null) obj.t = snap.activePassMs;
  if (snap.mode === "radio") obj.m = "r";
  if (snap.minElevDeg != null && snap.minElevDeg !== 10) obj.e = snap.minElevDeg;
  return b64urlEncode(JSON.stringify(obj));
}

/**
 * Returns null when the blob is malformed / empty.
 * @returns {null | {
 *   observers: Array<{name: string, latDeg: number, lonDeg: number}>,
 *   passTimeMs: number | null,
 *   mode: "visual" | "radio",
 *   minElevDeg: number,
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
          .filter(o => o && Number.isFinite(o.latDeg) && Number.isFinite(o.lonDeg))
      : [];
    return {
      observers,
      passTimeMs: Number.isFinite(obj.t) ? Number(obj.t) : null,
      mode: obj.m === "r" ? "radio" : "visual",
      minElevDeg: Number.isFinite(obj.e) ? Math.max(0, Math.min(80, +obj.e)) : 10,
    };
  } catch (_) {
    return null;
  }
}

/** Read the persisted blob from localStorage. Silent on errors so
 *  private-browsing / quota-blocked environments don't crash boot. */
export function readPersistedBlob() {
  if (typeof localStorage === "undefined") return null;
  try { return localStorage.getItem(LS_STATE_KEY); }
  catch (_) { return null; }
}

/** Write the persisted blob; silent on errors. */
export function writePersistedBlob(blob) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(LS_STATE_KEY, blob); }
  catch (_) { /* private browsing etc. — silently skip */ }
}
