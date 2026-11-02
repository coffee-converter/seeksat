// lib/home/view.mjs - small pure helpers behind the home screen components.
import { countdown } from './next-up.mjs';
import { formatPassDuration } from '../passes/format.mjs';
import { OLD_AFTER_DAYS } from '../sat/numbers.mjs';

export const MIN_ELEV_STEP = 5;
export const MIN_ELEV_MAX = 45;

/** The tracks for the followed ids, in following order (the map's colour order). */
export function followedTracks(tracks, following) {
  const out = new Map();
  for (const id of following) {
    const t = tracks.get(id);
    if (t) out.set(id, t);
  }
  return out;
}

/** One stepper press: the next multiple of 5° in that direction, within 0 to 45. */
export function stepMinElev(current, direction) {
  const next = direction > 0
    ? Math.floor(current / MIN_ELEV_STEP) * MIN_ELEV_STEP + MIN_ELEV_STEP
    : Math.ceil(current / MIN_ELEV_STEP) * MIN_ELEV_STEP - MIN_ELEV_STEP;
  return Math.max(0, Math.min(MIN_ELEV_MAX, next));
}

/** When the cards next go stale: an upcoming pass starts or one in progress ends. */
export function nextCardChangeMs(cards) {
  let at = Infinity;
  for (const c of cards) {
    if (c.kind !== 'pass') continue;
    at = Math.min(at, c.pass.inProgress ? c.pass.endMs : c.pass.startMs);
  }
  return at;
}

/**
 * Should the cards refresh now? Never while a job is in flight, and not before
 * a failed job's backoff ends (retryAtMs). Otherwise when the cards are older
 * than refreshMs or a pass has started or ended. With no cards yet, only a
 * pending retry can start one (the first load comes from the input effect).
 */
export function shouldRefreshCards({ cardState, nowMs, inFlight, retryAtMs, refreshMs }) {
  if (inFlight || nowMs == null) return false;
  if (retryAtMs != null && nowMs < retryAtMs) return false;
  if (!cardState) return retryAtMs != null;
  return nowMs - cardState.at >= refreshMs || nowMs >= nextCardChangeMs(cardState.cards);
}

export function timeFormat(locale, timeZone) {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone });
}

/** "14:02–14:12", with the weekday in front of a time that falls on another
 *  day than the one before it (now for the start, the start for the end). */
export function passTimesLabel(startMs, endMs, nowMs, { locale, timeZone } = {}) {
  const time = timeFormat(locale, timeZone);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone });
  const dayKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone });
  const at = (ms, refMs) => (dayKey.format(ms) === dayKey.format(refMs)
    ? time.format(ms)
    : `${weekday.format(ms)} ${time.format(ms)}`);
  return `${at(startMs, nowMs)}–${at(endMs, startMs)}`;
}

/** A pass card's second line: "14:02–14:12 · 10m00s", or for a pass already
 *  up (whose start the engine clamps to now) when it sets and how long is left. */
export function passMetaLabel(pass, nowMs, { locale, timeZone } = {}) {
  if (pass.inProgress || nowMs >= pass.startMs) {
    const until = timeFormat(locale, timeZone).format(pass.endMs);
    return `Up now, until ${until} (${countdown(pass.endMs - nowMs)} left)`;
  }
  return `${passTimesLabel(pass.startMs, pass.endMs, nowMs, { locale, timeZone })} · ${formatPassDuration(pass.durationMs / 1000)}`;
}

const STALE_ELEMENTS_HOURS = OLD_AFTER_DAYS * 24;

/** How long ago satellites were saved: "less than a minute", "12 min", "3 h",
 *  "1 day", "2 days". Null without a time. */
export function savedAgeText(thenMs, nowMs) {
  if (!Number.isFinite(thenMs) || !Number.isFinite(nowMs)) return null;
  const min = Math.max(0, Math.floor((nowMs - thenMs) / 60_000));
  if (min < 1) return 'less than a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

/** The line shown when satellites come from the service worker's cache. It
 *  measures the saved snapshot's generatedAtMs, so it says how old the data
 *  is, not when it was saved. Null without a time. */
export function savedAgeNotice(generatedAtMs, nowMs) {
  const age = savedAgeText(generatedAtMs, nowMs);
  return age ? `Satellite data is ${age} old.` : null;
}

/** Cues about where a card's elements came from: pasted, or over a week old.
 *  With nowMs the age runs from the track's epoch on the live clock, so a
 *  record the service worker saved days ago still shows its true age; the
 *  server's tleAgeHours was only true when it answered. */
export function elementTags(track, nowMs) {
  const rec = track.record ?? {};
  const tags = [];
  if (rec.source === 'pasted') tags.push('pasted');
  const ageHours = Number.isFinite(nowMs) && Number.isFinite(track.epochMs)
    ? (nowMs - track.epochMs) / 3_600_000
    : rec.tleAgeHours;
  if (Number.isFinite(ageHours) && ageHours > STALE_ELEMENTS_HOURS) {
    tags.push(`elements ${Math.floor(ageHours / 24)} days old`);
  }
  return tags;
}
