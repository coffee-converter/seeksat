// lib/og/pass-select.mjs - turn a decoded share blob into the concrete
// pass to chart: the first station (validated/clamped) and a window -
// the sharer's selected pass (explicit `t`) or the station's next
// visible (dark-sky) pass. Pure given an ecefAt sampler.
import { satAltAzDeg, satIlluminated, sunAltitudeDeg } from "../pass-finder/visibility.js";
import { sunPositionEcef } from "../pass-finder/sun.js";
import { passWindowAtMsForObserver } from "../pass-finder/observer-pass.js";
import { passPeakMs } from "../pass-finder/polar-events.js";

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

// Highest-peak visible (sun < -6°, satellite sunlit at peak) pass in the window.
function findNextVisiblePass(obs, ecefAt, nowMs, scanDays) {
  const t1 = nowMs + scanDays * 86400_000;
  const STEP = 30_000;
  let inPass = false, cur = null;
  const passes = [];
  for (let t = nowMs; t <= t1; t += STEP) {
    const e = ecefAt(new Date(t));
    if (!e) continue;
    const { alt } = satAltAzDeg(obs, e);
    if (alt > 0) {
      if (!inPass) { inPass = true; cur = { peakMs: t, peakAlt: alt }; }
      else if (alt > cur.peakAlt) { cur.peakAlt = alt; cur.peakMs = t; }
    } else if (inPass) { inPass = false; passes.push(cur); cur = null; }
  }
  if (inPass && cur) passes.push(cur);
  if (!passes.length) return null;
  const scored = passes.map((p) => {
    const d = new Date(p.peakMs);
    const visible = sunAltitudeDeg(obs, d) <= -6 && satIlluminated(ecefAt(d), sunPositionEcef(d));
    return { ...p, visible };
  });
  const pool = scored.filter((p) => p.visible);
  return (pool.length ? pool : scored).sort((a, b) => b.peakAlt - a.peakAlt)[0];
}

// Walk out from a peak to the above-horizon crossings (fallback when the
// observer-pass visual window is null, e.g. a daytime/edge pass). A LEO walk
// is 1 s steps for up to 12 min; a longer orbit's walk takes its budget.
function horizonWindow(obs, ecefAt, peakMs, walk) {
  const long = walk && walk.maxEdgeMs > 12 * 60 * 1000;
  const STEP = long ? walk.coarseStepMs : 1000;
  const CAP = long ? walk.maxEdgeMs : 12 * 60 * 1000;
  let s = peakMs, e = peakMs;
  for (let t = peakMs; t >= peakMs - CAP; t -= STEP) {
    const p = ecefAt(new Date(t)); if (!p || satAltAzDeg(obs, p).alt <= 0) break; s = t;
  }
  for (let t = peakMs; t <= peakMs + CAP; t += STEP) {
    const p = ecefAt(new Date(t)); if (!p || satAltAzDeg(obs, p).alt <= 0) break; e = t;
  }
  return { startMs: s, endMs: e };
}

export function selectPass(decoded, ecefAt, opts = {}) {
  // walk: the pass walk's budget for this orbit (walkOptsForOrbit); LEO's
  // when not given.
  const { nowMs = Date.now(), scanDays = 45, walk } = opts;
  const obs = firstObserver(decoded);
  if (!obs) return null;

  // `anchorMs` only LOCATES which pass to draw - it is not the chart's
  // peak. The shared `t` is the moment the sharer was viewing (often the
  // rise, when the satellite first clears the elevation mask), not the highest
  // point. Honour it only when plausibly real: a hand-crafted blob could
  // carry NaN / negative / absurdly large `t` (e.g. 1e18 → Invalid Date)
  // that would render - and 24h-cache - a blank-sky chart. The accepted
  // range is generous (a month back to a year ahead) so it never rejects a
  // genuine selection; anything outside it falls back to the next pass.
  const T_MIN = nowMs - 30 * 86400_000;
  const T_MAX = nowMs + 400 * 86400_000;
  let anchorMs;
  if (Number.isFinite(decoded.passTimeMs)
      && decoded.passTimeMs > T_MIN && decoded.passTimeMs < T_MAX) {
    anchorMs = decoded.passTimeMs;
  } else {
    const best = findNextVisiblePass(obs, ecefAt, nowMs, scanDays);
    if (!best) return null;
    anchorMs = best.peakMs;
  }

  const mode = decoded.mode === "radio" ? "radio" : "visual";
  const minElev = Number.isFinite(decoded.minElevDeg) ? decoded.minElevDeg : 10;
  const win = passWindowAtMsForObserver(obs, anchorMs, mode, minElev, ecefAt, walk)
            ?? horizonWindow(obs, ecefAt, anchorMs, walk);

  // Chart anchor = the window's TRUE peak (highest-elevation instant), the
  // same value the live modal uses (passPeakMs) - so the gold Peak marker
  // and sky shade sit at the top of the pass, not at the shared rise time.
  const peakMs = passPeakMs(win, obs, ecefAt);

  // Peak altitude across the window (for the caller's caption/markers).
  // At most about 2000 samples: an hours-long pass needs no 1 s steps.
  let maxAlt = -90;
  const step = Math.max(1000, Math.ceil((win.endMs - win.startMs) / 2000));
  for (let t = win.startMs; t <= win.endMs; t += step) {
    const e = ecefAt(new Date(t)); if (!e) continue;
    const a = satAltAzDeg(obs, e).alt; if (a > maxAlt) maxAlt = a;
  }
  return { observer: obs, win, peakMs, maxAlt };
}
