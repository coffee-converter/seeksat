// pass-finder/geocode.js -- Nominatim wrapper with in-memory cache.
// Polite use: one request a second at most, cached, and a refusal said as busy.

// Answers by query, newest last; the oldest go past CACHE_MAX.
const cache = new Map();
const CACHE_MAX = 500;
// Nominatim asks for at most one request a second: lookups queue behind each
// other, and a refusal (429, 403 or 503) is said as "busy" rather than "no
// such place", so a caller can tell the two apart.
const GAP_MS = 1100;
const MAX_WAIT_MS = 4000;
let nextAt = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function geocodeOne(query, { fetchImpl = fetch, headers, gapMs = GAP_MS } = {}) {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
  const mergedHeaders = { "Accept-Language": "en-US,en;q=0.9", ...headers };
  const now = Date.now();
  const startAt = Math.max(now, nextAt);
  // A queue longer than a few seconds is a flood: say busy at once rather
  // than hold every caller behind it.
  if (startAt - now > MAX_WAIT_MS) return { busy: true };
  nextAt = startAt + gapMs;
  const promise = wait(startAt - now)
    .then(() => fetchImpl(url, { headers: mergedHeaders, signal: AbortSignal.timeout(8000) }))
    .then(r => {
      if (r.status === 429 || r.status === 403 || r.status === 503) return { busy: true };
      return r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`));
    })
    .then(arr => {
      if (arr && arr.busy) {
        cache.delete(key);
        return { busy: true };
      }
      if (!arr || !arr.length) return null;
      const r = arr[0];
      return { latDeg: Number(r.lat), lonDeg: Number(r.lon), displayName: r.display_name, placeName: placeNameOf(r.address) };
    })
    .catch(err => {
      cache.delete(key);
      console.warn(`geocode failed for "${query}": ${err.message}`);
      return null;
    });
  cache.set(key, promise);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return promise;
}

/**
 * A short place name for a point, "Mendoza, Mendoza Province" or
 * "Chicago, Illinois", from OpenStreetMap's reverse geocoder (the same
 * service as geocodeOne), or null when there is none (open ocean, offline).
 */
export async function reverseGeocodeName(latDeg, lonDeg, { fetchImpl = fetch } = {}) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${latDeg}&lon=${lonDeg}&format=json&zoom=10&addressdetails=1`;
  try {
    const r = await fetchImpl(url, { headers: { "Accept-Language": "en-US,en;q=0.9" } });
    if (!r.ok) return null;
    const j = await r.json();
    return placeNameOf(j?.address);
  } catch {
    return null;
  }
}

/** "Town, Region" from a Nominatim address, or null. */
export function placeNameOf(a) {
  if (!a) return null;
  const town = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.county ?? null;
  const region = a.state ?? a.region ?? a.province ?? a.country ?? null;
  if (!town && !region) return null;
  if (town && region && town !== region) return `${town}, ${region}`;
  return town ?? region;
}
