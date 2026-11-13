// lib/passes/pass-words.mjs - plain-language helpers for a pass: why it is
// rated as it is, where to look, the best pass of the day, and its Doppler.

import { compass } from '../sat/pass-rows.mjs';
import { notStarted, startIsRise } from './under-way.mjs';
import { geodeticToEcef } from '../coords.js';

const C = 299_792_458;
const LEVEL_RANK = { good: 2, ok: 1, low: 0 };
const HOUR = 3_600_000;

// Cloud is not here: the cloud badge beside the rating says it, once.
const CAUSE_WORDS = { faint: 'faint', twilight: 'twilight' };
const PEAK_IS_START_MS = 30_000;

/** The few words after "Poor:" or "Fair:" on a badge, or null from Good up
 *  (3 bars or more). A visual rating carries its own cause ("faint",
 *  "twilight", or "N° up" when low in the sky). A cloud cause gives null, as
 *  the cloud badge carries it, and so does radio mode, whose card already
 *  shows the max elevation. */
export function ratingShort(rating, pass, { mode = 'radio' } = {}) {
  if (!rating) return null;
  if (Number.isFinite(rating.bars) ? rating.bars >= 3 : rating.level === 'good') return null;
  // Radio cards already print the max elevation, so the badge stays a word.
  if (mode !== 'visual') return null;
  const up = Number.isFinite(pass?.maxElevDeg) ? `${Math.round(pass.maxElevDeg)}° up` : null;
  const cause = rating.cause;
  if (cause === 'low') return up;
  return CAUSE_WORDS[cause] ?? null;
}

/** The best pass across the cards: by rating level, then maximum elevation.
 *  rate(card, pass) gives { level, ... }. Null with no passes, when the best
 *  pass rates Poor or Fair (level low), or when it is also the soonest one (it would repeat the
 *  first card). With
 *  nowMs, only passes starting within `hours` count. */
export function bestPass(cards, { rate, nowMs = null, hours = 24 } = {}) {
  let best = null;
  let soonest = null;
  const endMs = nowMs == null ? Infinity : nowMs + hours * HOUR;
  for (const card of cards ?? []) {
    if (card.kind !== 'pass') continue;
    for (const pass of card.passes ?? [card.pass]) {
      if (!pass || pass.startMs >= endMs) continue;
      if (soonest === null || pass.startMs < soonest.startMs) soonest = pass;
      const rating = rate(card, pass);
      const rank = LEVEL_RANK[rating?.level] ?? 0;
      const el = pass.maxElevDeg ?? -Infinity;
      if (best === null || rank > best.rank || (rank === best.rank && el > best.pass.maxElevDeg)) {
        best = { rank, noradId: card.noradId, name: card.name, pass, rating };
      }
    }
  }
  // A best pass that still rates Poor or Fair is not worth pointing at.
  if (best === null || best.pass === soonest || best.rank === 0) return null;
  return { noradId: best.noradId, name: best.name, pass: best.pass, rating: best.rating };
}

/** The pass as up to three steps for the card's path strip: where it rises
 *  (or appears, or comes above the minimum), where it peaks, where it sets
 *  (or fades, or drops below the minimum), each { label, dir, ms }. No first
 *  step for a pass already up (by nowMs, when given), and no peak step when
 *  the peak is its start or end. */
export function passPath(pass, { mode = 'radio', minElevDeg = 0, nowMs = null } = {}) {
  const visual = mode === 'visual';
  const steps = [];
  if (startIsRise(pass) && (nowMs == null || notStarted(pass, nowMs))) {
    const label = visual && pass.startElevDeg > minElevDeg + 1 ? 'Appears'
      : minElevDeg > 0 ? `Above ${minElevDeg}°` : 'Rises';
    steps.push({ key: 'start', label, dir: compass(pass.startAzDeg), ms: pass.startMs });
  }
  const peakIsStart = Math.abs(pass.peakMs - pass.startMs) <= PEAK_IS_START_MS
    || (Number.isFinite(pass.startElevDeg) && Math.abs(pass.maxElevDeg - pass.startElevDeg) <= 1);
  const peakIsEnd = Math.abs(pass.endMs - pass.peakMs) <= PEAK_IS_START_MS;
  if (!peakIsStart && !peakIsEnd && !(!startIsRise(pass) && pass.peakMs < pass.startMs)) {
    steps.push({ key: 'peak', label: 'Peaks', dir: compass(pass.peakAzDeg), ms: pass.peakMs });
  }
  const endLabel = visual && !pass.runsPastEnd && pass.endElevDeg > minElevDeg + 1 ? 'Fades'
    : minElevDeg > 0 ? `Below ${minElevDeg}°` : 'Sets';
  steps.push({ key: 'end', label: endLabel, dir: compass(pass.endAzDeg), ms: pass.endMs });
  return steps;
}

/** Doppler shift in Hz at a moment of the pass: positive while the satellite
 *  approaches. Range rate from ECEF at ms and ms + 1 s; null if the track
 *  cannot be propagated there. */
export function dopplerHzAt(track, observer, ms, freqHz) {
  const a = track.ecefAt(new Date(ms));
  const b = track.ecefAt(new Date(ms + 1000));
  if (!a || !b || !Number.isFinite(freqHz)) return null;
  const o = geodeticToEcef(observer.latDeg, observer.lonDeg, observer.elevM ?? 0);
  const range = (s) => Math.hypot(s[0] - o[0], s[1] - o[1], s[2] - o[2]);
  return -(range(b) - range(a)) / C * freqHz;
}
