// lib/live/light.mjs - the live view's visual panel: whether the satellite
// is sunlit or in Earth's shadow, how bright it looks, and when it fades.

import { sunPositionEcef } from '../pass-finder/sun.js';
import { satAltitudeDeg, sunlitFraction } from '../pass-finder/visibility.js';
import { magnitudeAt } from '../pass-finder/ratings.js';
import { extinctionMag } from '../sky/visual-rating.mjs';

export const LIGHT_STEP_MS = 2000;

/** Sunlight and brightness for `obs` over [startMs, endMs], every `stepMs`:
 *  [{ tMs, lit, mag }]. `lit` is the fraction of the Sun's disc the satellite
 *  sees (0 in Earth's shadow); `mag` is the magnitude with the air's dimming
 *  (as the pass ratings use), null in shadow or without a standard magnitude.
 *  `track` needs ecefAt(date) and standardMag. */
export function lightTimeline(track, obs, startMs, endMs, stepMs = LIGHT_STEP_MS) {
  const out = [];
  if (!(endMs >= startMs)) return out;
  const std = Number.isFinite(track.standardMag) ? track.standardMag : null;
  for (let t = startMs; ; t = Math.min(endMs, t + stepMs)) {
    const d = new Date(t);
    const sat = track.ecefAt(d);
    if (sat) {
      const sun = sunPositionEcef(d);
      const lit = sunlitFraction(sat, sun);
      const m = std == null || lit <= 0 ? null : magnitudeAt(obs, sat, sun, std, lit);
      out.push({ tMs: t, lit, mag: m == null ? null : m + extinctionMag(satAltitudeDeg(obs, sat)) });
    }
    if (t >= endMs) break;
  }
  return out;
}

/** The light at `nowMs` from a lightTimeline: { lit, mag, msToShadow }, or
 *  null outside it. `msToShadow` is how long until it enters Earth's shadow,
 *  when it is sunlit now and does so before the timeline ends (the set). */
export function lightAt(timeline, nowMs) {
  const n = timeline.length;
  if (!n || nowMs < timeline[0].tMs || nowMs > timeline[n - 1].tMs) return null;
  let i = 0;
  while (i < n - 1 && timeline[i + 1].tMs <= nowMs) i++;
  const a = timeline[i], b = timeline[Math.min(i + 1, n - 1)];
  const f = b.tMs > a.tMs ? (nowMs - a.tMs) / (b.tMs - a.tMs) : 0;
  const litNow = a.lit + (b.lit - a.lit) * f;
  const lit = litNow > 0;
  let mag = null;
  if (lit) {
    if (a.mag != null && b.mag != null) mag = a.mag + (b.mag - a.mag) * f;
    else mag = a.mag ?? b.mag;
  }
  let msToShadow = null;
  if (lit) {
    for (let j = i + 1; j < n; j++) {
      if (timeline[j].lit <= 0) {
        // Somewhere between the last lit sample and this one: the middle.
        const at = (timeline[j - 1].tMs + timeline[j].tMs) / 2;
        msToShadow = Math.max(0, at - nowMs);
        break;
      }
    }
  }
  return { lit, mag, msToShadow };
}
