// lib/mcp/tools.mjs — pure MCP tool handlers. All I/O is injected via
// deps: { readMap(), geocode(query, opts?), fetchWeather(lat,lon), now() }.
// Handlers throw Error on bad input; the route layer maps that to an
// MCP error response.

import { CATALOG, resolveSatellite } from './catalog.mjs';
import { tleAgeHours } from './tle-record.mjs';
import { findPasses, getPosition } from './passes.mjs';
import { cloudAt } from '../pass-finder/weather.js';
import { effectivePClear } from '../pass-finder/ratings.js';

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

async function requireRecord(satellite, deps) {
  const entry = resolveSatellite(satellite);
  if (!entry) throw new Error(`unknown satellite: ${satellite}`);
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
      ...freshness(map[s.noradId] ?? null, nowMs),
    })),
  };
}

export async function getPositionTool(input, deps) {
  const { record } = await requireRecord(input.satellite, deps);
  const nowMs = deps.now();
  const when = input.time ? new Date(input.time) : new Date(nowMs);
  const pos = getPosition(record.line1, record.line2, when);
  return { ...pos, name: record.name, ...freshness(record, nowMs) };
}

export async function findPassesTool(input, deps) {
  const { record } = await requireRecord(input.satellite, deps);
  const loc = await resolveLocation(input, deps);
  const passes = findPasses({
    line1: record.line1, line2: record.line2,
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

export async function nextVisiblePassTool(input, deps) {
  const out = await findPassesTool({ ...input, mode: input.mode ?? 'visual', windowHours: 72 }, deps);
  return { satellite: out.satellite, resolvedLocation: out.resolvedLocation, pass: out.passes[0] ?? null, tleEpoch: out.tleEpoch, tleAgeHours: out.tleAgeHours, source: out.source };
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
