// lib/mcp/why-empty.mjs - the reason behind an empty pass list, so an agent
// can tell the user why rather than guess: the satellite never gets high
// enough from this latitude, it sits below the horizon (geostationary), the
// sky never gets dark, none of its passes is lit in a dark sky, or there is
// simply no pass in the window.

import { orbitElements } from '../sat/numbers.mjs';
import { skyDarkness } from './sky.mjs';

const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6378.137;
const HOUR_MS = 3_600_000;
/** How often the sky is sampled for darkness. */
const DARK_STEP_MS = 15 * 60_000;

/** "65°N", "33°S". */
export function latText(latDeg) {
  return `${Math.abs(Math.round(latDeg))}°${latDeg >= 0 ? 'N' : 'S'}`;
}

/**
 * The highest a satellite can ever get above the horizon from this latitude,
 * in degrees: the ground track reaches latitudes up to the inclination (or
 * 180 minus it, retrograde), and the farthest point of the orbit gives the
 * widest view. An upper bound, so "never rises" is never said in error.
 */
export function maxElevationDeg(track, latDeg) {
  const { inclinationDeg, apogeeAltKm } = orbitElements(track);
  const reach = inclinationDeg <= 90 ? inclinationDeg : 180 - inclinationDeg;
  const psi = Math.max(0, Math.abs(latDeg) - reach) * DEG;
  const r = EARTH_RADIUS_KM + Math.max(0, apogeeAltKm);
  return Math.atan2(Math.cos(psi) - EARTH_RADIUS_KM / r, Math.sin(psi)) / DEG;
}

/** True when the sky gets dark enough for naked-eye satellites (Sun 6
 *  degrees down) at some point in the window. */
export function skyGetsDark(observer, startMs, windowHours) {
  const endMs = startMs + windowHours * HOUR_MS;
  for (let t = startMs; t <= endMs; t += DARK_STEP_MS) if (skyDarkness(observer, t).dark) return true;
  return false;
}

/**
 * One sentence on why a pass search found nothing.
 * @param {{ track: any, observer: { latDeg: number, lonDeg: number }, mode: string,
 *   minElevationDeg: number, windowHours: number, startMs: number,
 *   stationary?: { visible: boolean } | null, hasRadioPass?: () => boolean }} args
 *   hasRadioPass: whether the satellite has any line-of-sight pass in the
 *   window (asked only in visual mode, when it matters).
 */
export function noPassReason({ track, observer, mode, minElevationDeg, windowHours, startMs, stationary = null, hasRadioPass = () => true }) {
  const min = Math.round(minElevationDeg);
  if (stationary) {
    return stationary.visible
      ? 'Geostationary: it stays at one spot in your sky (see stationary), so it has no passes.'
      : `Geostationary: it stays below ${min}° here, so it is never in view from this place.`;
  }
  const top = maxElevationDeg(track, observer.latDeg);
  if (top < minElevationDeg) {
    const reach = top <= 0 ? 'it never comes above the horizon from there' : `it gets at most ${Math.max(0, Math.round(top))}° up there`;
    return `It never rises above ${min}° from ${latText(observer.latDeg)}: with an orbit inclined ${Math.round(orbitElements(track).inclinationDeg)}°, ${reach}.`;
  }
  if (mode === 'visual') {
    if (!skyGetsDark(observer, startMs, windowHours)) {
      return `The sky never gets dark enough here in the next ${windowHours} hours (the Sun stays less than 6° below the horizon), so nothing can be seen by eye. Try mode "radio".`;
    }
    if (hasRadioPass()) {
      return `It passes over in the next ${windowHours} hours, but none of those passes above ${min}° is sunlit while the sky is dark here. Try a longer windowHours, or mode "radio".`;
    }
  }
  return `No pass above ${min}° in the next ${windowHours} hours. Try a longer windowHours or a lower minElevation.`;
}
