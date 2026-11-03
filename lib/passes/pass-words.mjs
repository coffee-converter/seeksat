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
 *  rating carries its own cause; an elevation rating says how high the pass
 *  gets. A cloud cause gives null, as the cloud badge carries it. */
export function ratingShort(rating, pass, { mode = 'radio' } = {}) {
  if (!rating || rating.level === 'good') return null;
  const up = Number.isFinite(pass?.maxElevDeg) ? `${Math.round(pass.maxElevDeg)}° up` : null;
  if (mode !== 'visual') return up;
  const cause = rating.cause;
  if (cause === 'low') return up;
  return CAUSE_WORDS[cause] ?? null;
}

const deg = (x) => Math.round(x);

/** "Rises NW 06:27 PM · peaks 26° SW 06:29 PM · fades in the SE 06:31 PM".
 *  The first part says "Up now" for a pass already up, "Appears 26° NW …"
 *  for a visual pass that starts mid-sky (leaving Earth's shadow), else
 *  "Rises". The "peaks" part is left out when the peak is the start (within
 *  30 s, or within 1° of the start elevation). The last part says "fades"
 *  only for a visual pass that ends in Earth's shadow while still above the
 *  horizon, "sets" when the horizon is the limit, and "drops below N°" when a
 *  higher minimum elevation ends it. clock(ms, timeZone) formats a time; the
 *  default is the home cards' format. */
export function passWords(pass, { timeZone, mode = 'radio', minElevDeg = 0, locale, clock } = {}) {
  const at = clock ?? ((ms, tz) => timeFormat(locale, tz).format(ms));
  const visual = mode === 'visual';
  const startDir = compass(pass.startAzDeg);
  let start;
  if (pass.inProgress) start = 'Up now';
  else if (visual && pass.startElevDeg > minElevDeg + 1) start = `Appears ${deg(pass.startElevDeg)}° ${startDir} ${at(pass.startMs, timeZone)}`;
  else start = `Rises ${startDir} ${at(pass.startMs, timeZone)}`;
  const peakIsStart = Math.abs(pass.peakMs - pass.startMs) <= PEAK_IS_START_MS
    || (Number.isFinite(pass.startElevDeg) && Math.abs(pass.maxElevDeg - pass.startElevDeg) <= 1);
  const peak = peakIsStart ? null : `peaks ${deg(pass.maxElevDeg)}° ${compass(pass.peakAzDeg)} ${at(pass.peakMs, timeZone)}`;
  const dir = compass(pass.endAzDeg);
  const t = at(pass.endMs, timeZone);
  let end;
  if (visual && !pass.runsPastEnd && pass.endElevDeg > minElevDeg + 1) end = `fades in the ${dir} ${t}`;
  else if (minElevDeg > 0) end = `drops below ${minElevDeg}° ${dir} ${t}`;
  else end = `sets ${dir} ${t}`;
  return [start, peak, end].filter(Boolean).join(' · ');
}

/** The best pass across the cards: by rating level, then maximum elevation.
 *  rate(card, pass) gives { level, ... }. Null with no passes, or when the
 *  best pass is also the soonest one (it would repeat the first card). With
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
  if (best === null || best.pass === soonest) return null;
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
