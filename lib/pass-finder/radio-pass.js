// lib/pass-finder/radio-pass.js - the radio-pass time series. This is the
// single source of physics for the chart, the CSV, and every header
// readout; nothing downstream recomputes.
//
// Pure given an injected `satStateAt` sampler, so it tests without Cesium.

import { observerTemeAt, rangeRateMps } from "./sat-state.js";
import { retardedState, dopplerHz, C_LIGHT } from "./doppler.js";
import {
  angularRateDegPerSec, apparentDirEcef, relSignalDb, absoluteFsplDb,
} from "./radio-optics.js";

const DEG = Math.PI / 180;

/** Vertex of the parabola through three equally-spaced samples.
 *  Returns the offset from the middle sample, in seconds, and the value. */
export function interpolateMinimum(y0, y1, y2, stepSec) {
  const den = y0 - 2 * y1 + y2;
  if (!Number.isFinite(den) || den === 0) return { offsetSec: 0, value: y1 };
  const delta = (0.5 * (y0 - y2)) / den;
  return { offsetSec: delta * stepSec, value: y1 - 0.25 * (y0 - y2) * delta };
}

function unitTo(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const n = Math.hypot(dx, dy, dz);
  return n > 0 ? [dx / n, dy / n, dz / n] : [0, 0, 1];
}

/** Sample a radio pass.
 *
 *  `window` must be the OBSERVER'S OWN pass window, not a joint
 *  multi-observer intersection - an intersection truncates the S-curve and
 *  understates the swing. Use passWindowAtMsForObserver from
 *  observer-pass.js to compute it. */
