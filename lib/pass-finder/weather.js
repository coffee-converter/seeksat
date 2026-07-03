// pass-finder/weather.js -- hourly cloud-cover forecast.
//
// Two independent sources averaged for robustness:
//   - Open-Meteo (api.open-meteo.com) - free, no key, 16-day horizon,
//     hourly throughout. Aggregates ECMWF + ICON + GFS etc.
//   - MET Norway locationforecast 2.0 (api.met.no) - free, no key,
//     ~9-day horizon (hourly for first 2 days, then 6-hourly).
//     Different model lineage; agreement between the two is a
//     confidence signal.
//
// Both sources return cloud cover split into low / medium / high
// atmospheric layers, which we combine via a transmittance stack
// (multiplicative transmittance through each layer) so stacked layers
// don't over-count against the 100 ceiling. Per-layer extinction
// weights reflect what each cloud type does to ISS visibility: low
// cumulus/stratus = full blocker, mid altocumulus = roughly half
// opacity, high cirrus = barely affects. Per-source occlusion is
// averaged into one final hourly number; downstream callers (cloudAt
// + the panel/scoring code) see the same { startMs, hours } shape as
// before.
//
// CORS: Open-Meteo allows browser requests. MET Norway requires a
// User-Agent header per their TOS - browsers won't let JS override
// their default UA, so we send what the browser provides. In practice
// this works for most browser-based apps but met.no may block; if
// they 403, we fall back transparently to Open-Meteo only.

const LAYER_WEIGHTS = { low: 1.0, mid: 0.55, high: 0.20 };

function combineCloudLayers(low, mid, high) {
  const l = Math.max(0, Math.min(100, low ?? 0)) / 100;
  const m = Math.max(0, Math.min(100, mid ?? 0)) / 100;
  const h = Math.max(0, Math.min(100, high ?? 0)) / 100;
  const transmittance = (1 - l * LAYER_WEIGHTS.low)
                      * (1 - m * LAYER_WEIGHTS.mid)
                      * (1 - h * LAYER_WEIGHTS.high);
  return (1 - transmittance) * 100;
}

// In-page cache for combined cloud forecasts. Cached entries expire
// after CACHE_TTL_MS so a long-open page picks up fresh data on the
// next call. Set just below the periodic-refresh interval in
// pass-finder.js so the refresh tick reliably crosses the TTL and
// triggers a real network fetch each time.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // rounded "lat,lon" -> { promise, fetchedAt }

// ---- Source: Open-Meteo ---------------------------------------------------

