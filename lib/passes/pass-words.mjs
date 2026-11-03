// lib/passes/pass-words.mjs - plain-language helpers for a pass: why it is
// rated as it is, where to look, the best pass of the day, and rise Doppler.

import { compass } from '../sat/pass-rows.mjs';
import { timeFormat } from '../home/view.mjs';
import { geodeticToEcef } from '../coords.js';

const C = 299_792_458;
const LEVEL_RANK = { good: 2, ok: 1, low: 0 };
const HOUR = 3_600_000;

// Cloud is not here: the cloud badge beside the rating says it, once.
const CAUSE_WORDS = { faint: 'faint', twilight: 'twilight' };
const PEAK_IS_START_MS = 30_000;

/** The few words after "Low:" or "OK:" on a badge, or null for Good. A visual
 *  rating carries its own cause ("faint", "twilight", or "N° up" when low in
 *  the sky). A cloud cause gives null, as the cloud badge carries it, and so
 *  does radio mode, whose card already shows the max elevation. */
export function ratingShort(rating, pass, { mode = 'radio' } = {}) {
  if (!rating || rating.level === 'good') return null;
  // Radio cards already print the max elevation, so the badge stays a word.
  if (mode !== 'visual') return null;
  const up = Number.isFinite(pass?.maxElevDeg) ? `${Math.round(pass.maxElevDeg)}° up` : null;
  const cause = rating.cause;
  if (cause === 'low') return up;
  return CAUSE_WORDS[cause] ?? null;
}

const deg = (x) => Math.round(x);

/** "Rises NW 06:27 PM · peaks 26° SW 06:29 PM · fades in the SE 06:31 PM".
 *  The first part is left out for a pass already up, "Appears 26° NW …"
 *  for a visual pass that starts mid-sky (leaving Earth's shadow), else
 *  "Rises". The "peaks" part is left out when the peak is the start (within
 *  30 s, or within 1° of the start elevation). The last part says "fades"
 *  only for a visual pass that ends in Earth's shadow while still above the
 *  horizon, "sets" when the horizon is the limit, and "drops below N°" when a
 *  higher minimum elevation ends it. clock(ms, timeZone) formats a time; the
 *  default is the home cards' format. startTime: false leaves the start time
 *  out, for a card whose Starts column already shows it; there a visual pass
 *  that appears at its peak says so, rather than repeat the Max column. */
export function passWords(pass, { timeZone, mode = 'radio', minElevDeg = 0, locale, clock, startTime = true } = {}) {
  const at = clock ?? ((ms, tz) => timeFormat(locale, tz).format(ms));
  const visual = mode === 'visual';
  const startDir = compass(pass.startAzDeg);
  const st = startTime ? ` ${at(pass.startMs, timeZone)}` : '';
  let start;
  // A pass already up is introduced by the card's own "Up now, until ..." line,
  // so it has no start clause and its end clause leaves out the time.
  if (pass.inProgress) start = null;
  else if (visual && pass.startElevDeg > minElevDeg + 1) start = `Appears ${deg(pass.startElevDeg)}° ${startDir}${st}`;
  else if (minElevDeg > 0) start = `Rises above ${minElevDeg}° ${startDir}${st}`;
  else start = `Rises ${startDir}${st}`;
  const peakIsStart = Math.abs(pass.peakMs - pass.startMs) <= PEAK_IS_START_MS
    || (Number.isFinite(pass.startElevDeg) && Math.abs(pass.maxElevDeg - pass.startElevDeg) <= 1);
  const peakIsEnd = Math.abs(pass.endMs - pass.peakMs) <= PEAK_IS_START_MS;
  // Without its time, "Appears 35° SE" only repeats a Max column of 35° SE.
  if (!startTime && peakIsStart && start?.startsWith('Appears ')) start = 'Appears at its peak';
  const peak = peakIsStart || peakIsEnd ? null : `peaks ${deg(pass.maxElevDeg)}° ${compass(pass.peakAzDeg)} ${at(pass.peakMs, timeZone)}`;
  const dir = compass(pass.endAzDeg);
  const t = pass.inProgress ? '' : ` ${at(pass.endMs, timeZone)}`;
  let end;
  if (visual && !pass.runsPastEnd && pass.endElevDeg > minElevDeg + 1) end = `fades in the ${dir}${t}`;
  else if (minElevDeg > 0) end = `drops below ${minElevDeg}° ${dir}${t}`;
  else end = `sets ${dir}${t}`;
  return [start, peak, end].filter(Boolean).join(' · ');
}

/** The best pass across the cards: by rating level, then maximum elevation.
 *  rate(card, pass) gives { level, ... }. Null with no passes, when the best
 *  pass rates Low, or when it is also the soonest one (it would repeat the
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
  // A best pass that still rates Low is not worth pointing at.
  if (best === null || best.pass === soonest || best.rank === 0) return null;
  return { noradId: best.noradId, name: best.name, pass: best.pass, rating: best.rating };
}

/** Doppler shift in Hz at pass start: positive while the satellite approaches.
 *  Range rate comes from ECEF at startMs and startMs + 1 s. Null if the track
 *  cannot be propagated there. */
export function riseDopplerHz(track, observer, pass, freqHz) {
  const a = track.ecefAt(new Date(pass.startMs));
  const b = track.ecefAt(new Date(pass.startMs + 1000));
  if (!a || !b || !Number.isFinite(freqHz)) return null;
  const o = geodeticToEcef(observer.latDeg, observer.lonDeg, observer.elevM ?? 0);
  const range = (s) => Math.hypot(s[0] - o[0], s[1] - o[1], s[2] - o[2]);
  const rangeRate = range(b) - range(a);
  return -rangeRate / C * freqHz;
}
