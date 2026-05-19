// lib/pass-finder/ratings.js — pure rating + probability-factor
// math shared by the passes-table renderer, the orbit-gradient
// overlay, the joint-capture probability model, and the radio score.
//
// Everything here is referentially transparent (only depends on its
// arguments), so it's safe to import from anywhere without dragging
// scene state along. The scene file glues these together with its
// own state-dependent wrappers (captureProbJoint, passSuccessProb,
// etc.) that pass observers / issEcef / etc. in.

import { geodeticToEcef } from "../coords.js";

// Stops for the rating gradient — used by both the orbit overlay
// (returning Cesium.Color via ratingColorAt) and every colored column
// in the passes list (returning a CSS rgb() string via ratingCssColor).
// Even thirds — red below 1/3 (success unlikely), yellow at 1/3 (coin
// flip-ish), green at 2/3+ (success very likely). 2/3 ≈ 0.67 is the
// "very likely" threshold; anything above that is fully saturated green.
const RATING_STOPS = [
  { t: 0.00,        r: 248, g: 113, b: 113 }, // red    (#f87171)
  { t: 1.0 / 3.0,   r: 250, g: 204, b:  21 }, // yellow (#facc15)
  { t: 2.0 / 3.0,   r:  52, g: 211, b: 153 }, // green  (#34d399)
  { t: 1.00,        r:  52, g: 211, b: 153 }, // saturate at green
];

export function interpRatingStop(score) {
  const s = Math.max(0, Math.min(1, score));
  for (let i = 0; i < RATING_STOPS.length - 1; i++) {
    const a = RATING_STOPS[i], b = RATING_STOPS[i + 1];
    if (s <= b.t) {
      const u = (s - a.t) / (b.t - a.t);
      return {
        r: Math.round(a.r + (b.r - a.r) * u),
        g: Math.round(a.g + (b.g - a.g) * u),
        b: Math.round(a.b + (b.b - a.b) * u),
      };
    }
  }
  return RATING_STOPS[RATING_STOPS.length - 1];
}

