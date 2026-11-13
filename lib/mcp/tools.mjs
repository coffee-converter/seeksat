// lib/mcp/tools.mjs - pure MCP tool handlers. All I/O is injected via
// deps: { getRecord(noradId), geocode(query, opts?), fetchWeather(lat,lon), now(),
// search?(query, limit, { radio }), radioIds?() (satellites with known
// downlinks), radioScanCache? (an LRU from radio-scan.mjs createLru),
// skyCatalog?() (every satellite, for whole-sky tools) }.
// Handlers throw Error on bad input; the route layer maps that to an
// MCP error response.

import { CATALOG, resolveSatellite, displayName, isCurated, downlinksFor } from '../catalog.mjs';
import { tleAgeHours } from './tle-record.mjs';
import { findPasses, getPosition, radioEnginePasses, radioPassQuality, passRow } from './passes.mjs';
import { radioPass, downlinkList } from './radio.mjs';
import { coarseScan, refineWindows, scanKey, cellOf, hourOf, COARSE_MARGIN_DEG } from './radio-scan.mjs';
import { makeTrack } from '../sat/track.mjs';
import { BAND_IDS, inBands } from '../radio/bands.mjs';
import { RADIO_WORDS, downlinkHasWord } from '../radio/modes.mjs';
import { prepareSky, skyAt, skyDarkness, brightnessAt, DARK_SUN_ALT_DEG } from './sky.mjs';
import { compass } from '../sat/pass-rows.mjs';
import { cloudAt } from '../pass-finder/weather.js';
import { effectivePClear } from '../pass-finder/ratings.js';
import { fetchTimezone } from '../pass-finder/timezone.js';
import { SITE_URL } from '../site.mjs';

const iso = (ms) => new Date(ms).toISOString();

/** The satellite's page on the site, for an agent to link to. */
export function satUrl(noradId) {
  return `${SITE_URL}/sat/${noradId}`;
}

const GEOCODE_HEADERS = { 'User-Agent': 'seeksat-mcp/1.0 (https://seeksat.com)' };

function freshness(record, nowMs) {
  if (!record) return { tleEpoch: null, tleAgeHours: null, source: null };
  const age = tleAgeHours(record, nowMs);
  return {
    tleEpoch: new Date(record.epochMs).toISOString(),
    tleAgeHours: age == null ? null : Number(age.toFixed(2)),
    source: record.source,
  };
}

// Throw if `tier` may not access `entry`. Premium satellites require the
// 'pro' tier; free satellites are always allowed. Pure + exported so the
// gate is testable without a premium entry in the real (all-free) catalog.
export function assertTierAllows(entry, tier) {
  if (entry.tier === 'premium' && tier !== 'pro') {
    throw new Error(`${entry.name} is a premium satellite - set an API key to access it`);
  }
}

// A name outside the curated list resolves through the catalog search, on a
// whole-name match only (tier 0 or 1), so "sdo" finds SDO but "noaa" does
// not quietly pick one of several.
async function resolveAny(satellite, deps) {
  const entry = resolveSatellite(satellite);
  if (entry || typeof deps.search !== 'function' || /^\d+$/.test(String(satellite).trim())) return entry;
  const [hit] = await deps.search(String(satellite), 1);
  return hit && hit.tier <= 1 ? resolveSatellite(hit.noradId) : null;
}

async function requireRecord(satellite, deps, tier = 'free') {
  const entry = await resolveAny(satellite, deps);
  if (!entry) throw new Error(`unknown satellite: ${satellite} (try search_satellites, or pass its NORAD number)`);
  assertTierAllows(entry, tier);
  const record = await deps.getRecord(entry.noradId);
  if (!record) {
    const label = isCurated(entry) ? `${entry.name} (${entry.noradId})` : displayName(entry, null);
    throw new Error(`no orbit data for ${label} yet`);
  }
  return { entry, record };
}

