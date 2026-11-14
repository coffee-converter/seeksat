// lib/og/globe-scene.mjs - What the share image's globe shows (globe-card):
// a shared pass from its place (the track, the pass, the visibility circle,
// the observer, the satellite at its peak), or, for a satellite page, where
// the satellite is now and its track around it.
import tzlookup from '@photostructure/tz-lookup';
import { ecefToGeodetic } from '../coords.js';
import { footprintRadiusDeg } from '../map/geometry.mjs';
import { geometricElevFor } from '../map/pass-arc.mjs';
import { compass } from '../sat/pass-rows.mjs';
import { satAltAzDeg } from '../pass-finder/visibility.js';
import { globeCentre } from './globe-card.mjs';
import { placeName } from './drawable.mjs';

const MIN = 60_000;

/** The point under the satellite at ms: [lon, lat, altKm], or null. */
function subAt(ecefAt, ms) {
  const e = ecefAt(new Date(ms));
  if (!e) return null;
  const g = ecefToGeodetic(e[0], e[1], e[2]);
  return [g.lonDeg, g.latDeg, g.elevM / 1000];
}

/** Ground points from a to b, every stepMs (or fewer: at most MAX_POINTS,
 *  for passes that last a day). */
const MAX_POINTS = 600;
function track(ecefAt, a, b, stepMs, keep = null) {
  const out = [];
  const step = Math.max(stepMs, (b - a) / MAX_POINTS);
  for (let t = a; t <= b; t += step) {
    if (keep && !keep(t)) continue;
    const s = subAt(ecefAt, t);
    if (s) out.push([s[0], s[1]]);
  }
  return out;
}

/** Fixed (or nearly) in the sky: a geosynchronous satellite, whose point
 *  below barely moves over hours. */
export function staysPut(ecefAt, ms) {
  const a = subAt(ecefAt, ms), b = subAt(ecefAt, ms + 6 * 3_600_000);
  if (!a || !b) return false;
  const dLon = Math.abs(((b[0] - a[0] + 540) % 360) - 180);
  return dLon < 3 && Math.abs(b[1] - a[1]) < 10 && a[2] > 30_000;
}

/** A satellite that stays put: you, where it hangs, and the way to it. */
export function fixedScene({ ecefAt, observer, nowMs }) {
  const now = subAt(ecefAt, nowMs);
  const o = [observer.lonDeg, observer.latDeg];
  // The way to it, as a great circle from you toward the point below it.
  const sight = now ? interpolate(o, [now[0], now[1]], 40) : null;
  return {
    centre: globeCentre(observer.lonDeg, observer.latDeg),
    ground: sight,
    observer: { lonDeg: observer.lonDeg, latDeg: observer.latDeg },
    sat: now ? { lonDeg: now[0], latDeg: now[1] } : null,
    dashed: true,
  };
}

/** n+1 points along the great circle from a to b ([lon, lat] degrees). */
function interpolate(a, b, n) {
  const rad = Math.PI / 180;
  const v = ([lon, lat]) => [Math.cos(lat * rad) * Math.cos(lon * rad), Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad)];
  const va = v(a), vb = v(b);
  const w = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  if (w < 1e-9) return [a, b];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, k1 = Math.sin((1 - t) * w) / Math.sin(w), k2 = Math.sin(t * w) / Math.sin(w);
    const p = [0, 1, 2].map((j) => k1 * va[j] + k2 * vb[j]);
    out.push([Math.atan2(p[1], p[0]) / rad, Math.asin(Math.max(-1, Math.min(1, p[2]))) / rad]);
  }
  return out;
}

/** The lines for a satellite that stays put: where to look. */
export function fixedLines({ ecefAt, observer, nowMs }) {
  const e = ecefAt(new Date(nowMs));
  const where = observer.name ? ` from ${placeName(observer)}` : '';
  if (!e) return [`Always up${where}`, 'seeksat.com'];
  const { alt, az } = satAltAzDeg(observer, e);
  return alt > 0
    ? [`Always up${where}`, `${Math.round(alt)}° up in the ${compass(az)} · seeksat.com`]
    : [`Never rises${where}`, `Below the horizon in the ${compass(az)} · seeksat.com`];
}

/** Wider than this, the visibility circle covers most of the globe and says
 *  nothing (a satellite thousands of km up): it is left out. */
const MAX_CIRCLE_DEG = 60;

/** A shared pass: sel is pass-select's { observer, win, peakMs, maxAlt }. */
export function passScene({ ecefAt, sel, minElevDeg = 10 }) {
  const { observer, win, peakMs } = sel;
  const peak = subAt(ecefAt, peakMs);
  const reach = peak ? footprintRadiusDeg(peak[2], geometricElevFor(minElevDeg)) : null;
  const radiusDeg = reach != null && reach <= MAX_CIRCLE_DEG ? reach : null;
  return {
    centre: globeCentre(observer.lonDeg, observer.latDeg),
    ground: track(ecefAt, win.startMs - 45 * MIN, win.endMs + 45 * MIN, 20_000),
    // The bold part: only while it is at least minElevDeg up, so its ends sit
    // on the visibility circle (a pass window can run from the horizon).
    pass: track(ecefAt, win.startMs, win.endMs, 5_000, (ms) => {
      const e = ecefAt(new Date(ms));
      return e != null && satAltAzDeg(observer, e).alt >= minElevDeg - 0.5;
    }),
    circle: radiusDeg ? { lonDeg: observer.lonDeg, latDeg: observer.latDeg, radiusDeg } : null,
    observer: { lonDeg: observer.lonDeg, latDeg: observer.latDeg },
    sat: peak ? { lonDeg: peak[0], latDeg: peak[1] } : null,
    sight: true,
  };
}

/** A satellite page: where it is now, and its track for one orbit around it. */
export function satScene({ ecefAt, nowMs, periodMin }) {
  const now = subAt(ecefAt, nowMs);
  const half = Math.min(Number.isFinite(periodMin) ? periodMin / 2 : 45, 12 * 60) * MIN;
  return {
    centre: now ? globeCentre(now[0], now[1]) : { lonDeg: 0, latDeg: 0 },
    ground: track(ecefAt, nowMs - half, nowMs + half, Math.max(20_000, (2 * half) / 300)),
    sat: now ? { lonDeg: now[0], latDeg: now[1] } : null,
    altKm: now ? now[2] : null,
  };
}

/** "Sat 6:30 PM" in the place's own time zone. */
export function placeTime(ms, latDeg, lonDeg) {
  let timeZone = 'UTC';
  try { timeZone = tzlookup(latDeg, lonDeg); } catch { /* the open sea: UTC */ }
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone }).format(ms);
}

/** The two lines under a shared pass's title. */
export function passLines({ ecefAt, sel }) {
  const { observer, win, maxAlt } = sel;
  const where = observer.name ? ` from ${placeName(observer)}` : '';
  const dir = (ms) => {
    const e = ecefAt(new Date(ms));
    return e ? compass(satAltAzDeg(observer, e).az) : null;
  };
  const from = dir(win.startMs), to = dir(win.endMs);
  const way = from && to ? ` · ${from} to ${to}` : '';
  return [
    `${placeTime(win.startMs, observer.latDeg, observer.lonDeg)}${where}`,
    `Up to ${Math.round(maxAlt)}°${way} · seeksat.com`,
  ];
}