export function ratingCssColor(score) {
  const c = interpRatingStop(score);
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

// Like ratingCssColor but desaturates toward a neutral gray as the
// forecast skill decays — used for the clouds column, since point
// cloud-cover forecasts past day 1-2 carry diminishing trust. The
// skill curve matches effectivePClear (exp decay with tau = 4 days),
// FLOORED at 1/3 so the cell never gets more than 2/3 gray: a far-out
// cloud value retains enough color (~33%) to still hint at the forecast
// while clearly reading as "less trustworthy" via the gray cast.
export function ratingCssColorWithSkill(score, ageDays) {
  const c = interpRatingStop(score);
  const skill = Math.max(1 / 3, forecastSkill(ageDays));
  const gray = { r: 106, g: 122, b: 154 };
  const r = Math.round(c.r * skill + gray.r * (1 - skill));
  const g = Math.round(c.g * skill + gray.g * (1 - skill));
  const b = Math.round(c.b * skill + gray.b * (1 - skill));
  return `rgb(${r}, ${g}, ${b})`;
}

// ---------------------------------------------------------------------------
// Probability-factor curves — single source of truth for both the rating
// math AND the gradient coloring of the passes-list columns. The number
// you see colored in any column IS the value that contributed to the
// joint capture probability for that pass.
// ---------------------------------------------------------------------------

// Sky-darkness factor from sun altitude (apparent, refraction-corrected).
// Linear from horizon (sun = 0°) to nautical (sun = −12°), saturating at 1.
// Camera-reality threshold: nautical twilight is dark enough for sub-mag-3
// reference stars in a short exposure, even when the eye still sees glow.
export function twilightFactor(sunAltDeg) {
  return Math.max(0, Math.min(1, -sunAltDeg / 12));
}

// ISS-altitude factor from apparent (refraction-corrected) altitude.
// 0 below 5° (horizon haze + obstructions), 1 by 25° (clean overhead sky).
// 15° → 0.5, 20° → 0.75. The previous ramp saturated at 30° which was
// too punishing for the moderate-altitude passes most amateurs target.
export function altitudeFactor(apparentAltDeg) {
  return Math.max(0, Math.min(1, (apparentAltDeg - 5) / 20));
}

// Coordination/redundancy factor from pass duration. Sigmoid form so
// returns diminish past ~2 minutes: 30s → 0.33, 60s → 0.50, 120s → 0.67,
// 240s → 0.80. Captures the practical premium of longer passes (time to
// set up, multiple-frame attempts, recover from transient clouds).
export function coordinationFactor(durSec) {
  return durSec / (durSec + 60);
}

// Forecast skill as a function of forecast age. Exponential decay with
// tau = 4 days (deterministic-cloud forecast skill rule-of-thumb).
// Returns 1 at age 0, ~0.37 at 4 days, ~0.08 at 10 days. Used by both
// effectivePClear (to blend the forecast toward neutral) and the
// clouds-column color desaturation (to fade the cell toward gray).
export function forecastSkill(ageDays) {
  return ageDays > 0 ? Math.exp(-ageDays / 4) : 1;
}

// Cloud-clear factor: forecast P(clear) blended toward a neutral 0.5 by
// the forecastSkill curve. Day-1 forecasts trusted almost fully; by day 4
// we're ~37% direct + ~63% neutral; by day 10 mostly neutral. Returns
// 0.5 when no forecast is loaded for this point.
export function effectivePClear(cloudPct, ageDays) {
  if (cloudPct == null) return 0.5;
  const direct = Math.max(0, 1 - cloudPct / 100);
  const skill = forecastSkill(ageDays);
  return skill * direct + (1 - skill) * 0.5;
}

// Peak-elevation curve for radio scoring: 0 at the horizon, 1 above
// ~55°. Used for both the per-row "Peak El." color and the joint
// radioPassSuccessProbability score.
export function peakElevFactor(deg) {
  return Math.max(0, Math.min(1, (deg - 5) / 50));
}

// Duration → quality curve. Exponential approach to 1.0 with a 90s
// time constant — short passes (<2 min) score low, a typical 6-7 min
// overhead pass lands in the high 90s, and the curve asymptotes so
// implausibly long passes don't break the upper bound.
//   60s   →  0.49
//  120s   →  0.74
//  180s   →  0.86
//  300s   →  0.96
//  420s   →  0.99
//  600s   →  ~1.00
export function radioDurationFactor(sec) {
  return Math.min(1, 1 - Math.exp(-sec / 90));
}

// Visual magnitude of the (sunlit) ISS from one observer at one instant.
// Standard satellite-magnitude formula:
//   m = m_std + 5·log10(range / 1000 km)  −  2.5·log10(F(α))
// where m_std = −1.8 is the intrinsic magnitude at 1000 km / full phase,
// α is the phase angle (satellite→sun vs satellite→observer), and
// F(α) = (1 + cos α) / 2 is the Lambertian-sphere phase function.
// Returns null when the observer is looking at the unlit hemisphere
// (F ≤ 0) — in that case the satellite isn't visible at all.
export function magnitudeAt(obs, issEcef, sunDir) {
  const obsEcef = geodeticToEcef(obs.latDeg, obs.lonDeg, 0);
  const dx = obsEcef[0] - issEcef[0];
  const dy = obsEcef[1] - issEcef[1];
  const dz = obsEcef[2] - issEcef[2];
  const range = Math.hypot(dx, dy, dz);
  if (range <= 0) return null;
  const inv = 1 / range;
  const cosAlpha = (dx * sunDir[0] + dy * sunDir[1] + dz * sunDir[2]) * inv;
  const F = (1 + cosAlpha) / 2;
  if (F <= 0) return null;
  return -1.8 + 5 * Math.log10(range / 1_000_000) - 2.5 * Math.log10(F);
}

// Cesium-flavored rating color (Cesium.Color, used by the orbit-arc
// gradient overlay). Kept here despite the Cesium dependency because
// the stops + interpolation curve must match ratingCssColor exactly.
export function ratingColorAtCesium(score, Cesium) {
  const c = interpRatingStop(score);
  return Cesium.Color.fromBytes(c.r, c.g, c.b);
}
