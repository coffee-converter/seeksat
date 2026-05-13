// elevation.js -- auto-lookup observer elevation via Open-Elevation, with
// an in-memory cache keyed by rounded lat/lon. Returns 0 on any failure
// so callers can fall back to sea level.

const cache = new Map();

export function lookupElev(latDeg, lonDeg) {
  const key = `${latDeg.toFixed(5)},${lonDeg.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key);
  const url = `https://api.open-elevation.com/api/v1/lookup?locations=${latDeg},${lonDeg}`;
  const promise = fetch(url)
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(data => Number(data.results?.[0]?.elevation ?? 0))
    .catch(err => {
      console.warn(`elevation lookup failed for ${key}: ${err.message}`);
      return 0;
    });
  cache.set(key, promise);
  return promise;
}