async function resolveLocation(input, deps) {
  if (input.lat != null && input.lon != null) {
    return { latDeg: input.lat, lonDeg: input.lon, displayName: null };
  }
  if (input.location) {
    const g = await deps.geocode(input.location, { headers: GEOCODE_HEADERS });
    if (!g) throw new Error(`could not geocode location: ${input.location}`);
    return g;
  }
  throw new Error('a location is required: pass lat+lon or a location string');
}

export async function listSatellites(deps) {
  const records = await Promise.all(CATALOG.map(s => deps.getRecord(s.noradId)));
  const nowMs = deps.now();
  return {
    satellites: CATALOG.map((s, i) => ({
      noradId: s.noradId,
      name: s.name,
      url: satUrl(s.noradId),
      aliases: s.aliases,
      tier: s.tier,
      ...freshness(records[i] ?? null, nowMs),
    })),
  };
}

export async function getPositionTool(input, deps, tier = 'free') {
  const { entry, record } = await requireRecord(input.satellite, deps, tier);
  const nowMs = deps.now();
  const when = input.time ? new Date(input.time) : new Date(nowMs);
  const pos = getPosition(record, when);
  return { ...pos, name: displayName(entry, record), noradId: entry.noradId, url: satUrl(entry.noradId), ...freshness(record, nowMs) };
}

export async function findPassesTool(input, deps, tier = 'free') {
  const { entry, record } = await requireRecord(input.satellite, deps, tier);
  const loc = await resolveLocation(input, deps);
  const { passes, stationary, unavailable } = findPasses({
    record, entry,
    standardMag: entry.standardMag,
    observer: { latDeg: loc.latDeg, lonDeg: loc.lonDeg },
    startMs: deps.now(),
    windowHours: input.windowHours ?? 48,
    minElevationDeg: input.minElevation ?? 10,
    mode: input.mode ?? 'visual',
  });
  if (unavailable) throw new Error(`elements for ${displayName(entry, record)} can't be propagated`);
  return {
    satellite: displayName(entry, record),
    noradId: entry.noradId,
    url: satUrl(entry.noradId),
    resolvedLocation: loc,
    passes,
    stationary,
    ...freshness(record, deps.now()),
  };
}

export async function nextVisiblePassTool(input, deps, tier = 'free') {
  const { entry, record } = await requireRecord(input.satellite, deps, tier);
  const loc = await resolveLocation(input, deps);
  const mode = input.mode ?? 'visual';
  const { passes, stationary, unavailable } = findPasses({
    record, entry,
    standardMag: entry.standardMag,
    observer: { latDeg: loc.latDeg, lonDeg: loc.lonDeg },
    startMs: deps.now(), windowHours: 72, minElevationDeg: 10, mode,
  });
  if (unavailable) throw new Error(`elements for ${displayName(entry, record)} can't be propagated`);
  const pass = passes[0] ?? null;
  const out = {
    satellite: displayName(entry, record), noradId: entry.noradId, url: satUrl(entry.noradId),
    resolvedLocation: loc, pass, stationary, ...freshness(record, deps.now()),
  };
  // With chart:true, fold the sky chart for that pass into this same result so
  // the caller gets data + image in one tool call (no separate get_pass_chart).
  if (input.chart && pass) {
    const { pngBase64, summary } = await renderChart({ entry, record, loc, mode, nowMs: scanStartForPass(pass.peak) });
    return { ...out, summary, pngBase64 };
  }
  return out;
}

export async function getPassWeatherTool(input, deps) {
  const loc = await resolveLocation(input, deps);
  const forecast = await deps.fetchWeather(loc.latDeg, loc.lonDeg);
  const atMs = Date.parse(input.time);
  const cloudPct = cloudAt(forecast, atMs);
  const ageDays = (atMs - deps.now()) / 86_400_000;
  return {
    resolvedLocation: loc,
    cloudCoverPct: cloudPct == null ? null : Number(cloudPct.toFixed(0)),
    viewingProbability: Number(effectivePClear(cloudPct, ageDays).toFixed(2)),
    forecastSource: forecast ? 'open-meteo+met.no' : null,
  };
}