function fetchOpenMeteoCloud(latDeg, lonDeg) {
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${latDeg}&longitude=${lonDeg}`
    + "&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high"
    + "&timezone=UTC&forecast_days=16";
  return fetch(url)
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(data => {
      const times = data?.hourly?.time;
      const low  = data?.hourly?.cloud_cover_low;
      const mid  = data?.hourly?.cloud_cover_mid;
      const high = data?.hourly?.cloud_cover_high;
      if (!Array.isArray(times) || !Array.isArray(low)
          || !Array.isArray(mid) || !Array.isArray(high)
          || !times.length) {
        throw new Error("malformed forecast");
      }
      // Times come back as plain UTC strings (no "Z") when we ask
      // timezone=UTC - append "Z" so JS Date parses as UTC.
      const startMs = new Date(times[0] + "Z").getTime();
      const hours = times.map((_, i) => combineCloudLayers(low[i], mid[i], high[i]));
      return { startMs, hours };
    })
    .catch(err => {
      console.warn(`Open-Meteo cloud failed: ${err.message}`);
      return null;
    });
}

// ---- Source: MET Norway ---------------------------------------------------

function fetchMetNoCloud(latDeg, lonDeg) {
  // Round to 4 decimals - met.no's TOS asks API consumers not to
  // request more precision than they need (their cache key is
  // location-based).
  const url = "https://api.met.no/weatherapi/locationforecast/2.0/complete"
    + `?lat=${latDeg.toFixed(4)}&lon=${lonDeg.toFixed(4)}`;
  return fetch(url)
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(data => {
      const ts = data?.properties?.timeseries;
      if (!Array.isArray(ts) || !ts.length) throw new Error("malformed forecast");
      const samples = [];
      for (const entry of ts) {
        const d = entry?.data?.instant?.details;
        if (!d) continue;
        const low  = d.cloud_area_fraction_low;
        const mid  = d.cloud_area_fraction_medium;
        const high = d.cloud_area_fraction_high;
        if (low == null || mid == null || high == null) continue;
        samples.push({
          tMs: new Date(entry.time).getTime(),
          occlusion: combineCloudLayers(low, mid, high),
        });
      }
      if (!samples.length) throw new Error("no usable samples");
      // Samples already in chronological order from the API.
      return samples;
    })
    .catch(err => {
      console.warn(`MET Norway cloud failed: ${err.message}`);
      return null;
    });
}

// Linear-interp lookup of a MET Norway sample at the given ms. Returns
// null when ms is more than 90 min from any sample (met.no goes to
// 6-hourly after ~48h, so a strict "within 1 hour" rule would lose
// most of the second-week coverage; 90 min is a fair compromise
// between coverage and "this is really stale" filtering).
function metnoOcclusionAtMs(samples, ms) {
  if (!samples || !samples.length) return null;
  // Binary search for the bracketing pair would be faster but the
  // forecast is short (~50 entries); linear is plenty.
  let prev = null, next = null;
  for (const s of samples) {
    if (s.tMs <= ms) prev = s;
    if (s.tMs >= ms) { next = s; break; }
  }
  if (!prev && !next) return null;
  if (!prev) return Math.abs(next.tMs - ms) > 90 * 60_000 ? null : next.occlusion;
  if (!next) return Math.abs(prev.tMs - ms) > 90 * 60_000 ? null : prev.occlusion;
  if (prev === next) return prev.occlusion;
  const span = next.tMs - prev.tMs;
  if (span > 7 * 3600_000) return null; // gap too big to interp through
  const frac = (ms - prev.tMs) / span;
  return prev.occlusion * (1 - frac) + next.occlusion * frac;
}

// ---- Merge & public API ---------------------------------------------------

function mergeForecasts(om, mn) {
  if (!om && !mn) return null;
  // Open-Meteo gives the broader and denser grid; use it as the
  // primary time axis. If only met.no came back, fall back to a
  // synthesized hourly grid from its samples.
  if (!om) {
    if (!mn || !mn.length) return null;
    const startMs = mn[0].tMs;
    const endMs   = mn[mn.length - 1].tMs;
    const n = Math.floor((endMs - startMs) / 3600_000) + 1;
    const hours = [];
    for (let i = 0; i < n; i++) {
      const v = metnoOcclusionAtMs(mn, startMs + i * 3600_000);
      hours.push(v ?? 0);
    }
    return { startMs, hours };
  }
  if (!mn) return om;
  // Both available - average per-hour where met.no covers, fall
  // through to Open-Meteo alone for hours met.no doesn't reach.
  const hours = om.hours.map((omVal, i) => {
    const ms = om.startMs + i * 3600_000;
    const mnVal = metnoOcclusionAtMs(mn, ms);
    return mnVal == null ? omVal : (omVal + mnVal) / 2;
  });
  return { startMs: om.startMs, hours };
}

export function fetchCloudForecast(latDeg, lonDeg) {
  const key = `${latDeg.toFixed(2)},${lonDeg.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.promise;
  const promise = Promise.all([
    fetchOpenMeteoCloud(latDeg, lonDeg),
    fetchMetNoCloud(latDeg, lonDeg),
  ]).then(([om, mn]) => {
    const merged = mergeForecasts(om, mn);
    if (!merged) cache.delete(key); // allow retry on full-failure
    return merged;
  });
  cache.set(key, { promise, fetchedAt: Date.now() });
  return promise;
}

// Sample cloud occlusion (0-100) at a given ms. Returns null if the
// forecast is unavailable, still loading, or the requested time is
// outside the horizon. Linearly interpolates between hourly samples
// (both upstream sources report at hour timestamps, not bucket
// averages, so interp is the right call).
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
