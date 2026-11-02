// lib/passes/pass-words.mjs - plain-language helpers for a pass: why it is
// rated as it is, where to look, the best pass of the day, and rise Doppler.

import { compass } from '../sat/pass-rows.mjs';
import { geodeticToEcef } from '../coords.js';

const C = 299_792_458;
const LEVEL_RANK = { good: 2, ok: 1, low: 0 };
const HOUR = 3_600_000;

const CAUSE_WORDS = { cloudy: 'cloudy', 'some-cloud': 'some cloud', faint: 'faint', twilight: 'twilight' };

/** The few words after "Low:" or "OK:" on a badge, or null for Good. A visual
 *  rating carries its own cause; an elevation rating says how high the pass gets. */
export function ratingShort(rating, pass, { mode = 'radio' } = {}) {
  if (!rating || rating.level === 'good') return null;
  const up = Number.isFinite(pass?.maxElevDeg) ? `${Math.round(pass.maxElevDeg)}° up` : null;
  if (mode !== 'visual') return up;
  const cause = rating.cause;
  if (cause === 'low') return up;
  return CAUSE_WORDS[cause] ?? null;
}

const clockFormats = new Map();
function defaultClock(ms, timeZone) {
  let f = clockFormats.get(timeZone);
  if (!f) {
    try { f = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone }); }
    catch { f = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }); }
    clockFormats.set(timeZone, f);
  }
  return f.format(ms);
}

const AM_PM = /\s?[AP]M$/i;
const deg = (x) => Math.round(x);

/** "Rises NW 6:27 PM · peaks 26° SW 6:29 · fades in the SE 6:31". The day
 *  period shows only on the first time while the rest share it. Radio says
 *  "sets SE 6:33". clock(ms, timeZone) formats a time. */
export function passWords(pass, { timeZone, mode = 'radio', clock = defaultClock } = {}) {
  const first = clock(pass.startMs, timeZone);
  const period = first.match(AM_PM)?.[0].trim().toUpperCase() ?? null;
  const short = (ms) => {
    const t = clock(ms, timeZone);
    const m = t.match(AM_PM)?.[0].trim().toUpperCase();
    return period && m === period ? t.replace(AM_PM, '') : t;
  };
  const fades = pass.endElevDeg > 1;
  const end = fades
    ? `fades in the ${compass(pass.endAzDeg)} ${short(pass.endMs)}`
    : `sets ${compass(pass.endAzDeg)} ${short(pass.endMs)}`;
  return `Rises ${compass(pass.startAzDeg)} ${first} · peaks ${deg(pass.maxElevDeg)}° ${compass(pass.peakAzDeg)} ${short(pass.peakMs)} · ${end}`;
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