// Render the polar sky chart for the pass at/after `nowMs`. Shared by
// get_pass_chart and the optional `chart` flag on next_visible_pass /
// best_pass. Returns { pngBase64, summary }.
async function renderChart({ entry, record, loc, mode = 'visual', nowMs }) {
  // Short label for the chart title/summary: the first component of the
  // geocoded name ("Chicago, …, United States" → "Chicago"), or the
  // coordinates when the agent passed raw lat/lon. Keeps long place names
  // from overflowing the chart title.
  const name = loc.displayName
    ? loc.displayName.split(',')[0].trim()
    : `${loc.latDeg.toFixed(2)}, ${loc.lonDeg.toFixed(2)}`;
  // Resolve the observer's IANA timezone so the chart's times read in the
  // location's local clock. Best-effort: null on lookup failure, which the
  // chart renders as a UTC fallback label.
  const tz = await fetchTimezone(loc.latDeg, loc.lonDeg);
  const observer = { name, latDeg: loc.latDeg, lonDeg: loc.lonDeg, tz: tz ?? undefined };
  const { renderPassChartPng } = await import('./pass-chart.mjs');
  return renderPassChartPng({ entry, record, observer, mode, nowMs });
}

// Back the chart's scan start up from a specific pass's time so that exact
// pass - not a later one - is the one rendered. The 20-min back-off is far
// smaller than the ~90-min inter-pass gap, so it can't select an earlier pass.
function scanStartForPass(passIso) {
  return Date.parse(passIso) - 20 * 60_000;
}

export async function getPassChartTool(input, deps, tier = 'free') {
  const { entry, record } = await requireRecord(input.satellite, deps, tier);
  const loc = await resolveLocation(input, deps);
  // No `time` → chart the next pass from now. With a `time` (the rise or peak
  // of a specific pass from find_passes / best_pass), chart that exact pass.
  let nowMs = deps.now();
  if (input.time != null) {
    if (Number.isNaN(Date.parse(input.time))) throw new Error(`invalid time (expected ISO 8601): ${input.time}`);
    nowMs = scanStartForPass(input.time);
  }
  return renderChart({ entry, record, loc, mode: input.mode ?? 'visual', nowMs });
}

// Best quality first. A visual pass with a guessed magnitude already has its
// quality capped (passes.mjs); on a tie a known brightness wins, then the
// brighter pass, so a guess never edges out a satellite we know is bright.
export function byQuality(a, b) {
  return (b.quality - a.quality)
    || (Number(a.peakMagnitudeEstimated === true) - Number(b.peakMagnitudeEstimated === true))
    || ((a.peakMagnitude ?? Infinity) - (b.peakMagnitude ?? Infinity))
    || 0;
}

// Radio passes: best quality first, then (as many good passes reach 1) the
// higher, then the longer, then the sooner. Brightness means nothing here.
export function byRadioQuality(a, b) {
  return (b.quality - a.quality)
    || (b.peakElevationDeg - a.peakElevationDeg)
    || (b.durationSec - a.durationSec)
    || (Date.parse(a.rise) - Date.parse(b.rise));
}

