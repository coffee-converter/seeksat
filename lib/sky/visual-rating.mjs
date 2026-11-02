// lib/sky/visual-rating.mjs - Good/OK/Low for a visual pass, from how bright
// the satellite gets against how dark the sky is, then the cloud forecast.

import { naturalSkyLimMag } from '../pass-finder/sky-helpers.js';
import { passQuality } from '../passes/quality.mjs';

export const SKY_TYPES = [
  { id: 'city', label: 'City', limit: 3.5 },
  { id: 'suburban', label: 'Suburban', limit: 4.5 },
  { id: 'rural', label: 'Rural', limit: 5.5 },
  { id: 'dark', label: 'Dark site', limit: 6.5 },
];
export const DEFAULT_SKY = 'suburban';

const GOOD_HEADROOM = 3.0;
const OK_HEADROOM = 1.5;
const BRIGHT_SKY_SUN_DEG = -12;

const LEVELS = [
  { level: 'low', label: 'Low' },
  { level: 'ok', label: 'OK' },
  { level: 'good', label: 'Good' },
];
const indexOf = (level) => LEVELS.findIndex((l) => l.level === level);

/** Faintest star visible at this Sun altitude under this sky type. */
export function limitingMag(sunAltDeg, skyType) {
  const sky = SKY_TYPES.find((s) => s.id === skyType) ?? SKY_TYPES.find((s) => s.id === DEFAULT_SKY);
  return Math.min(naturalSkyLimMag(sunAltDeg), sky.limit);
}

/** Atmospheric dimming in magnitudes at this elevation (airmass floored at 5 degrees). */
export function extinctionMag(elDeg) {
  const el = Math.max(elDeg, 5) * Math.PI / 180;
  return 0.2 * (1 / Math.sin(el) - 1);
}

/** Magnitude text with a true minus sign and one decimal. */
export function formatMag(m) {
  const s = (Math.round(m * 10) / 10).toFixed(1);
  return s.startsWith('-') ? `−${s.slice(1)}` : s;
}

export function visualQuality(pass, { skyType = DEFAULT_SKY, cloud = null } = {}) {
  let idx;
  let reason;
  if (typeof pass?.peakMag === 'number' && Number.isFinite(pass.peakMag)) {
    const headroom = Math.round((limitingMag(pass.peakMagSunAltDeg, skyType) - pass.peakMag) * 1e6) / 1e6;
    idx = headroom >= GOOD_HEADROOM ? 2 : headroom >= OK_HEADROOM ? 1 : 0;
    const n = Math.round(headroom);
    const mag = formatMag(pass.peakMag);
    reason = n < 1
      ? `Peak mag ${mag}, no brighter than the faintest stars you can see.`
      : `Peak mag ${mag}, about ${n} ${n === 1 ? 'magnitude' : 'magnitudes'} brighter than the faintest stars you can see.`;
  } else {
    idx = indexOf(passQuality(pass).level);
    if (pass?.peakSunAltDeg > BRIGHT_SKY_SUN_DEG) idx = Math.max(0, idx - 1);
    reason = 'Brightness unknown, so this is rated on height and sky darkness.';
  }
  if (cloud?.level === 'cloudy') {
    idx = 0;
    reason += ' Cloudy forecast.';
  } else if (cloud?.level === 'some') {
    idx = Math.max(0, idx - 1);
    reason += ' Some cloud forecast.';
  }
  return { ...LEVELS[idx], reason };
}
