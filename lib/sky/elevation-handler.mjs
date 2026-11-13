// lib/sky/elevation-handler.mjs - GET /api/elevation?lat&lon: the ground's
// height there (Open-Meteo's elevation service, from Copernicus 90 m data),
// for the observer's height in the pass math. Proxied, as the cloud forecast
// is, so the browser talks only to this site.

const CACHE_CONTROL = 'public, s-maxage=2592000, stale-while-revalidate=2592000';
const ROUND = 1e3; // 3 decimals, about 100 m: the data's own spacing

/** @returns {Promise<{ status: number, body: object, headers: Record<string, string> }>} */
export async function elevationHandler(searchParams, { fetchImpl = fetch } = {}) {
  const rawLat = searchParams.get('lat');
  const rawLon = searchParams.get('lon');
  const lat = rawLat == null || rawLat.trim() === '' ? NaN : Number(rawLat);
  const lon = rawLon == null || rawLon.trim() === '' ? NaN : Number(rawLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { status: 400, body: { error: 'lat and lon must be numbers within range' }, headers: /** @type {Record<string, string>} */ ({}) };
  }
  const la = Math.round(lat * ROUND) / ROUND;
  const lo = Math.round(lon * ROUND) / ROUND;
  try {
    const r = await fetchImpl(`https://api.open-meteo.com/v1/elevation?latitude=${la}&longitude=${lo}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const elevM = Number(j?.elevation?.[0]);
    if (!Number.isFinite(elevM)) throw new Error('no elevation');
    // The sea reads as a missing value or below it; a site never sits below -430 m.
    return { status: 200, body: { elevM: Math.max(0, Math.round(elevM)) }, headers: { 'Cache-Control': CACHE_CONTROL } };
  } catch {
    // Never let the CDN hold a failed lookup.
    return { status: 200, body: { elevM: null }, headers: { 'Cache-Control': 'no-store' } };
  }
}