// Rank upcoming passes by quality across the whole catalog (or a single
// satellite when `satellite` is given) and return the best ones. A thin
// fan-out over findPasses: resolve the location once, scan each accessible
// satellite, merge, and sort by the pre-computed quality score (0-1, which
// already folds in peak elevation, brightness, darkness, and weather odds).
export async function bestPassTool(input, deps, tier = 'free') {
  const loc = await resolveLocation(input, deps);
  const mode = input.mode ?? 'visual';
  // With no satellite named, a radio ask scans everything with a known
  // downlink, not just the popular list.
  if (mode === 'radio' && input.satellite == null && typeof deps.radioIds === 'function') {
    return radioScanTool(input, deps, tier, loc);
  }
  const windowHours = input.windowHours ?? 72;
  const minElevationDeg = input.minElevation ?? 10;
  const limit = input.limit ?? 3;

  // One satellite if named, else the full catalog.
  let entries;
  if (input.satellite != null) {
    const entry = await resolveAny(input.satellite, deps);
    if (!entry) throw new Error(`unknown satellite: ${input.satellite} (try search_satellites, or pass its NORAD number)`);
    entries = [entry];
  } else {
    entries = CATALOG;
  }

  const startMs = deps.now();
  const observer = { latDeg: loc.latDeg, lonDeg: loc.lonDeg };
  const all = [];
  const skipped = [];
  const sources = new Map();
  for (const entry of entries) {
    // Skip (don't fail) satellites the caller can't access or that have no
    // orbit record yet - a cross-catalog scan should degrade gracefully.
    if (entry.tier === 'premium' && tier !== 'pro') { skipped.push({ satellite: displayName(entry, null), reason: 'premium - set an API key' }); continue; }
    const record = await deps.getRecord(entry.noradId);
    if (!record) { skipped.push({ satellite: displayName(entry, null), reason: 'no orbit data yet' }); continue; }
    const { passes, stationary, unavailable } = findPasses({
      record, entry,
      standardMag: entry.standardMag,
      observer,
      startMs, windowHours, minElevationDeg, mode,
    });
    if (unavailable) { skipped.push({ satellite: displayName(entry, record), reason: "elements can't be propagated" }); continue; }
    if (stationary) {
      const reason = stationary.motion === 'moving'
        ? 'geosynchronous: always up here and moving, no passes'
        : 'geostationary: fixed in the sky, no passes';
      skipped.push({ satellite: displayName(entry, record), reason });
      continue;
    }
    const downlinks = mode === 'radio' ? downlinkList({ downlinks: downlinksFor(entry, record) }) : undefined;
    for (const p of passes) {
      const row = {
        satellite: displayName(entry, record), shortName: entry.shortName, noradId: entry.noradId, url: satUrl(entry.noradId),
        ...p, ...(downlinks && { downlinks }),
      };
      sources.set(row, { entry, record });
      all.push(row);
    }
  }
  all.sort(mode === 'radio' ? byRadioQuality : byQuality);
  const best = all[0] ?? null;
  const out = {
    resolvedLocation: loc,
    mode,
    windowHours,
    scannedSatellites: entries.length - skipped.length,
    skipped: skipped.length ? skipped : undefined,
    best,
    passes: all.slice(0, limit),
  };
  // With chart:true, render the winning pass's sky chart into this same result
  // so "best pass with a chart" is a single tool call carrying data + image.
  if (input.chart && best) {
    const { entry: bestEntry, record: bestRecord } = sources.get(best) ?? {};
    if (bestEntry && bestRecord) {
      const { pngBase64, summary } = await renderChart({ entry: bestEntry, record: bestRecord, loc, mode, nowMs: scanStartForPass(best.peak) });
      return { ...out, summary, pngBase64 };
    }
  }
  return out;
}

/** Default and longest look-ahead for a radio scan across every satellite. */
export const RADIO_SCAN_HOURS = 24;
export const RADIO_SCAN_MAX_HOURS = 72;
/** Bands and modes from the input as lists of known values (null for any),
 *  or an error naming the unknown one. */
function scanFilters(input) {
  const pick = (values, known, what) => {
    if (values == null || (Array.isArray(values) && values.length === 0)) return null;
    const list = (Array.isArray(values) ? values : [values]).map((v) => String(v).toLowerCase());
    const bad = list.find((v) => !known.includes(v));
    if (bad) throw new Error(`unknown ${what}: ${bad} (one of ${known.join(', ')})`);
    return [...new Set(list)].sort();
  };
  return { bands: pick(input.bands, BAND_IDS, 'band'), modes: pick(input.modes, RADIO_WORDS, 'mode') };
}

