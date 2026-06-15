// lib/pass-finder/scoring.js — joint capture-probability + radio
// scoring for multi-observer ISS passes.
//
// Pulled out so the scene file doesn't have to host all the
// "across-observers combination" logic alongside the painters. Pure
// factor curves still live in ratings.js; this module is the bit
// that combines them across observers (with explicit
// correlation-aware MIN/PRODUCT/MIN combiners) and sweeps them
// across the pass window. All scene-coupled bits (issEcef sampler,
// cloud-forecast lookup, mode, minElevDeg) get threaded in as a
// `deps` bag rather than read off a hidden module-level state.

import { apparentAltDeg } from "../refraction.js";
import { issAltitudeDeg, sunAltitudeDeg } from "./visibility.js";
import { sunPositionEcef } from "./sun.js";
import { cloudAt } from "./weather.js";
import {
  twilightFactor, altitudeFactor, coordinationFactor,
  effectivePClear, peakElevFactor, radioDurationFactor,
  magnitudeAt,
} from "./ratings.js";

// Joint probability that EVERY observer succeeds at the same
// instant.
//
// Combiners are correlation-aware, NOT a naïve product (which
// double-counts correlation and over-penalizes nearby observer
// clusters):
//   - twilightFactor (sky darkness): MIN across observers. Sun
//     altitude is essentially the same for observers within a few
//     hundred km, so the joint probability is determined by the
//     worst-positioned observer's twilight — not by cubing
//     nearly-identical values.
//   - altitudeFactor (ISS height): PRODUCT across observers. Each
//     observer's view geometry is genuinely independent, so
//     independent successes legitimately compound.
//   - effectivePClear (clouds): MIN across observers. Cloud systems
//     are regional; if one nearby observer is socked in, others
//     probably are too. The MIN reads as "the weakest-link observer
//     caps the group."
//
// Returns 0 fast when any single observer fails the visibility
// gates (ISS below 5°, or sun above the horizon).
export function captureProbJoint(observers, issEcef, jsDate, ms, nowMs, cloudForecastForObs) {
  let minDark = 1;
  let prodAlt = 1;
  let minClear = 1;
  const ageDays = (ms - nowMs) / 86_400_000;
  for (const obs of observers) {
    const apparentAlt = apparentAltDeg(issAltitudeDeg(obs, issEcef));
    if (apparentAlt < 5) return 0;
    const sunAlt = apparentAltDeg(sunAltitudeDeg(obs, jsDate));
    if (sunAlt >= 0) return 0;
    const d = twilightFactor(sunAlt);
    if (d < minDark) minDark = d;
    prodAlt *= altitudeFactor(apparentAlt);
    const c = effectivePClear(cloudAt(cloudForecastForObs(obs.id), ms), ageDays);
    if (c < minClear) minClear = c;
  }
  return minDark * prodAlt * minClear;
}

// Pass success probability = max joint probability over sampled
// moments, scaled by a duration factor that captures the practical
// coordination premium of longer passes (more time to set up,
// multiple-frame redundancy, recoverable from transient cloud
// blips). We don't OR across moments — geometry is deterministic
// and clouds are near-constant within a pass, so consecutive sample
// probabilities are heavily correlated, and a naïve "1 − ∏(1 − p)"
// would overcount.
//
// Duration sigmoid: pCoord = dur / (dur + 30). 30s → 0.50,
// 60s → 0.67, 120s → 0.80, 240s → 0.89, asymptotic to 1 — captures
// diminishing returns past ~2 minutes (more time doesn't keep
// helping forever).
//
// `deps` carries:
//   mode                  "visual" | "radio"
//   minElevDeg            minimum elevation for radio mode
//   issEcefAtFn(jsDate)   sample ISS ECEF position at instant
//   cloudForecastForObs(obsId) lookup the cached forecast
export function passSuccessProbability(win, observers, deps) {
  if (deps.mode === "radio") {
    return radioPassSuccessProbability(win, observers, deps.minElevDeg, deps.issEcefAtFn);
  }
  if (!win || !observers.length) return 0;
  const totalMs = win.endMs - win.startMs;
  if (totalMs <= 0) return 0;
  const STEP_MS = Math.max(1_000, Math.min(5_000, totalMs / 30));
  const nowMs = Date.now();
  let best = 0;
  for (let t = win.startMs; t <= win.endMs; t += STEP_MS) {
    const d = new Date(t);
    const issEcef = deps.issEcefAtFn(d);
    if (!issEcef) continue;
    const p = captureProbJoint(observers, issEcef, d, t, nowMs, deps.cloudForecastForObs);
    if (p > best) best = p;
  }
  return best * coordinationFactor(totalMs / 1000);
}

