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