/** Stage 1 of the radio scan (radio-scan.mjs) for one cell and hour: every
 *  satellite with a known downlink in the asked bands and modes, swept for
 *  rough passes. Satellites that cannot have passes are counted by reason. */
async function coarseRadioStage(deps, { cell, hourMs, windowHours, minElevationDeg, bands, modes, tier }) {
  const ids = await deps.radioIds();
  const sats = [];
  const skipped = {};
  const skip = (reason) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  let matched = 0;
  for (const id of ids) {
    const entry = resolveSatellite(id);
    if (!entry) continue;
    const record = await deps.getRecord(id);
    if (!record) { skip('no orbit data yet'); continue; }
    const downlinks = inBands(downlinksFor(entry, record), bands);
    if (!downlinks.length) continue;
    if (modes && !downlinks.some((d) => modes.some((w) => downlinkHasWord(d, w)))) continue;
    matched++;
    if (entry.tier === 'premium' && tier !== 'pro') { skip('premium - set an API key'); continue; }
    let track;
    try { track = makeTrack(record, entry); } catch { skip("elements can't be propagated"); continue; }
    // Fixed or slowly drifting in the sky: no passes to rank (get_radio_pass
    // gives where to point).
    if (track.orbitClass === 'geo') { skip('geosynchronous: no passes'); continue; }
    sats.push({ noradId: id, satrec: track.satrec });
  }
  // From the top of the hour to an hour past the window, so every ask in
  // this hour finds its whole window inside.
  const endMs = hourMs + (windowHours + 1) * 3_600_000;
  const r = coarseScan(sats, cell, hourMs, endMs, minElevationDeg - COARSE_MARGIN_DEG);
  if (r.unavailable.length) skipped["elements can't be propagated"] = (skipped["elements can't be propagated"] ?? 0) + r.unavailable.length;
  return { passes: r.passes, matched, swept: sats.length - r.unavailable.length, skipped };
}

/** best_pass in radio mode with no satellite named: the best passes of any
 *  satellite with a known downlink, optionally only in some bands or modes.
 *  A coarse sweep of all of them (cached per 0.25 degree cell and hour) picks
 *  the candidates; the full engine scores those at the exact place and time. */
