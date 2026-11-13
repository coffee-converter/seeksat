// lib/live/dome.mjs - the live view's sky dome (components/live/LiveDial.tsx):
// the track split at now, minute ticks along it, and where labels go.

const MINUTE_MS = 60_000;
const SIDE_MS = 5_000;

const lerp = (a, b, f) => a + (b - a) * f;

/** Azimuth between two samples, the short way round. */
function lerpAz(a, b, f) {
  const d = ((b - a + 540) % 360) - 180;
  return (((a + d * f) % 360) + 360) % 360;
}

/** { azDeg, elDeg } at tMs, interpolated; null outside the samples. */
export function trackAt(samples, tMs) {
  const n = samples.length;
  if (!n || tMs < samples[0].tMs || tMs > samples[n - 1].tMs) return null;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].tMs <= tMs) lo = mid; else hi = mid;
  }
  const a = samples[lo], b = samples[hi];
  const f = b.tMs > a.tMs ? (tMs - a.tMs) / (b.tMs - a.tMs) : 0;
  return { azDeg: lerpAz(a.azDeg, b.azDeg, f), elDeg: lerp(a.elDeg, b.elDeg, f) };
}

/** The track above the horizon in two parts that meet at now: flown (up to
 *  now) and ahead (from now). Before rise all of it is ahead; after set all
 *  of it is flown. Each part is a list of { azDeg, elDeg }. */
export function splitTrack(samples, nowMs) {
  const up = samples.filter((s) => s.elDeg >= 0);
  const flown = [], ahead = [];
  for (const s of up) (s.tMs <= nowMs ? flown : ahead).push({ azDeg: s.azDeg, elDeg: s.elDeg });
  const here = trackAt(up, nowMs);
  if (here && here.elDeg >= 0) {
    flown.push(here);
    ahead.unshift(here);
  }
  return { flown, ahead };
}

/** A point on the track at every whole minute above the horizon, with the
 *  points a few seconds either side (`before`, `after`; the point itself at
 *  an end) so a tick can be drawn across the track. */
export function minuteTicks(samples) {
  const n = samples.length;
  if (n < 2) return [];
  const first = samples[0].tMs, last = samples[n - 1].tMs;
  const ticks = [];
  for (let t = Math.ceil(first / MINUTE_MS) * MINUTE_MS; t <= last; t += MINUTE_MS) {
    const at = trackAt(samples, t);
    if (!at || at.elDeg < 0) continue;
    const before = trackAt(samples, t - SIDE_MS) ?? at;
    const after = trackAt(samples, t + SIDE_MS) ?? at;
    ticks.push({ tMs: t, ...at, before, after });
  }
  return ticks;
}

/** Where a time label goes for a point (x, y) on the track of a dial of
 *  radius r (centre 0,0), with (dx, dy) the direction of travel there. The
 *  label steps off the track to one side: toward the centre, or away from it
 *  for a point near the centre (a high peak, where the inside is crowded by
 *  the pointer). It is kept inside the horizon ring and anchored so the text
 *  runs the way it stepped, so it never reaches the N/E/S/W letters outside
 *  the ring. */
export function labelSpot(x, y, r, dx = 0, dy = 0, gap = 14) {
  const d = Math.hypot(x, y);
  const out = d < r / 3;
  // Unit vector toward the centre (straight up for the centre itself).
  const cx = d > 0 ? -x / d : 0, cy = d > 0 ? -y / d : -1;
  const len = Math.hypot(dx, dy);
  // Across the track, on the side wanted; straight in or out with no direction.
  let nx = cx, ny = cy;
  if (len > 0) {
    nx = -dy / len; ny = dx / len;
    if (nx * cx + ny * cy < 0) { nx = -nx; ny = -ny; }
  }
  if (out) { nx = -nx; ny = -ny; }
  let lx = x + nx * gap, ly = y + ny * gap;
  // Inside the ring with room for the text's height.
  const ld = Math.hypot(lx, ly);
  if (ld > r - gap) { lx *= (r - gap) / ld; ly *= (r - gap) / ld; }
  // Text toward the centre line when stepping in, away from it stepping out.
  const toward = out ? lx : -lx;
  const anchor = Math.abs(lx) < r * 0.15 ? 'middle' : toward > 0 ? 'start' : 'end';
  return { x: lx, y: ly, anchor };
}