// Radio-reception score. The visibility filter already guaranteed
// every observer's apparent elevation ≥ minElevDeg throughout the
// window, so the only remaining variables are (a) how HIGH the pass
// gets — the worst observer's peak elevation, which limits the
// joint best signal-to-noise — and (b) how LONG the window lasts
// (more time = more opportunities for a QSO / better Doppler
// measurement). The peakElevFactor + radioDurationFactor curves
// themselves live in pass-finder/ratings.js.
export function radioPassSuccessProbability(win, observers, minElevDeg, issEcefAtFn) {
  if (!win || !observers.length) return 0;
  const totalMs = win.endMs - win.startMs;
  if (totalMs <= 0) return 0;
  const STEP_MS = Math.max(1_000, Math.min(5_000, totalMs / 30));
  // Worst-observer peak elevation across the window (limiting case
  // for coordinated multi-station work).
  let worstPeak = Infinity;
  for (const obs of observers) {
    let peak = -Infinity;
    for (let t = win.startMs; t <= win.endMs; t += STEP_MS) {
      const issEcef = issEcefAtFn(new Date(t));
      if (!issEcef) continue;
      const a = apparentAltDeg(issAltitudeDeg(obs, issEcef));
      if (a > peak) peak = a;
    }
    if (peak < worstPeak) worstPeak = peak;
  }
  if (!Number.isFinite(worstPeak)) return 0;
  return peakElevFactor(worstPeak) * radioDurationFactor(totalMs / 1000);
}

// Per-moment radio-link quality used by the orbit-arc gradient.
// Worst observer's elevation factor at this instant — gradient
// turns red where the worst observer is near the horizon, green
// near zenith.
export function radioCaptureAt(observers, issEcef, minElevDeg) {
  let worst = 1;
  for (const obs of observers) {
    const a = apparentAltDeg(issAltitudeDeg(obs, issEcef));
    if (a < minElevDeg) return 0;
    const f = peakElevFactor(a);
    if (f < worst) worst = f;
  }
  return worst;
}

// Peak joint-visibility magnitude within the window.
// At each sampled moment we take the WORST (dimmest, highest m)
// magnitude across the observers — the floor everyone is guaranteed
// to see at that instant — and then across moments we take the
// BRIGHTEST (lowest m) of those floors. This is the minimax
// magnitude: the moment where even the dimmest observer sees the
// ISS at its best across the joint-visibility window.
export function peakMagnitudeInWindow(win, observers, issEcefAtFn, stdMag = -1.8) {
  if (!win || !observers.length) return null;
  const totalMs = win.endMs - win.startMs;
  if (totalMs <= 0) return null;
  const STEP_MS = Math.max(1_000, Math.min(5_000, totalMs / 30));
  let bestOfWorsts = Infinity;
  for (let t = win.startMs; t <= win.endMs; t += STEP_MS) {
    const d = new Date(t);
    const issEcef = issEcefAtFn(d);
    if (!issEcef) continue;
    const sunDir = sunPositionEcef(d);
    let worstAtT = -Infinity;
    let anyValid = false;
    for (const obs of observers) {
      const m = magnitudeAt(obs, issEcef, sunDir, stdMag);
      if (m == null) continue;
      anyValid = true;
      if (m > worstAtT) worstAtT = m;
    }
    if (!anyValid) continue;
    if (worstAtT < bestOfWorsts) bestOfWorsts = worstAtT;
  }
  return bestOfWorsts === Infinity ? null : bestOfWorsts;
}