async function radioScanTool(input, deps, tier, loc) {
  const asked = input.windowHours ?? RADIO_SCAN_HOURS;
  const windowHours = Math.min(asked, RADIO_SCAN_MAX_HOURS);
  const minElevationDeg = input.minElevation ?? 10;
  const limit = input.limit ?? 3;
  const { bands, modes } = scanFilters(input);
  const startMs = deps.now();
  const endMs = startMs + windowHours * 3_600_000;
  const hourMs = hourOf(startMs);
  const cell = cellOf(loc.latDeg, loc.lonDeg);
  const stageArgs = { cell, hourMs, windowHours, minElevationDeg, bands, modes, tier };

  // Concurrent asks for the same key share one sweep (the cache holds the
  // promise); a failed sweep is not kept.
  const cache = deps.radioScanCache ?? null;
  const key = scanKey({ ...cell, hourMs, windowHours, minElevationDeg, bands, modes }) + `|${tier}`;
  let stage = cache?.get(key);
  if (!stage) {
    stage = coarseRadioStage(deps, stageArgs);
    cache?.set(key, stage);
    stage.catch(() => cache?.delete(key));
  }
  const coarse = await stage;

  const observer = { latDeg: loc.latDeg, lonDeg: loc.lonDeg };
  const windows = refineWindows(coarse.passes, startMs, endMs, limit);
  // Rank the candidates' exact passes on what the rows will say (quality,
  // then height, length, time), then build full rows for the winners only.
  const found = [];
  for (const [id, list] of windows) {
    const entry = resolveSatellite(id);
    const record = await deps.getRecord(id);
    if (!entry || !record) continue;
    for (const w of list) {
      const { track, obs, passes } = radioEnginePasses({
        record, entry, standardMag: entry.standardMag, observer, minElevationDeg,
        startMs: w.startMs, windowHours: (w.endMs - w.startMs) / 3_600_000,
      });
      for (const p of passes) {
        found.push({
          entry, record, track, obs, p,
          key: { quality: radioPassQuality(p, track, obs, minElevationDeg), peakElevationDeg: p.maxElevDeg,
            durationSec: Math.round((p.endMs - p.startMs) / 1000), rise: iso(p.startMs) },
        });
      }
    }
  }
  found.sort((a, b) => byRadioQuality(a.key, b.key));
  const sources = new Map();
  const rows = found.slice(0, Math.max(limit, 1)).map(({ entry, record, track, obs, p }) => {
    const downlinks = downlinkList({ downlinks: inBands(downlinksFor(entry, record), bands) });
    const row = {
      satellite: displayName(entry, record), shortName: entry.shortName, noradId: entry.noradId, url: satUrl(entry.noradId),
      ...passRow(p, track, obs, 'radio', minElevationDeg), downlinks,
    };
    sources.set(row, { entry, record });
    return row;
  });
  const best = rows[0] ?? null;
  const out = {
    resolvedLocation: loc,
    mode: 'radio',
    windowHours,
    ...(asked > windowHours && { windowNote: `A radio scan across every satellite looks at most ${RADIO_SCAN_MAX_HOURS} hours ahead.` }),
    ...((bands || modes) && { filters: { bands, modes } }),
    matchedSatellites: coarse.matched,
    scannedSatellites: coarse.swept,
    checkedInDetail: windows.size,
    skippedCounts: Object.keys(coarse.skipped).length ? coarse.skipped : undefined,
    best,
    passes: rows.slice(0, limit),
  };
  if (input.chart && best) {
    const { entry, record } = sources.get(best);
    const { pngBase64, summary } = await renderChart({ entry, record, loc, mode: 'radio', nowMs: scanStartForPass(best.peak) });
    return { ...out, summary, pngBase64 };
  }
  return out;
}

/** Catalog search by name, alias or NORAD number, best match first. In radio
 *  mode satellites with known downlinks come first among equal matches. */
export async function searchSatellitesTool(input, deps) {
  const q = String(input?.query ?? '').trim();
  if (!q) throw new Error('a query is required');
  if (typeof deps.search !== 'function') throw new Error('search is unavailable');
  const limit = Math.min(20, Math.max(1, input.limit ?? 10));
  const results = await deps.search(q, limit, { radio: input.mode === 'radio' });
  return {
    query: q,
    results: results.map((r) => ({
      noradId: r.noradId, name: r.name, url: satUrl(r.noradId), hasKnownDownlinks: Boolean(r.radio), bands: r.bands ?? [],
    })),
  };
}

/** Frequencies, Doppler, tuning and pointing for one pass (the next one, or
 *  the one peaking nearest passTime), or the next 24 hours for a satellite
 *  that never sets. */
export async function radioPassTool(input, deps, tier = 'free') {
  const { entry, record } = await requireRecord(input.satellite, deps, tier);
  const loc = await resolveLocation(input, deps);
  const nowMs = deps.now();
  const passPeakMs = input.passTime ? Date.parse(input.passTime) : null;
  if (input.passTime && !Number.isFinite(passPeakMs)) throw new Error(`passTime is not a time: ${input.passTime}`);
  const startMs = passPeakMs == null ? nowMs : Math.max(nowMs - 3_600_000, passPeakMs - 6 * 3_600_000);
  const out = radioPass({
    record, entry,
    observer: loc,
    startMs,
    minElevationDeg: input.minElevationDeg ?? 10,
    frequencyHz: input.frequencyMHz ? Math.round(input.frequencyMHz * 1e6) : null,
    passPeakMs,
    windowHours: input.windowHours ?? 48,
  });
  return { satellite: displayName(entry, record), noradId: entry.noradId, url: satUrl(entry.noradId), resolvedLocation: loc, ...out, ...freshness(record, nowMs) };
}

