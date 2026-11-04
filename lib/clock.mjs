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
