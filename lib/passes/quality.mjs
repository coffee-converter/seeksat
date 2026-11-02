// lib/passes/quality.mjs - a one-word rating for a pass, from how high it gets.
// Higher passes are longer, closer and clear of trees and buildings; around
// 20-30 degrees is where operators start calling a pass worth working.

const GOOD_DEG = 40;
const OK_DEG = 20;

/** Good, OK or Low, with a sentence saying why. A missing elevation is Low. */
export function passQuality(pass) {
  const el = pass?.maxElevDeg;
  if (el >= GOOD_DEG) return { level: 'good', label: 'Good', reason: 'High pass, well clear of the horizon.' };
  if (el >= OK_DEG) return { level: 'ok', label: 'OK', reason: 'Medium pass.' };
  return { level: 'low', label: 'Low', reason: 'Low pass, close to the horizon.' };
}