const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/** Every satellite the catalog knows, ready to propagate (sky.mjs). */
async function wholeSky(deps) {
  if (typeof deps.skyCatalog !== 'function') throw new Error('the satellite catalog is unavailable');
  return prepareSky(await deps.skyCatalog());
}

/** A satellite in the sky now, as whats_up_now and identify_satellite list it. */
function skyRow(u, observer, ms, { radio = false } = {}) {
  const b = brightnessAt(u.sat, observer, u.ecef, ms, u.elDeg);
  return {
    noradId: u.sat.noradId,
    name: u.sat.name,
    url: satUrl(u.sat.noradId),
    azimuthDeg: r1(u.azDeg),
    direction: compass(u.azDeg),
    elevationDeg: r1(u.elDeg),
    rangeKm: Math.round(u.rangeM / 1000),
    sunlit: b.sunlit,
    magnitude: r1(b.magnitude),
    magnitudeEstimated: b.magnitudeEstimated,
    ...(radio && { downlinks: downlinkList({ downlinks: u.sat.downlinks }) }),
  };
}

/** "the Sun is 30° up" / "the Sun is only 3° below the horizon". */
function sunWords(sunAltDeg) {
  const n = Math.round(Math.abs(sunAltDeg));
  return sunAltDeg >= 0 ? `the Sun is ${n}° up` : `the Sun is only ${n}° below the horizon`;
}

const ESTIMATED_SKY_NOTE = 'Most satellites have no published brightness: their magnitude is estimated from an assumed small size (magnitudeEstimated), so treat it as a rough guide.';

/** What is overhead right now. Visual: sunlit satellites above minElevation
 *  while the observer's sky is dark, brightest first (known or estimated
 *  magnitude). Radio: satellites with known downlinks above minElevation,
 *  highest first. One propagation per satellite in the catalog. */
export async function whatsUpNowTool(input, deps) {
  const loc = await resolveLocation(input, deps);
  const mode = input.mode ?? 'visual';
  const minElevationDeg = input.minElevation ?? 10;
  const limit = Math.min(50, Math.max(1, input.limit ?? 10));
  const sats = await wholeSky(deps);
  const ms = deps.now();
  const observer = { latDeg: loc.latDeg, lonDeg: loc.lonDeg };
  const { up, propagated } = skyAt(sats, observer, ms, minElevationDeg);
  const { sunAltDeg, dark } = skyDarkness(observer, ms);
  const base = {
    resolvedLocation: loc,
    time: iso(ms),
    mode,
    minElevationDeg,
    sunAltitudeDeg: r1(sunAltDeg),
    skyDark: dark,
    scannedSatellites: propagated,
  };
  if (mode === 'radio') {
    const heard = up.filter((u) => u.sat.downlinks.length > 0).sort((a, b) => b.elDeg - a.elDeg);
    return {
      ...base,
      aboveCount: heard.length,
      satellites: heard.slice(0, limit).map((u) => skyRow(u, observer, ms, { radio: true })),
    };
  }
  if (!dark) {
    return {
      ...base,
      aboveCount: 0,
      satellites: [],
      note: `The sky is not dark enough here: ${sunWords(sunAltDeg)}, and satellites only show once it is about ${-DARK_SUN_ALT_DEG}° below the horizon. Try mode "radio", or best_pass for tonight.`,
    };
  }
  const seen = [];
  for (const u of up) {
    const row = skyRow(u, observer, ms);
    if (row.sunlit && row.magnitude != null) seen.push(row);
  }
  seen.sort((a, b) => a.magnitude - b.magnitude);
  return { ...base, aboveCount: seen.length, satellites: seen.slice(0, limit), note: ESTIMATED_SKY_NOTE };
}
