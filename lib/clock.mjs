// lib/clock.mjs - the one clock for pass times across the site.

const cache = new Map();

/** "4:12 AM" for a 12-hour locale, "04:12" for a 24-hour one, in timeZone. */
export function clockFormat(locale, timeZone) {
  const key = `${locale ?? ''}|${timeZone ?? ''}`;
  let f = cache.get(key);
  if (!f) {
    const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone }).resolvedOptions().hourCycle;
    const twelve = cycle === 'h12' || cycle === 'h11';
    f = new Intl.DateTimeFormat(locale, { hour: twelve ? 'numeric' : '2-digit', minute: '2-digit', timeZone });
    cache.set(key, f);
  }
  return f;
}

// Day and weekday formats by zone, built once: lists ask for them per row.
const dayFormats = new Map();
function dayFormat(kind, timeZone) {
  const key = `${kind}|${timeZone ?? ''}`;
  let f = dayFormats.get(key);
  if (!f) {
    f = kind === 'day'
      ? new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone })
      : new Intl.DateTimeFormat('en-US', { weekday: kind, timeZone });
    dayFormats.set(key, f);
  }
  return f;
}

/** "2026-11-13": the calendar day of `ms` in timeZone, for comparing days. */
export function dayKey(ms, timeZone) {
  return dayFormat('day', timeZone).format(ms);
}

/** "Fri" (short) or "Friday" (long), in timeZone. */
export function weekdayName(ms, timeZone, kind = 'short') {
  return dayFormat(kind, timeZone).format(ms);
}
