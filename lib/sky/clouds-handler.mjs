import { fetchCloudForecast } from '../pass-finder/weather.js';
import { roundCoord } from './round-coords.mjs';

const CACHE_CONTROL = 'public, s-maxage=1800, stale-while-revalidate=3600';

// Handles GET /api/clouds?lat&lon.
/** @returns {Promise<{ status: number, body: object, headers: Record<string, string> }>} */
export async function cloudsHandler(searchParams) {
  const rawLat = searchParams.get('lat');
  const rawLon = searchParams.get('lon');
  const lat = rawLat == null || rawLat.trim() === '' ? NaN : Number(rawLat);
  const lon = rawLon == null || rawLon.trim() === '' ? NaN : Number(rawLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { status: 400, body: { error: 'lat and lon must be numbers within range' }, headers: /** @type {Record<string, string>} */ ({}) };
  }
  const forecast = await fetchCloudForecast(roundCoord(lat), roundCoord(lon));
  if (!forecast) {
    // Never let the CDN hold a failed lookup; the next request should retry upstream.
    return { status: 200, body: { startMs: null, hours: null }, headers: { 'Cache-Control': 'no-store' } };
  }
  const body = { startMs: forecast.startMs, hours: forecast.hours };
  return { status: 200, body, headers: { 'Cache-Control': CACHE_CONTROL } };
}
