// lib/passes/quality.mjs - a one-word rating for a pass, from how high it gets.
// Higher passes are longer, closer and clear of trees and buildings; around
// 20-30 degrees is where operators start calling a pass worth working.

const GOOD_DEG = 40;
const OK_DEG = 20;

const GREAT_DEG = 60;
const SCRAPE_DEG = 10;

/** 1 to 5 signal bars from the max elevation: Low is 1-2, OK 3, Good 4-5. */
export function elevationBars(el) {
  if (el >= GREAT_DEG) return 5;
  if (el >= GOOD_DEG) return 4;
  if (el >= OK_DEG) return 3;
  if (el >= SCRAPE_DEG) return 2;
  return 1;
}

/** The bars each level may show, lowest first. */
const BAR_BANDS = { low: [1, 2], ok: [3, 3], good: [4, 5] };

/** Bars kept inside a level's band, for a rating stepped down by cloud or twilight. */
export function barsIn(level, bars) {
  const [lo, hi] = BAR_BANDS[level] ?? BAR_BANDS.low;
  return Math.min(hi, Math.max(lo, bars));
}

/** The word for each bar count, 1 to 5: one word per count, so the word and
 *  the bars always agree. */
export const BAR_WORDS = ['Poor', 'Fair', 'Good', 'Great', 'Excellent'];

/** The word for 1 to 5 bars. */
export const barWord = (bars) => BAR_WORDS[Math.min(5, Math.max(1, bars)) - 1];

/** A rating from the max elevation: 1 to 5 bars, their word, a sentence saying
 *  why, and the coarse level (low 1-2 bars, ok 3, good 4-5) other code ranks
 *  by. A missing elevation is one bar. */
export function passQuality(pass) {
  const el = pass?.maxElevDeg;
  const bars = elevationBars(el);
  const label = barWord(bars);
  if (el >= GOOD_DEG) return { level: 'good', label, bars, reason: 'High pass, well clear of the horizon.' };
  if (el >= OK_DEG) return { level: 'ok', label, bars, reason: 'Medium pass.' };
  return { level: 'low', label, bars, reason: 'Low pass, close to the horizon.' };
}

/** Slant range (km) under which range costs a radio pass nothing: a low
 *  orbit near the horizon is about this far, and its height already rates it. */
const RANGE_REF_KM = 2000;
/** Each full step of this much extra free-space path loss costs one bar. */
const DB_PER_BAR = 6;

/** Extra free-space path loss (dB) of rangeKm over RANGE_REF_KM, or 0. */
function extraLossDb(rangeKm) {
  return Number.isFinite(rangeKm) && rangeKm > RANGE_REF_KM ? 20 * Math.log10(rangeKm / RANGE_REF_KM) : 0;
}

/** Bars a radio pass loses for its slant range at the peak: one per full
 *  6 dB beyond 2,000 km (8,000 km is 12 dB, two bars). Unknown: none. */
export function rangeBarsOff(rangeKm) {
  return Math.floor(extraLossDb(rangeKm) / DB_PER_BAR);
}

/** Radio bars from the peak elevation and the slant range there, at least 1. */
export function radioBars(el, rangeKm) {
  return Math.max(1, elevationBars(el) - rangeBarsOff(rangeKm));
}

const levelOfBars = (bars) => (bars >= 4 ? 'good' : bars === 3 ? 'ok' : 'low');

/** The radio rating: passQuality's, less a bar per 6 dB of extra path loss
 *  when the satellite is far away at its peak (passRating in lib/mcp). */
export function radioQuality(pass, rangeKm) {
  const q = passQuality(pass);
  const off = rangeBarsOff(rangeKm);
  if (!off) return q;
  const bars = radioBars(pass?.maxElevDeg, rangeKm);
  const km = Math.round(rangeKm).toLocaleString('en-US');
  const db = Math.round(extraLossDb(rangeKm));
  return {
    level: levelOfBars(bars),
    label: barWord(bars),
    bars,
    reason: `${q.reason} It is ${km} km away, about ${db} dB weaker than at 2,000 km.`,
  };
}
