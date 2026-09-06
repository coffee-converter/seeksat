// elevation.js -- auto-lookup observer elevation via Open-Elevation, with
// an in-memory cache keyed by rounded lat/lon.

const cache = new Map();

/** Look up ground elevation, reporting whether the lookup actually
 *  succeeded. `lookupElev` (below) can't distinguish a failed lookup from
 *  a genuine sea-level (0 m) site - both collapse to 0 - so callers that
 *  need real provenance (e.g. showing "measured" vs "defaulted" on a
 *  chart) use this instead. The (elevM, ok) pair is cached together so a
 *  cache hit still reports the correct provenance.
 *  @returns {Promise<{ elevM: number, ok: boolean }>}
 */
export function lookupElevResult(latDeg, lonDeg) {
  const key = `${latDeg.toFixed(5)},${lonDeg.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key);
  const url = `https://api.open-elevation.com/api/v1/lookup?locations=${latDeg},${lonDeg}`;
  const promise = fetch(url)
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(data => ({ elevM: Number(data.results?.[0]?.elevation ?? 0), ok: true }))
    .catch(err => {
      console.warn(`elevation lookup failed for ${key}: ${err.message}`);
      return { elevM: 0, ok: false };
    });
  cache.set(key, promise);
  return promise;
}

/** Elevation only, falling back to 0 on any failure - for callers that
 *  don't need to distinguish a failed lookup from a genuine sea-level
 *  site. See `lookupElevResult` for the version that does. */
export function lookupElev(latDeg, lonDeg) {
  return lookupElevResult(latDeg, lonDeg).then(r => r.elevM);
}
