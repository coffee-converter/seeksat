// pass-finder/weather.js -- Open-Meteo hourly cloud-cover forecast.
//
// Free, no API key, CORS-enabled, up to 16-day forecast horizon.
// Times come back as plain UTC strings (no offset suffix) when we request
// timezone=UTC — we append "Z" to force JS Date to parse as UTC instead of
// local time.

// In-page cache for Open-Meteo cloud forecasts. Cached entries expire
// after CACHE_TTL_MS so a long-open page picks up fresh data on the
// next call. Set just below the periodic-refresh interval in
// pass-finder.js so the refresh tick reliably crosses the TTL and
// triggers a real network fetch each time.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // rounded "lat,lon" -> { promise, fetchedAt }

export function fetchCloudForecast(latDeg, lonDeg) {
  const key = `${latDeg.toFixed(2)},${lonDeg.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.promise;
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${latDeg}&longitude=${lonDeg}`
    + "&hourly=cloud_cover&timezone=UTC&forecast_days=16";
  const promise = fetch(url)
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(data => {
      const times = data?.hourly?.time;
      const cover = data?.hourly?.cloud_cover;
      if (!Array.isArray(times) || !Array.isArray(cover) || !times.length) {
        throw new Error("malformed forecast");
      }
      const startMs = new Date(times[0] + "Z").getTime();
      return { startMs, hours: cover };
    })
    .catch(err => {
      cache.delete(key); // allow retry on transient failure
      console.warn(`cloud forecast failed for ${key}: ${err.message}`);
      return null;
    });
  cache.set(key, { promise, fetchedAt: Date.now() });
  return promise;
}

// Sample cloud cover (0-100) at a given ms. Returns null if the forecast is
// unavailable, still loading, or the requested time is outside the horizon.
// Linearly interpolates between hourly samples (Open-Meteo reports values at
// the hour timestamp, not bucket averages, so interp is the right call).
export function cloudAt(forecast, ms) {
  if (!forecast) return null;
  const offset = (ms - forecast.startMs) / 3_600_000;
  const hourIdx = Math.floor(offset);
  if (hourIdx < 0 || hourIdx >= forecast.hours.length) return null;
  const next = forecast.hours[hourIdx + 1];
  if (next == null) return forecast.hours[hourIdx]; // last hour: no next sample
  const frac = offset - hourIdx;
  return forecast.hours[hourIdx] * (1 - frac) + next * frac;
}
