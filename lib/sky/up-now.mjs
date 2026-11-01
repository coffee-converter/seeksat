// lib/sky/up-now.mjs - which tracked satellites are above the horizon now.
import { satAltAzDeg } from '../pass-finder/visibility.js';
import { apparentAltDeg } from '../refraction.js';
import { compass } from '../sat/pass-rows.mjs';

const round1 = (x) => Math.round(x * 10) / 10;
const RISING_LOOKAHEAD_MS = 30_000;

export const compassName = compass;

function elevationAt(track, observer, ms) {
  const ecef = track.ecefAt(new Date(ms));
  if (!ecef) return null;
  const { alt, az } = satAltAzDeg(observer, ecef);
  return { el: apparentAltDeg(alt), az };
}

/** Live SGP4 positions for one observer. colors: optional Map of noradId to colour. */
export function upNow({ tracks, observer, nowMs, minElevDeg = 0, colors = undefined }) {
  const out = [];
  for (const [noradId, track] of tracks) {
    const p = elevationAt(track, observer, nowMs);
    if (!p || p.el < minElevDeg) continue;
    const later = elevationAt(track, observer, nowMs + RISING_LOOKAHEAD_MS);
    const entry = {
      noradId,
      name: track.shortName ?? track.name,
      azDeg: round1(((p.az % 360) + 360) % 360),
      elDeg: round1(p.el),
      rising: later ? later.el > p.el : false,
    };
    const color = colors?.get(noradId);
    if (color) entry.color = color;
    out.push(entry);
  }
  return out.sort((a, b) => b.elDeg - a.elDeg);
}
