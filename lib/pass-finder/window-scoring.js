// lib/pass-finder/window-scoring.js — small scoring/aggregation
// helpers used by the windows-list renderer to summarize each pass
// at a glance.
//
// Pure given their inputs; the scene threads the observer list +
// cloud-forecast lookup + issEcefAt sampler where needed.

import { cloudAt } from "./weather.js";
import { issAltitudeDeg } from "./visibility.js";

// Per-observer time-of-day preference for naked-eye viewing, 0–1.
// Peaks during prime evening (7–11pm), troughs in the dead of night
// (3–4am). Uses longitude/15 as the local-time offset — close
// enough for "people are awake or asleep" purposes without an IANA
// timezone lookup.
export function localTimeScore(localHour) {
  const h = ((localHour % 24) + 24) % 24;
  if (h >= 19 && h < 23) return 1.0;                   // 7-11pm: prime
  if (h >= 23 && h < 24) return 1.0 - (h - 23) * 0.3;  // 11pm-mid: 1.0→0.7
  if (h >= 0  && h < 1)  return 0.7 - h * 0.2;         // 12-1am: 0.7→0.5
  if (h >= 1  && h < 4)  return 0.5 - (h - 1) * 0.083; // 1-4am: 0.5→0.25
  if (h >= 4  && h < 5)  return 0.25;                  // 4-5am: trough
  if (h >= 5  && h < 7)  return 0.25 + (h - 5) * 0.225;// 5-7am: 0.25→0.7
  if (h >= 18 && h < 19) return 0.85;                  // 6-7pm: dusk
  return 0.5;                                          // daytime (filtered by sun predicate)
}

// Worst-observer time-of-day score at a given moment. Used as the
// rating's time factor so a pass that's prime-evening for one
// observer but 3am for another is correctly penalized.
export function worstLocalTimeScore(peakMs, observers) {
  if (!observers.length) return 1.0;
  const d = new Date(peakMs);
  const utcHour = d.getUTCHours() + d.getUTCMinutes()/60 + d.getUTCSeconds()/3600;
  let worst = 1.0;
  for (const obs of observers) {
    const s = localTimeScore(utcHour + obs.lonDeg / 15);
    if (s < worst) worst = s;
  }
  return worst;
}

// Cloud cover range across observers at a given ms: returns
// { min, max } (each 0-100), or null if any observer's forecast
// isn't loaded yet. `cloudForecastForObs(obsId)` lets the caller
// inject its scene-level cache lookup.
export function cloudRange(ms, observers, cloudForecastForObs) {
  let min = Infinity, max = -Infinity;
  for (const obs of observers) {
    const f = cloudForecastForObs(obs.id);
    const c = cloudAt(f, ms);
    if (c == null) return null;
    if (c < min) min = c;
    if (c > max) max = c;
  }
  if (!Number.isFinite(min)) return null;
  return { min, max };
}

// Best moment in a window = where the MINIMUM altitude across all
// observers is MAXIMIZED. That's the instant when every observer
// simultaneously sees the ISS as high as it gets given the
// geometry.
export function bestMomentMs(w, observers, issEcefAtFn) {
  const stepMs = 5000;
  let bestMs = w.startMs;
  let bestMinAlt = -Infinity;
  for (let t = w.startMs; t <= w.endMs; t += stepMs) {
    const issEcef = issEcefAtFn(new Date(t));
    if (!issEcef) continue;
    let minAlt = Infinity;
    for (const obs of observers) {
      const a = issAltitudeDeg(obs, issEcef);
      if (a < minAlt) minAlt = a;
    }
    if (minAlt > bestMinAlt) {
      bestMinAlt = minAlt;
      bestMs = t;
    }
  }
  return bestMs;
}