export function radioPassSamples(obs, window, deps, opts = {}) {
  const { satStateAt, obsEcef, upEcef } = deps;
  const freqHz = opts.freqHz ?? null;
  const stepMs = Math.max(250, opts.stepMs ?? 2000);
  const samples = [];

  let seedTau = 0;
  for (let tMs = window.startMs; tMs <= window.endMs; tMs += stepMs) {
    const t = Math.round(tMs);
    const inst = satStateAt(new Date(t));
    if (!inst) continue;
    const obsTeme = observerTemeAt(obsEcef, inst.gmst);

    const ret = retardedState(satStateAt, t, obsTeme.r, seedTau);
    if (!ret) continue;
    seedTau = ret.tauSec;

    // Light-path length. At TCA this equals the geometric closest
    // approach, since rdot is zero there.
    const rangeM = ret.tauSec * C_LIGHT;
    const rr = rangeRateMps(ret.rTeme, ret.vTeme, obsTeme);

    // Elevation/azimuth from the ECEF position (the app's convention), using
    // the retarded direction so the chart matches what is actually seen.
    const trueDir = unitTo(obsEcef, inst.rEcef);
    const appDir = apparentDirEcef(trueDir, upEcef);
    const sinAlt = Math.max(-1, Math.min(1,
      appDir[0] * upEcef[0] + appDir[1] * upEcef[1] + appDir[2] * upEcef[2]));
    const elDeg = Math.asin(sinAlt) / DEG;

    const east = [-Math.sin(obs.lonDeg * DEG), Math.cos(obs.lonDeg * DEG), 0];
    const north = [
      -Math.sin(obs.latDeg * DEG) * Math.cos(obs.lonDeg * DEG),
      -Math.sin(obs.latDeg * DEG) * Math.sin(obs.lonDeg * DEG),
      Math.cos(obs.latDeg * DEG),
    ];
    let azDeg = Math.atan2(
      appDir[0] * east[0] + appDir[1] * east[1] + appDir[2] * east[2],
      appDir[0] * north[0] + appDir[1] * north[1] + appDir[2] * north[2],
    ) / DEG;
    if (azDeg < 0) azDeg += 360;

    samples.push({
      tMs: t,
      rangeM,
      rangeRateMps: rr,
      dopplerHz: freqHz ? dopplerHz(ret.rTeme, ret.vTeme, obsTeme, freqHz) : null,
      elDeg,
      azDeg,
      appDir,
      angRateDegPerSec: 0, // filled below, needs neighbours
      relSignalDb: 0,      // filled below, needs the minimum
    });
  }

  // Angular rate from apparent unit vectors - never from alt/az components.
  const stepSec = stepMs / 1000;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    const span = (b.tMs - a.tMs) / 1000;
    samples[i].angRateDegPerSec = span > 0
      ? angularRateDegPerSec(a.appDir, b.appDir, span)
      : 0;
  }

  // Closest approach, refined between samples.
  let minIdx = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].rangeM < samples[minIdx].rangeM) minIdx = i;
  }
  let tcaMs = samples.length ? samples[minIdx].tMs : window.startMs;
  let closestRangeM = samples.length ? samples[minIdx].rangeM : NaN;
  if (minIdx > 0 && minIdx < samples.length - 1) {
    const r = interpolateMinimum(
      samples[minIdx - 1].rangeM, samples[minIdx].rangeM,
      samples[minIdx + 1].rangeM, stepSec,
    );
    tcaMs = samples[minIdx].tMs + r.offsetSec * 1000;
    closestRangeM = r.value;
  }

  for (const s of samples) s.relSignalDb = relSignalDb(s.rangeM, closestRangeM);

  // Both Doppler edges independently - passes are NOT symmetric.
  let dMax = -Infinity, dMin = Infinity, maxRate = 0, maxOmega = 0;
  for (let i = 0; i < samples.length; i++) {
    const d = samples[i].dopplerHz;
    if (d != null) {
      if (d > dMax) dMax = d;
      if (d < dMin) dMin = d;
      if (i > 0 && samples[i - 1].dopplerHz != null) {
        const dt = (samples[i].tMs - samples[i - 1].tMs) / 1000;
        const rate = Math.abs(d - samples[i - 1].dopplerHz) / dt;
        if (rate > maxRate) maxRate = rate;
      }
    }
    if (samples[i].angRateDegPerSec > maxOmega) maxOmega = samples[i].angRateDegPerSec;
  }

  // Doppler nearest the interpolated TCA. NOT atElev(90): most passes never
  // reach the zenith, so keying this off elevation would return null on
  // nearly every real pass.
  let dopplerAtTca = null;
  if (samples.length) {
    let best = samples[0], bestDt = Infinity;
    for (const s of samples) {
      const dt = Math.abs(s.tMs - tcaMs);
      if (dt < bestDt) { bestDt = dt; best = s; }
    }
    dopplerAtTca = best.dopplerHz;
  }

  // Doppler at an exact elevation crossing, found by linear interpolation
  // between the two samples that straddle it - NOT nearest-sample lookup.
  // Every pass crosses a given elevation twice (once rising, once setting)
  // with Doppler of opposite sign and near-equal magnitude; picking
  // whichever sample happens to land closest to the target elevation makes
  // the readout flip sign depending on the phase of the sampling grid
  // against the window start. Rise and set are independent: a partial
  // capture that only covers one leg reports null for the other, and a
  // pass that never reaches the target elevation reports null for both.
  function dopplerAtElevCrossing(a, b, target) {
    if (a.dopplerHz == null || b.dopplerHz == null) return null;
    const span = b.elDeg - a.elDeg;
    if (span === 0) return a.dopplerHz;
    const frac = (target - a.elDeg) / span;
    return a.dopplerHz + frac * (b.dopplerHz - a.dopplerHz);
  }
  const crossingsAtElev = (target) => {
    let rise = null, set = null;
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      if (rise === null && a.elDeg < target && b.elDeg >= target) {
        rise = dopplerAtElevCrossing(a, b, target);
      }
      if (set === null && a.elDeg >= target && b.elDeg < target) {
        set = dopplerAtElevCrossing(a, b, target);
      }
    }
    return { rise, set };
  };

  for (const s of samples) delete s.appDir;

  return {
    samples,
    summary: {
      tcaMs,
      closestRangeM,
      dopplerMaxHz: dMax === -Infinity ? null : dMax,
      dopplerMinHz: dMin === Infinity ? null : dMin,
      dopplerPeakToPeakHz: dMax === -Infinity ? null : dMax - dMin,
      maxDopplerRateHzPerSec: maxRate,
      maxAngRateDegPerSec: maxOmega,
      absoluteFsplDb: freqHz ? absoluteFsplDb(closestRangeM, freqHz) : null,
      dopplerAtElevation: {
        10: crossingsAtElev(10), 30: crossingsAtElev(30), tca: dopplerAtTca,
      },
    },
  };
}
