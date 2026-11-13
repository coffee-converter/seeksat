// lib/sky/visual-rating.mjs - Good/OK/Low for a visual pass, from how bright
// the satellite gets against how dark the sky is, then the cloud forecast.

import { naturalSkyLimMag } from '../pass-finder/sky-helpers.js';
import { barWord, barsIn, passQuality } from '../passes/quality.mjs';

export const SKY_TYPES = [
  { id: 'city', label: 'City', limit: 3.5 },
  { id: 'suburban', label: 'Suburban', limit: 4.5 },
  { id: 'rural', label: 'Rural', limit: 5.5 },
  { id: 'dark', label: 'Dark site', limit: 6.5 },
];
export const DEFAULT_SKY = 'suburban';

const GREAT_HEADROOM = 4.5;
const GOOD_HEADROOM = 3.0;
const OK_HEADROOM = 1.5;
const FAINT_HEADROOM = 0.5;
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

/** 1 to 5 bars from how much brighter than the faintest visible star the
 *  pass gets, split inside the levels: Low 1-2, OK 3, Good 4-5. */
function headroomBars(h) {
  if (h >= GREAT_HEADROOM) return 5;
  if (h >= GOOD_HEADROOM) return 4;
  if (h >= OK_HEADROOM) return 3;
  if (h >= FAINT_HEADROOM) return 2;
  return 1;
}

export function visualQuality(pass, { skyType = DEFAULT_SKY, cloud = null } = {}) {
  let idx;
  let bars;
  let reason;
  let cause = null;
  if (Number.isFinite(pass?.peakMag) && Number.isFinite(pass?.peakMagSunAltDeg)) {
    const headroom = Math.round((limitingMag(pass.peakMagSunAltDeg, skyType) - pass.peakMag) * 1e6) / 1e6;
    idx = headroom >= GOOD_HEADROOM ? 2 : headroom >= OK_HEADROOM ? 1 : 0;
    bars = headroomBars(headroom);
    const n = Math.round(headroom);
    const mag = formatMag(pass.peakMag);
    if (idx < 2) cause = 'faint';
    // Its size is not known: the magnitude is a cautious guess, so the rating
    // stops at Fair however bright the guess comes out.
    const guess = pass.peakMagEstimated === true;
    if (guess) {
      bars = Math.min(bars, 2);
      idx = 0;
      cause = 'faint';
    }
    reason = guess
      ? `Estimated peak mag ${mag}. Its size isn't known, so this assumes a small satellite and rates it no higher than Fair.`
      : headroom <= 0
      ? `Peak mag ${mag}, no brighter than the faintest stars you can see.`
      : n < 1
        ? `Peak mag ${mag}, about as bright as the faintest stars you can see.`
        : `Peak mag ${mag}, about ${n} ${n === 1 ? 'magnitude' : 'magnitudes'} brighter than the faintest stars you can see.`;
  } else {
    const q = passQuality(pass);
    idx = indexOf(q.level);
    bars = q.bars;
    if (idx < 2) cause = 'low';
    // A missing Sun altitude is no evidence of a dark sky, so it drops too.
    const sunAlt = pass?.peakSunAltDeg;
    if (!Number.isFinite(sunAlt) || sunAlt > BRIGHT_SKY_SUN_DEG) {
      if (idx > 0) cause = 'twilight';
      idx = Math.max(0, idx - 1);
    }
    reason = 'Brightness unknown, so this is rated on height and sky darkness.';
  }
  if (cloud?.level === 'cloudy') {
    if (idx > 0) cause = 'cloudy';
    idx = 0;
    reason += ' Cloudy forecast.';
  } else if (cloud?.level === 'some') {
    if (idx > 0) cause = 'some-cloud';
    idx = Math.max(0, idx - 1);
    reason += ' Some cloud forecast.';
  }
  // Cloudy is one bar; any other step down keeps the bars inside the new level.
  bars = cloud?.level === 'cloudy' ? 1 : barsIn(LEVELS[idx].level, bars);
  return { level: LEVELS[idx].level, label: barWord(bars), bars, reason, cause: idx === 2 ? null : cause };
}
