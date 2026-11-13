// pass-finder/geocode.js -- Nominatim wrapper with in-memory cache.
// Polite-use only: 1 req/sec max, browser fetch with a UA-like Accept-Language.

const cache = new Map();

export async function geocodeOne(query, { fetchImpl = fetch, headers } = {}) {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
  const mergedHeaders = { "Accept-Language": "en-US,en;q=0.9", ...headers };
  const promise = fetchImpl(url, { headers: mergedHeaders })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(arr => {
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
