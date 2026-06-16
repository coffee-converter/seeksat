// lib/mcp/tools.mjs — pure MCP tool handlers. All I/O is injected via
// deps: { readMap(), geocode(query, opts?), fetchWeather(lat,lon), now() }.
// Handlers throw Error on bad input; the route layer maps that to an
// MCP error response.

import { CATALOG, resolveSatellite } from '../catalog.mjs';
import { tleAgeHours } from './tle-record.mjs';
import { findPasses, getPosition } from './passes.mjs';
import { cloudAt } from '../pass-finder/weather.js';
import { effectivePClear } from '../pass-finder/ratings.js';
import { fetchTimezone } from '../pass-finder/timezone.js';

const GEOCODE_HEADERS = { 'User-Agent': 'seeksat-mcp/1.0 (https://seeksat.app)' };

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
    throw new Error(`${entry.name} is a premium satellite — set an API key to access it`);
  }
}

async function requireRecord(satellite, deps, tier = 'free') {
  const entry = resolveSatellite(satellite);
  if (!entry) throw new Error(`unknown satellite: ${satellite}`);
  assertTierAllows(entry, tier);
  const record = (await deps.readMap())[entry.noradId];
  if (!record) throw new Error(`no TLE cached yet for ${entry.name} (${entry.noradId})`);
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
  const map = await deps.readMap();
  const nowMs = deps.now();
  return {
    satellites: CATALOG.map(s => ({
      noradId: s.noradId,
      name: s.name,
      aliases: s.aliases,
      tier: s.tier,
      ...freshness(map[s.noradId] ?? null, nowMs),
    })),
  };
}

export async function getPositionTool(input, deps, tier = 'free') {
  const { record } = await requireRecord(input.satellite, deps, tier);
  const nowMs = deps.now();
  const when = input.time ? new Date(input.time) : new Date(nowMs);
  const pos = getPosition(record.line1, record.line2, when);
  return { ...pos, name: record.name, ...freshness(record, nowMs) };
}

export async function findPassesTool(input, deps, tier = 'free') {
  const { entry, record } = await requireRecord(input.satellite, deps, tier);
  const loc = await resolveLocation(input, deps);
  const passes = findPasses({
    line1: record.line1, line2: record.line2,
    standardMag: entry.standardMag,
    observer: { latDeg: loc.latDeg, lonDeg: loc.lonDeg },
    startMs: deps.now(),
    windowHours: input.windowHours ?? 48,
    minElevationDeg: input.minElevation ?? 10,
    mode: input.mode ?? 'visual',
  });
  return {
    satellite: record.name,
    resolvedLocation: loc,
    passes,
    ...freshness(record, deps.now()),
  };
}

export async function nextVisiblePassTool(input, deps, tier = 'free') {
  const { entry, record } = await requireRecord(input.satellite, deps, tier);
  const loc = await resolveLocation(input, deps);
  const mode = input.mode ?? 'visual';
  const passes = findPasses({
    line1: record.line1, line2: record.line2,
    standardMag: entry.standardMag,
    observer: { latDeg: loc.latDeg, lonDeg: loc.lonDeg },
    startMs: deps.now(), windowHours: 72, minElevationDeg: 10, mode,
  });
  const pass = passes[0] ?? null;
  const out = { satellite: record.name, resolvedLocation: loc, pass, ...freshness(record, deps.now()) };
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
// pass — not a later one — is the one rendered. The 20-min back-off is far
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

// Rank upcoming passes by quality across the whole catalog (or a single
// satellite when `satellite` is given) and return the best ones. A thin
// fan-out over findPasses: resolve the location once, scan each accessible
// satellite, merge, and sort by the pre-computed quality score (0–1, which
// already folds in peak elevation, brightness, darkness, and weather odds).
export async function bestPassTool(input, deps, tier = 'free') {
  const loc = await resolveLocation(input, deps);
  const windowHours = input.windowHours ?? 72;
  const minElevationDeg = input.minElevation ?? 10;
  const mode = input.mode ?? 'visual';
  const limit = input.limit ?? 3;

  // One satellite if named, else the full catalog.
  let entries;
  if (input.satellite != null) {
    const entry = resolveSatellite(input.satellite);
    if (!entry) throw new Error(`unknown satellite: ${input.satellite}`);
    entries = [entry];
  } else {
    entries = CATALOG;
  }

  const map = await deps.readMap();
  const startMs = deps.now();
  const observer = { latDeg: loc.latDeg, lonDeg: loc.lonDeg };
  const all = [];
  const skipped = [];
  for (const entry of entries) {
    // Skip (don't fail) satellites the caller can't access or that lack a
    // cached TLE — a cross-catalog scan should degrade gracefully.
    if (entry.tier === 'premium' && tier !== 'pro') { skipped.push({ satellite: entry.name, reason: 'premium — set an API key' }); continue; }
    const record = map[entry.noradId];
    if (!record) { skipped.push({ satellite: entry.name, reason: 'no TLE cached yet' }); continue; }
    const passes = findPasses({
      line1: record.line1, line2: record.line2,
      standardMag: entry.standardMag,
      observer,
      startMs, windowHours, minElevationDeg, mode,
    });
    for (const p of passes) all.push({ satellite: entry.name, shortName: entry.shortName, ...p });
  }
  all.sort((a, b) => b.quality - a.quality);
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
    const bestEntry = resolveSatellite(best.satellite);
    const bestRecord = bestEntry ? map[bestEntry.noradId] : null;
    if (bestEntry && bestRecord) {
      const { pngBase64, summary } = await renderChart({ entry: bestEntry, record: bestRecord, loc, mode, nowMs: scanStartForPass(best.peak) });
      return { ...out, summary, pngBase64 };
    }
  }
  return out;
}
