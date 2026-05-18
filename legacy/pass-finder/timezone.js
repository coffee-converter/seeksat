// pass-finder/timezone.js -- IANA timezone lookup by lat/lon.
//
// Uses timeapi.io (free, CORS-enabled, no key) to resolve a lat/lon to
// an IANA zone like "America/Chicago". The whole point is to make the
// polar plot show times in the OBSERVER's local clock rather than the
// browser's — what someone standing under that sky would actually see.
//
// Cached aggressively (rounded to ~0.1°, ~11 km) because timezones
// don't shift at that resolution and we'd rather not hammer the API
// when the user nudges an observer or reloads the page.

const cache = new Map(); // rounded "lat,lon" -> Promise<string|null>

export function fetchTimezone(latDeg, lonDeg) {
  const key = `${latDeg.toFixed(1)},${lonDeg.toFixed(1)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = "https://timeapi.io/api/TimeZone/coordinate"
    + `?latitude=${latDeg}&longitude=${lonDeg}`;
  const promise = fetch(url)
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(data => {
      const tz = data?.timeZone;
      if (typeof tz === "string" && tz.length > 0) return tz;
      throw new Error("malformed tz response");
    })
    .catch(err => {
      cache.delete(key); // allow retry next time
      console.warn(`tz lookup failed for ${key}: ${err.message}`);
      return null;
    });
  cache.set(key, promise);
  return promise;
}
