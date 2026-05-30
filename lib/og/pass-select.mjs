// lib/og/pass-select.mjs — turn a decoded share blob into the concrete
// pass to chart: the first station (validated/clamped) and a window —
// the sharer's selected pass (explicit `t`) or the station's next
// visible (dark-sky) pass. Pure given an issEcefAt sampler.
import { issAltAzDeg, issIlluminated, sunAltitudeDeg } from "../pass-finder/visibility.js";
import { sunPositionEcef } from "../pass-finder/sun.js";
import { passWindowAtMsForObserver } from "../pass-finder/observer-pass.js";

export function firstObserver(decoded) {
  const o = decoded?.observers?.[0];
  if (!o || !Number.isFinite(o.latDeg) || !Number.isFinite(o.lonDeg)) return null;
  return {
    id: "og",
    name: String(o.name ?? "Observer").slice(0, 40),
    latDeg: Math.max(-90, Math.min(90, o.latDeg)),
    lonDeg: Math.max(-180, Math.min(180, o.lonDeg)),
    elevationM: 0,
  };
}

// Highest-peak visible (sun < -6°, ISS sunlit at peak) pass in the window.
function findNextVisiblePass(obs, issEcefAt, nowMs, scanDays) {
  const t1 = nowMs + scanDays * 86400_000;
  const STEP = 30_000;
  let inPass = false, cur = null;
  const passes = [];
  for (let t = nowMs; t <= t1; t += STEP) {
    const e = issEcefAt(new Date(t));
    if (!e) continue;
    const { alt } = issAltAzDeg(obs, e);
    if (alt > 0) {
      if (!inPass) { inPass = true; cur = { peakMs: t, peakAlt: alt }; }
      else if (alt > cur.peakAlt) { cur.peakAlt = alt; cur.peakMs = t; }
    } else if (inPass) { inPass = false; passes.push(cur); cur = null; }
  }
  if (inPass && cur) passes.push(cur);
  if (!passes.length) return null;
  const scored = passes.map((p) => {
    const d = new Date(p.peakMs);
    const visible = sunAltitudeDeg(obs, d) <= -6 && issIlluminated(issEcefAt(d), sunPositionEcef(d));
    return { ...p, visible };
  });
  const pool = scored.filter((p) => p.visible);
  return (pool.length ? pool : scored).sort((a, b) => b.peakAlt - a.peakAlt)[0];
}

// Walk out from a peak to the above-horizon crossings (fallback when the
// observer-pass visual window is null, e.g. a daytime/edge pass).
function horizonWindow(obs, issEcefAt, peakMs) {
  const STEP = 1000, CAP = 12 * 60 * 1000;
  let s = peakMs, e = peakMs;
  for (let t = peakMs; t >= peakMs - CAP; t -= STEP) {
    const p = issEcefAt(new Date(t)); if (!p || issAltAzDeg(obs, p).alt <= 0) break; s = t;
  }
  for (let t = peakMs; t <= peakMs + CAP; t += STEP) {
    const p = issEcefAt(new Date(t)); if (!p || issAltAzDeg(obs, p).alt <= 0) break; e = t;
  }
  return { startMs: s, endMs: e };
}

export function selectPass(decoded, issEcefAt, opts = {}) {
  const { nowMs = Date.now(), scanDays = 45 } = opts;
  const obs = firstObserver(decoded);
  if (!obs) return null;

  // Honour an explicit pass time only when it's plausibly real. A
  // hand-crafted share blob could carry a NaN / negative / absurdly large
  // `t` (e.g. 1e18, which becomes an Invalid Date) that would otherwise
  // render — and 24h-cache — a blank-sky chart. The accepted window is
  // generous (a month back to a year ahead) so it never rejects a genuine
  // shared selection; anything outside it falls back to the next pass.
  const T_MIN = nowMs - 30 * 86400_000;
  const T_MAX = nowMs + 400 * 86400_000;
  let peakMs;
  if (Number.isFinite(decoded.passTimeMs)
      && decoded.passTimeMs > T_MIN && decoded.passTimeMs < T_MAX) {
    peakMs = decoded.passTimeMs;
  } else {
    const best = findNextVisiblePass(obs, issEcefAt, nowMs, scanDays);
    if (!best) return null;
    peakMs = best.peakMs;
  }

  const mode = decoded.mode === "radio" ? "radio" : "visual";
  const minElev = Number.isFinite(decoded.minElevDeg) ? decoded.minElevDeg : 10;
  const win = passWindowAtMsForObserver(obs, peakMs, mode, minElev, issEcefAt)
            ?? horizonWindow(obs, issEcefAt, peakMs);

  // Peak altitude across the window (for the caller's caption/markers).
  let maxAlt = -90;
  for (let t = win.startMs; t <= win.endMs; t += 1000) {
    const e = issEcefAt(new Date(t)); if (!e) continue;
    const a = issAltAzDeg(obs, e).alt; if (a > maxAlt) maxAlt = a;
  }
  return { observer: obs, win, peakMs, maxAlt };
}
