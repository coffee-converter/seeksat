// lib/time/zone.mjs - the time zone of a place, so pass times read as the
// clock someone standing there would see, and a note for when that clock is
// not the viewer's. The lookup (a lat/lon to zone map, @photostructure/
// tz-lookup) is injected: the page loads it on demand, and it runs on the
// device, so the place is never sent anywhere.

/** True when Intl knows the zone. */
function knownZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The place's zone from `lookup(lat, lon)`, or `fallback` when there is no
 * lookup yet, the place is invalid, or the answer is a zone Intl does not know.
 */
export function zoneFrom(lookup, latDeg, lonDeg, fallback) {
  if (typeof lookup !== 'function') return fallback;
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return fallback;
  try {
    const tz = lookup(latDeg, lonDeg);
    return typeof tz === 'string' && tz && knownZone(tz) ? tz : fallback;
  } catch {
    return fallback;
  }
}

/** Minutes ahead of UTC in `tz` at `atMs`. */
function offsetMinutes(tz, atMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric',
  }).formatToParts(atMs);
  const n = (type) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'));
  return Math.round((asUtc - Math.floor(atMs / 60_000) * 60_000) / 60_000);
}

/** True when the two zones show the same clock time at `atMs`. */
export function sameClock(a, b, atMs) {
  if (a === b) return true;
  try {
    return offsetMinutes(a, atMs) === offsetMinutes(b, atMs);
  } catch {
    return false;
  }
}

/** "UTC+9", "UTC-3:30", "UTC". */
function offsetText(tz, atMs) {
  const m = offsetMinutes(tz, atMs);
  if (m === 0) return 'UTC';
  const a = Math.abs(m);
  return `UTC${m < 0 ? '-' : '+'}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}

/**
 * "Times are Tokyo time (UTC+9)." when the place's clock differs from the
 * viewer's at `atMs`; null when they agree or either zone is unknown.
 */
export function zoneNote(tz, viewerTz, atMs) {
  if (!tz || !viewerTz || !knownZone(tz) || !knownZone(viewerTz)) return null;
  if (sameClock(tz, viewerTz, atMs)) return null;
  const offset = offsetText(tz, atMs);
  const city = zoneCity(tz);
  return city ? `Times are ${city} time (${offset}).` : `Times are ${offset}.`;
}

/** The city in the zone's name ("Asia/Tokyo" is Tokyo); Etc/ zones have none. */
function zoneCity(tz) {
  return tz.startsWith('Etc/') || !tz.includes('/') ? null : tz.split('/').pop().replace(/_/g, ' ');
}

/**
 * "Times shown in Tokyo time" (or "in UTC+11" for a zone with no city) for a
 * place whose clock differs from the viewer's at `atMs`; null when they agree
 * or either zone is unknown.
 */
export function shownInNote(tz, viewerTz, atMs) {
  if (!tz || !viewerTz || !knownZone(tz) || !knownZone(viewerTz)) return null;
  if (sameClock(tz, viewerTz, atMs)) return null;
  const city = zoneCity(tz);
  return `Times shown in ${city ? `${city} time` : offsetText(tz, atMs)}`;
}
