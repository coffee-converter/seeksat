// lib/home/view.mjs - small pure helpers behind the home screen components.

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

/** "14:02–14:12", with the weekday in front of a time that falls on another
 *  day than the one before it (now for the start, the start for the end). */
export function passTimesLabel(startMs, endMs, nowMs, { locale, timeZone } = {}) {
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone });
  const dayKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone });
  const at = (ms, refMs) => (dayKey.format(ms) === dayKey.format(refMs)
    ? time.format(ms)
    : `${weekday.format(ms)} ${time.format(ms)}`);
  return `${at(startMs, nowMs)}–${at(endMs, startMs)}`;
}
