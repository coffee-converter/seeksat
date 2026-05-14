// pass-finder/geocode.js -- Nominatim wrapper with in-memory cache.
// Polite-use only: 1 req/sec max, browser fetch with a UA-like Accept-Language.

const cache = new Map();

export async function geocodeOne(query) {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const promise = fetch(url, { headers: { "Accept-Language": "en-US,en;q=0.9" } })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(arr => {
      if (!arr || !arr.length) return null;
      const r = arr[0];
      return {
        latDeg: Number(r.lat),
        lonDeg: Number(r.lon),
        displayName: r.display_name,
      };
    })
    .catch(err => {
      console.warn(`geocode failed for "${query}": ${err.message}`);
      return null;
    });
  cache.set(key, promise);
  return promise;
}
