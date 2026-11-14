// lib/mcp/tools.mjs - pure MCP tool handlers. All I/O is injected via
// deps: { getRecord(noradId), geocode(query, opts?), fetchWeather(lat,lon), now(),
// search?(query, limit, { radio }), radioIds?() (satellites with known
// downlinks), radioScanCache? (an LRU from radio-scan.mjs createLru),
// visualIds?() (satellites in CelesTrak's visual group), visualScanCache?
// (another LRU), skyCatalog?() (every satellite, for whole-sky tools) }.
// Handlers throw Error on bad input; the route layer maps that to an
// MCP error response.

import { parseLocationInput } from '../location/maidenhead.mjs';
import { cleanText } from './text.mjs';
import { CATALOG, resolveSatellite, displayName, isCurated, downlinksFor } from '../catalog.mjs';
import { findPasses, getPosition, enginePasses, passSearch, rankKey, passRow, passCloudBadge } from './passes.mjs';
import { radioPass, downlinkList } from './radio.mjs';
import { coarseScan, refineWindows, scanKey, cellOf, hourOf, stageWindowHours, stageMinElevation, COARSE_MARGIN_DEG } from './radio-scan.mjs';
import { coarseVisualScan, roughVisualScore, byRoughVisual } from './visual-scan.mjs';
import { makeTrack } from '../sat/track.mjs';
import { BAND_IDS, inBands } from '../radio/bands.mjs';
import { RADIO_WORDS, downlinkHasWord } from '../radio/modes.mjs';
import {
  prepareSky, skyAt, skyDarkness, brightnessAt, DARK_SUN_ALT_DEG, ecefAt, observerFrame,
  parseCompass, angularSeparationDeg, bearingDiffDeg, travelBearingDeg,
} from './sky.mjs';
import * as satellite from 'satellite.js';
import { compass } from '../sat/pass-rows.mjs';
import { cloudAt } from '../pass-finder/weather.js';
import { effectivePClear } from '../pass-finder/ratings.js';
import { SITE_URL } from '../site.mjs';
import { zoneAt, withLocalTimes, parseTimeInput } from './local-time.mjs';
import { pick, numberInput } from './inputs.mjs';
import { elementAgeAt, staleAt, staleDuring, assertNearEpoch, assertWindowNearEpoch } from './freshness.mjs';
import { satrecFromRecord } from '../sat/satrec.mjs';
import { noPassReason, skyGetsDark } from './why-empty.mjs';
import { shareUrl } from '../share/share-link.mjs';
import { MAX_WINDOW_HOURS, ALIASES } from './tool-specs.mjs';
import { SKY_TYPES, DEFAULT_SKY } from '../sky/visual-rating.mjs';

const iso = (ms) => new Date(ms).toISOString();

// Inputs shared by several tools (inputs.mjs): one name each, old names as
// aliases, defaults, and ranges checked with a clear error.
const windowIn = (input, def) => numberInput(input, ['windowHours'], { def, min: 0, max: MAX_WINDOW_HOURS, minExclusive: true, unit: ' hours' });
const minElevationIn = (input) => numberInput(input, ['minElevation', ...ALIASES.minElevation], { def: 10, min: 0, max: 90, unit: ' degrees' });
/** A time input under its name or an old one (ALIASES), or undefined. */
const timeIn = (input) => pick(input, 'time', ...ALIASES.time);
const limitIn = (input, def, max) => numberInput(input, ['limit'], { def, min: 1, max, integer: true });
const SKY_IDS = SKY_TYPES.map((t) => t.id);
/** The sky type the visual rating reads (visual-rating.mjs SKY_TYPES), the
 *  app's default when absent. */
function skyTypeIn(input) {
  const v = input.skyType;
  if (v == null) return DEFAULT_SKY;
  const id = String(v).toLowerCase();
  if (!SKY_IDS.includes(id)) throw new Error(`skyType must be one of ${SKY_IDS.join(', ')} (got ${JSON.stringify(v)})`);
  return id;
}

/** A result with the observer's local time next to every UTC time
 *  (local-time.mjs withLocalTimes). */
const local = (out, loc) => withLocalTimes(out, loc.timeZone);

/** A time input read on the observer's clock when it has no offset; the
 *  interpretation goes back to the caller as interpretedAs. */
function readTime(value, loc, name = 'time') {
  return parseTimeInput(value, { timeZone: loc.timeZone, name, zoneLabel: `the observer's time zone (${loc.timeZone})` });
}

/** The satellite's page on the site, for an agent to link to. */
export function satUrl(noradId) {
  return `${SITE_URL}/sat/${noradId}`;
}

const GEOCODE_HEADERS = { 'User-Agent': 'seeksat-mcp/1.0 (https://seeksat.com)' };

/** A record's element epoch in ms: its own epochMs, else the elements'. */
function epochOf(record) {
  if (Number.isFinite(record?.epochMs)) return record.epochMs;
  try {
    const s = satrecFromRecord(record);
    return s && !s.error ? (s.jdsatepoch + (s.jdsatepochF ?? 0) - 2440587.5) * 86_400_000 : null;
  } catch {
    return null;
  }
}

/** Where the elements came from and how fresh they are. elementAge grades
 *  the gap between the epoch and `atMs` (now unless a time was asked about,
 *  `asked`) the way the app does: fresh, old (over 7 days) or stale (over 14),
 *  with a warning when not fresh. */
function freshness(record, nowMs, { atMs = nowMs, asked = false } = {}) {
  if (!record) return { tleEpoch: null, tleAgeHours: null, source: null, elementAge: null };
  const epochMs = epochOf(record);
  const age = epochMs == null ? null : (nowMs - epochMs) / 3_600_000;
  return {
    tleEpoch: epochMs == null ? null : new Date(epochMs).toISOString(),
    tleAgeHours: age == null ? null : Number(age.toFixed(2)),
    source: record.source,
    elementAge: elementAgeAt(epochMs, atMs, { asked }),
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

// The observer, with its IANA time zone (offline lookup) so results can give
// local times and read local time inputs.
export async function resolveLocation(input, deps) {
  if (input.lat != null && input.lon != null) {
    return { latDeg: input.lat, lonDeg: input.lon, displayName: null, timeZone: zoneAt(input.lat, input.lon) };
  }
  if (input.location) {
    // Grid squares and written coordinates are read here, as the site's own
    // location box reads them (lib/location/maidenhead.mjs); only a place
    // name goes to the geocoder.
    const parsed = parseLocationInput(String(input.location));
    if (parsed?.kind === 'invalid') throw new Error(`location "${input.location}": ${parsed.message}`);
    if (parsed?.kind === 'grid' || parsed?.kind === 'coords') {
      const displayName = parsed.kind === 'grid' ? `grid square ${parsed.grid}` : null;
      return { latDeg: parsed.latDeg, lonDeg: parsed.lonDeg, displayName, timeZone: zoneAt(parsed.latDeg, parsed.lonDeg) };
    }
    const g = await deps.geocode(input.location, { headers: GEOCODE_HEADERS });
    if (g && g.busy) throw new Error('the place lookup is busy right now: pass lat and lon (or a grid square) instead, or try again in a moment');
    if (!g) throw new Error(`could not find a place called "${input.location}": check the spelling, or pass lat and lon (or a grid square)`);
    return { ...g, displayName: cleanText(g.displayName, 160), placeName: cleanText(g.placeName, 80), timeZone: zoneAt(g.latDeg, g.lonDeg) };
  }
  throw new Error('a location is required: pass lat+lon or a location string');
}

/** A short name for the observer: the first part of a geocoded name
 *  ("Chicago, ..., United States" is Chicago), else the coordinates. */
function placeLabel(loc) {
  return loc.displayName
    ? loc.displayName.split(',')[0].trim()
    : `${loc.latDeg.toFixed(2)}, ${loc.lonDeg.toFixed(2)}`;
}

/** The pass on seeksat.com: the satellite's page opened on this pass from
 *  this place (lib/share/share-link.mjs, as the site's own share button).
 *  The link carries the middle of the row's rise and set, not its peak: the
 *  site opens the row whose span holds that time (shared-view.mjs), and a
 *  visual pass's peak can sit on the very first or last second of its row,
 *  which an element refresh can move past. */
function passUrl(noradId, loc, mode, minElevDeg, riseMs, setMs) {
  return shareUrl(SITE_URL, {
    noradId,
    observers: [{ name: placeLabel(loc), latDeg: loc.latDeg, lonDeg: loc.lonDeg }],
    passMs: Math.round((riseMs + setMs) / 2), mode, freqHz: null, minElevDeg,
  });
}

/** Pass rows with their passUrl; `noradId` for rows that do not carry one. */
const withPassUrls = (rows, { noradId = null, loc, mode, minElevDeg }) =>
  rows.map((r) => ({ ...r, passUrl: passUrl(r.noradId ?? noradId, loc, mode, minElevDeg, Date.parse(r.rise), Date.parse(r.set)) }));

/** Why a pass search for one satellite came back empty (why-empty.mjs). */
function emptyNote({ record, entry, loc, mode, minElevationDeg, windowHours, startMs, stationary }) {
  let track;
  try { track = makeTrack(record, entry); } catch { return null; }
  const observer = { latDeg: loc.latDeg, lonDeg: loc.lonDeg };
  return noPassReason({
    track, observer, mode, minElevationDeg, windowHours, startMs, stationary,
    hasRadioPass: () => enginePasses({ record, entry, observer, startMs, windowHours, minElevationDeg, mode: 'radio' }).passes.length > 0,
  });
}

/** True when the input names a place (lat+lon or a location string). */
const hasLocation = (input) => (input.lat != null && input.lon != null) || Boolean(input.location);

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

// A place is optional here: it only sets the clock for local times and for
// reading a time with no offset (UTC without one).
export async function getPositionTool(input, deps, tier = 'free') {
  const { entry, record } = await requireRecord(input.satellite, deps, tier);
  const loc = hasLocation(input) ? await resolveLocation(input, deps) : null;
  const nowMs = deps.now();
  const asked = timeIn(input);
  const read = asked == null ? null
    : loc ? readTime(asked, loc)
    : parseTimeInput(asked, { timeZone: 'UTC', zoneLabel: 'UTC (give a location to read it in local time)' });
  // Every time it works out is checked against the epoch, now included.
  assertNearEpoch(epochOf(record), read ? read.ms : nowMs, read ? 'time' : 'the time now');
  const pos = getPosition(record, new Date(read ? read.ms : nowMs));
  if (!pos) throw new Error(`elements for ${displayName(entry, record)} can't be propagated to that time`);
  const out = {
    ...pos, name: displayName(entry, record), noradId: entry.noradId, url: satUrl(entry.noradId),
    ...(loc && { resolvedLocation: loc }),
    ...(read && { interpretedAs: read.interpretedAs }),
    ...freshness(record, nowMs, read ? { atMs: read.ms, asked: true } : {}),
  };
  return loc ? local(out, loc) : out;
}

export async function findPassesTool(input, deps, tier = 'free') {
  const { entry, record } = await requireRecord(input.satellite, deps, tier);
  const loc = await resolveLocation(input, deps);
  const startMs = deps.now();
  const windowHours = windowIn(input, 48);
  const minElevationDeg = minElevationIn(input);
  const mode = input.mode ?? 'visual';
  const skyType = skyTypeIn(input);
  assertWindowNearEpoch(epochOf(record), startMs, startMs + windowHours * 3_600_000);
  const { forecast, weather } = mode === 'visual' ? await visualForecast(deps, loc) : { forecast: null, weather: undefined };
  const { passes, stationary, unavailable } = findPasses({
    record, entry,
    standardMag: entry.standardMag,
    observer: { latDeg: loc.latDeg, lonDeg: loc.lonDeg },
    startMs, windowHours, minElevationDeg, mode, cloud: forecast, skyType, nowMs: startMs,
  });
  if (unavailable) throw new Error(`elements for ${displayName(entry, record)} can't be propagated`);
  return local({
    satellite: displayName(entry, record),
    noradId: entry.noradId,
    url: satUrl(entry.noradId),
    resolvedLocation: loc,
    ...(weather && { weather }),
    passes: withPassUrls(passes, { noradId: entry.noradId, loc, mode, minElevDeg: minElevationDeg })
      .map((r) => ({ ...r, ...cloudCover(forecast, Date.parse(r.peak)) })),
    ...(!passes.length && { note: emptyNote({ record, entry, loc, mode, minElevationDeg, windowHours, startMs, stationary }) }),
    stationary,
    ...freshness(record, deps.now()),
  }, loc);
}

export async function nextVisiblePassTool(input, deps, tier = 'free') {
  const { entry, record } = await requireRecord(input.satellite, deps, tier);
  const loc = await resolveLocation(input, deps);
  const mode = input.mode ?? 'visual';
  const minElevationDeg = minElevationIn(input);
  const startMs = deps.now();
  const windowHours = windowIn(input, 72);
  const skyType = skyTypeIn(input);
  assertNearEpoch(epochOf(record), startMs, 'the time now');
  const { forecast, weather } = mode === 'visual' ? await visualForecast(deps, loc) : { forecast: null, weather: undefined };
  const { passes, stationary, unavailable } = findPasses({
    record, entry,
    standardMag: entry.standardMag,
    observer: { latDeg: loc.latDeg, lonDeg: loc.lonDeg },
    startMs, windowHours, minElevationDeg, mode, cloud: forecast, skyType, nowMs: startMs, limit: 1,
  });
  if (unavailable) throw new Error(`elements for ${displayName(entry, record)} can't be propagated`);
  // The one pass it answers with must be near the epoch too.
  if (passes.length) assertNearEpoch(epochOf(record), Date.parse(passes[0].set), 'the next pass');
  const pass = passes.length
    ? { ...withPassUrls([passes[0]], { noradId: entry.noradId, loc, mode, minElevDeg: minElevationDeg })[0], ...cloudCover(forecast, Date.parse(passes[0].peak)) }
    : null;
  const out = {
    satellite: displayName(entry, record), noradId: entry.noradId, url: satUrl(entry.noradId),
    resolvedLocation: loc, ...(weather && { weather }), pass,
    ...(!pass && { note: emptyNote({ record, entry, loc, mode, minElevationDeg, windowHours, startMs, stationary }) }),
    stationary, ...freshness(record, deps.now()),
  };
  // With chart:true, fold the sky chart for that pass into this same result so
  // the caller gets data + image in one tool call (no separate get_pass_chart).
  if (input.chart && pass) {
    const { pngBase64, summary } = await renderChart({ entry, record, loc, mode, minElevationDeg, nowMs: scanStartForPass(pass.peak) });
    return local({ ...out, summary, pngBase64 }, loc);
  }
  return local(out, loc);
}

// The forecast for one place and time, or available:false with the reason
// (a time it cannot read, a time outside the forecast, or a failed fetch):
// never a stand-in number.
export async function getPassWeatherTool(input, deps) {
  const loc = await resolveLocation(input, deps);
  let read;
  try {
    read = readTime(input.time, loc);
  } catch (e) {
    return local({ resolvedLocation: loc, available: false, reason: e.message }, loc);
  }
  const atMs = read.ms;
  const base = { resolvedLocation: loc, time: iso(atMs), interpretedAs: read.interpretedAs };
  let forecast = null;
  try { forecast = await deps.fetchWeather(loc.latDeg, loc.lonDeg); } catch { forecast = null; }
  if (!forecast || !Array.isArray(forecast.hours) || !forecast.hours.length) {
    return local({ ...base, available: false, reason: 'The cloud forecast (Open-Meteo and MET Norway) could not be fetched right now. Try again later.' }, loc);
  }
  const forecastFrom = forecast.startMs;
  const forecastUntil = forecast.startMs + (forecast.hours.length - 1) * 3_600_000;
  const span = { forecastFrom: iso(forecastFrom), forecastUntil: iso(forecastUntil) };
  const cloudPct = cloudAt(forecast, atMs);
  if (cloudPct == null) {
    const reason = atMs < forecastFrom
      ? 'That time is before the forecast starts: there is no cloud forecast for the past.'
      : `That time is beyond the forecast, which reaches about ${Math.max(0, Math.floor((forecastUntil - deps.now()) / 86_400_000))} days ahead.`;
    return local({ ...base, available: false, reason, ...span }, loc);
  }
  const aheadDays = (atMs - deps.now()) / 86_400_000;
  return local({
    ...base,
    available: true,
    cloudCoverPct: Math.round(cloudPct),
    viewingProbability: Number(effectivePClear(cloudPct, aheadDays).toFixed(2)),
    forecastSource: FORECAST_SOURCE,
    ...span,
  }, loc);
}

// Render the polar sky chart for the pass at/after `nowMs`. Shared by
// get_pass_chart and the optional `chart` flag on next_visible_pass /
// best_pass. Returns { pngBase64, summary }.
async function renderChart({ entry, record, loc, mode = 'visual', minElevationDeg = 10, scanHours = 72, nowMs }) {
  // Short label for the chart title/summary: the first component of the
  // geocoded name ("Chicago, …, United States" → "Chicago"), or the
  // coordinates when the agent passed raw lat/lon. Keeps long place names
  // from overflowing the chart title.
  const name = placeLabel(loc);
  // The observer's IANA time zone (offline lookup) so the chart's times read
  // on the location's clock.
  const observer = { name, latDeg: loc.latDeg, lonDeg: loc.lonDeg, tz: loc.timeZone };
  const { renderPassChartPng } = await import('./pass-chart.mjs');
  return renderPassChartPng({ entry, record, observer, mode, minElevationDeg, scanHours, nowMs });
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
  const asked = timeIn(input);
  const read = asked == null ? null : readTime(asked, loc);
  if (read) {
    assertNearEpoch(epochOf(record), read.ms);
    nowMs = scanStartForPass(iso(read.ms));
  } else {
    assertNearEpoch(epochOf(record), nowMs, 'the time now');
  }
  const mode = input.mode ?? 'visual';
  const minElevationDeg = minElevationIn(input);
  const skyType = skyTypeIn(input);
  const scanHours = read ? 72 : windowIn(input, 72);
  const { forecast, weather } = mode === 'visual' ? await visualForecast(deps, loc) : { forecast: null, weather: undefined };
  // The charted pass as a full row (the same engine search the chart runs),
  // or where a satellite that never moves through the sky sits.
  const { passes, stationary, unavailable } = findPasses({
    record, entry, standardMag: entry.standardMag,
    observer: { latDeg: loc.latDeg, lonDeg: loc.lonDeg },
    startMs: nowMs, windowHours: scanHours, minElevationDeg, mode, cloud: forecast, skyType, nowMs: deps.now(), limit: 1,
  });
  if (unavailable) throw new Error(`elements for ${displayName(entry, record)} can't be propagated`);
  const row = passes[0] ?? null;
  if (row) assertNearEpoch(epochOf(record), Date.parse(row.set), 'the charted pass');
  const chart = row ? await renderChart({ entry, record, loc, mode, minElevationDeg, scanHours, nowMs }) : null;
  const pass = row ? {
    ...withPassUrls([row], { noradId: entry.noradId, loc, mode, minElevDeg: minElevationDeg })[0],
    ...cloudCover(forecast, Date.parse(row.peak)),
    // Kept from the chart's own pass summary for older callers.
    peakAzimuthDeg: row.azimuthDeg.peak,
  } : null;
  const name = entry.shortName ?? displayName(entry, record);
  const summary = chart?.summary ?? (stationary
    ? `${name} from ${placeLabel(loc)}: ${stationary.note} It sits at azimuth ${stationary.azimuthDeg}° (${compass(stationary.azimuthDeg)}), elevation ${stationary.elevationDeg}°.`
    : `No upcoming ${mode} pass for ${name} from ${placeLabel(loc)} in the next ${scanHours}h.`);
  return local({
    satellite: displayName(entry, record), noradId: entry.noradId, url: satUrl(entry.noradId),
    resolvedLocation: loc,
    ...(read && { interpretedAs: read.interpretedAs }),
    ...(weather && { weather }),
    pass,
    ...(!pass && { note: emptyNote({ record, entry, loc, mode, minElevationDeg, windowHours: scanHours, startMs: nowMs, stationary }) }),
    stationary,
    summary,
    ...freshness(record, deps.now(), read ? { atMs: read.ms, asked: true } : {}),
    ...(chart?.pngBase64 && { pngBase64: chart.pngBase64 }),
  }, loc);
}

/** Higher first, with a missing value last. */
const desc = (a, b) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : b - a);

// Visual passes, best first, as the app rates them (row.rating): more bars,
// then a known brightness before a guess (a guess is already held to Fair),
// then the more headroom (how much brighter than the faintest star in that
// sky it gets), then the likelier to be caught on camera. Takes rows or the
// keys passes.mjs rankKey gives.
export function byVisualRating(a, b) {
  return (b.rating.bars - a.rating.bars)
    || (Number(a.peakMagnitudeEstimated === true) - Number(b.peakMagnitudeEstimated === true))
    || desc(a.rating.headroomMag, b.rating.headroomMag)
    || (b.captureProbability - a.captureProbability);
}

// Radio passes, best first: more bars (the app's radio rating, from height),
// then the higher, then the likelier, then the longer, then the sooner.
// Brightness means nothing here.
export function byRadioRating(a, b) {
  return (b.rating.bars - a.rating.bars)
    || (b.peakElevationDeg - a.peakElevationDeg)
    || (b.captureProbability - a.captureProbability)
    || (b.durationSec - a.durationSec)
    || (Date.parse(a.rise) - Date.parse(b.rise));
}

const FORECAST_SOURCE = 'open-meteo+met.no';

/** The cloud forecast for a place, for ranking visual passes: one fetch
 *  covers every pass. Never throws: without a forecast the passes rank with
 *  the engine's neutral cloud factor, and `weather` says so. */
async function visualForecast(deps, loc) {
  let forecast = null;
  if (typeof deps.fetchWeather === 'function') {
    try { forecast = await deps.fetchWeather(loc.latDeg, loc.lonDeg); } catch { forecast = null; }
  }
  if (!forecast || !Array.isArray(forecast.hours) || !forecast.hours.length) {
    return { forecast: null, weather: { used: false, reason: 'The cloud forecast could not be fetched, so ratings have no cloud step and captureProbability counts clouds as a neutral 0.5.' } };
  }
  return {
    forecast,
    weather: {
      used: true,
      source: FORECAST_SOURCE,
      forecastUntil: iso(forecast.startMs + (forecast.hours.length - 1) * 3_600_000),
      note: 'Ratings step down for cloud as the app\'s do, for passes up to 4 days ahead (cloudCoverPct at the peak); captureProbability uses the forecast where it reaches and a neutral 0.5 after.',
    },
  };
}

/** Forecast cloud cover at a pass's peak, for its row; nothing without a
 *  forecast. */
function cloudCover(forecast, peakMs) {
  if (!forecast) return {};
  const c = cloudAt(forecast, peakMs);
  return { cloudCoverPct: c == null ? null : Math.round(c) };
}

// Rank upcoming passes by the app's rating and return the best ones. With a
// satellite named, that satellite's passes. With none, visual mode scans the
// popular satellites plus CelesTrak's visual group (visualScanTool) and radio
// mode every satellite with a known downlink (radioScanTool). The visual
// rating is brightness against the sky's darkness, stepped down for cloud (a
// guessed magnitude stops at Fair); the radio rating is peak height.
export async function bestPassTool(input, deps, tier = 'free') {
  const loc = await resolveLocation(input, deps);
  const mode = input.mode ?? 'visual';
  if (input.satellite == null) {
    if (mode === 'visual') return visualScanTool(input, deps, tier, loc);
    if (typeof deps.radioIds === 'function') return radioScanTool(input, deps, tier, loc);
  }
  const windowHours = windowIn(input, 72);
  const minElevationDeg = minElevationIn(input);
  const limit = limitIn(input, 3, 20);
  const skyType = skyTypeIn(input);
  const { forecast, weather } = mode === 'visual' ? await visualForecast(deps, loc) : { forecast: null, weather: undefined };

  // One satellite if named, else the popular list (radio, when there is no
  // index of satellites with downlinks).
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
  const rateOpts = { cloud: forecast, skyType, nowMs: startMs };
  const found = [];
  const skipped = [];
  let only = null; // the named satellite's record and pointing, for an empty note
  for (const entry of entries) {
    // Skip (don't fail) satellites the caller can't access or that have no
    // orbit record yet - a cross-catalog scan should degrade gracefully.
    if (entry.tier === 'premium' && tier !== 'pro') { skipped.push({ satellite: displayName(entry, null), reason: 'premium - set an API key' }); continue; }
    const record = await deps.getRecord(entry.noradId);
    if (!record) { skipped.push({ satellite: displayName(entry, null), reason: 'no orbit data yet' }); continue; }
    // The whole window must be near the epoch: a named satellite says why
    // not, one of many is skipped.
    const endMs = startMs + windowHours * 3_600_000;
    if (entries.length === 1) assertWindowNearEpoch(epochOf(record), startMs, endMs);
    else if (staleDuring(epochOf(record), startMs, startMs)) { skipped.push({ satellite: displayName(entry, record), reason: 'orbital elements more than 14 days old' }); continue; }
    const { track, obs, passes, stationary, unavailable } = passSearch({
      record, entry,
      standardMag: entry.standardMag,
      observer,
      startMs, windowHours, minElevationDeg, mode,
    });
    if (unavailable) { skipped.push({ satellite: displayName(entry, record), reason: "elements can't be propagated" }); continue; }
    if (entries.length === 1) only = { entry, record, stationary };
    if (stationary) {
      const reason = stationary.motion === 'moving'
        ? 'geosynchronous: always up here and moving, no passes'
        : 'geostationary: fixed in the sky, no passes';
      skipped.push({ satellite: displayName(entry, record), reason });
      continue;
    }
    for (const p of passes) found.push({ entry, record, track, obs, p, key: rankKey(p, track, obs, mode, minElevationDeg, rateOpts) });
  }
  // Rank on what the rows will say, then build full rows for the winners only.
  const byRating = mode === 'radio' ? byRadioRating : byVisualRating;
  found.sort((a, b) => byRating(a.key, b.key) || (a.p.startMs - b.p.startMs));
  const sources = new Map();
  const all = found.slice(0, limit).map(({ entry, record, track, obs, p }) => {
    const downlinks = mode === 'radio' ? downlinkList({ downlinks: downlinksFor(entry, record) }) : undefined;
    const row = {
      satellite: displayName(entry, record), shortName: entry.shortName, noradId: entry.noradId, url: satUrl(entry.noradId),
      ...passRow(p, track, obs, mode, minElevationDeg, rateOpts), ...cloudCover(forecast, p.peakMs), ...(downlinks && { downlinks }),
      elementAge: elementAgeAt(epochOf(record), startMs),
      passUrl: passUrl(entry.noradId, loc, mode, minElevationDeg, p.startMs, p.endMs),
    };
    sources.set(row, { entry, record });
    return row;
  });
  const best = all[0] ?? null;
  const out = {
    resolvedLocation: loc,
    mode,
    windowHours,
    satellitesScanned: entries.length - skipped.length,
    skipped: skipped.length ? skipped : undefined,
    ...(weather && { weather }),
    best,
    passes: all,
    // A named satellite that never moves through the sky: where it sits.
    ...(only?.stationary && { stationary: only.stationary }),
    ...(!best && only && { note: emptyNote({ ...only, loc, mode, minElevationDeg, windowHours, startMs }) }),
  };
  // With chart:true, render the winning pass's sky chart into this same result
  // so "best pass with a chart" is a single tool call carrying data + image.
  if (input.chart && best) {
    const { entry: bestEntry, record: bestRecord } = sources.get(best) ?? {};
    if (bestEntry && bestRecord) {
      const { pngBase64, summary } = await renderChart({ entry: bestEntry, record: bestRecord, loc, mode, minElevationDeg, nowMs: scanStartForPass(best.peak) });
      return local({ ...out, summary, pngBase64 }, loc);
    }
  }
  return local(out, loc);
}

/** How far below the last place asked for a rough visual pass may score and
 *  still be checked (visual-scan.mjs roughVisualScore: about 4 magnitudes of
 *  headroom inside one bar). */
const VISUAL_REFINE_SLACK = 0.1;

/** Default and longest look-ahead for a visual scan across the bright sky. */
export const VISUAL_SCAN_HOURS = 72;
export const VISUAL_SCAN_MAX_HOURS = 168;

/** What a visual scan looks at: the popular satellites plus every satellite
 *  in CelesTrak's visual group (the brightest objects, many of them spent
 *  rocket bodies), ascending. */
async function visualCandidates(deps) {
  const ids = new Set(CATALOG.map((c) => c.noradId));
  if (typeof deps.visualIds === 'function') for (const id of await deps.visualIds()) ids.add(id);
  return [...ids].sort((a, b) => a - b);
}

/** Stage 1 of the visual scan (visual-scan.mjs) for one cell and hour: every
 *  candidate swept for the rough passes it can be seen on. Satellites that
 *  cannot have passes are counted by reason. */
async function coarseVisualStage(deps, { cell, hourMs, windowHours, minElevationDeg, tier }) {
  const ids = await visualCandidates(deps);
  const sats = [];
  const skipped = {};
  let stale = 0;
  const skip = (reason, n = 1) => { skipped[reason] = (skipped[reason] ?? 0) + n; };
  for (const id of ids) {
    const entry = resolveSatellite(id);
    if (!entry) continue;
    if (entry.tier === 'premium' && tier !== 'pro') { skip('premium - set an API key'); continue; }
    const record = await deps.getRecord(id);
    if (!record) { skip('no orbit data yet'); continue; }
    // Stale at the start of the sweep leaves it out. (Judged at its end too,
    // a week-long sweep would drop every satellite a week after a refresh.)
    if (staleDuring(epochOf(record), hourMs, hourMs)) { stale++; continue; }
    let track;
    try { track = makeTrack(record, entry); } catch { skip("elements can't be propagated"); continue; }
    if (track.orbitClass === 'geo') { skip('geosynchronous: no passes'); continue; }
    sats.push({ noradId: id, satrec: track.satrec, standardMag: Number.isFinite(entry.standardMag) ? entry.standardMag : null });
  }
  const endMs = hourMs + (windowHours + 1) * 3_600_000;
  const r = await coarseVisualScan(sats, cell, hourMs, endMs, minElevationDeg - COARSE_MARGIN_DEG);
  if (r.unavailable.length) skip("elements can't be propagated", r.unavailable.length);
  return { passes: r.passes, swept: sats.length - r.unavailable.length, skipped, stale };
}

/** best_pass in visual mode with no satellite named: the best naked-eye
 *  passes of the popular satellites and CelesTrak's visual group. A coarse
 *  sweep of all of them (cached per 0.25 degree cell and hour) picks the
 *  candidates, scored roughly with the cloud forecast; the full engine scores
 *  those at the exact place and time, ranked by the app's rating (a guessed
 *  magnitude stops at Fair, and a known bright satellite wins a tie). */
async function visualScanTool(input, deps, tier, loc) {
  const asked = windowIn(input, VISUAL_SCAN_HOURS);
  const windowHours = Math.min(asked, VISUAL_SCAN_MAX_HOURS);
  const minElevationDeg = minElevationIn(input);
  const limit = limitIn(input, 3, 20);
  const skyType = skyTypeIn(input);
  const startMs = deps.now();
  const endMs = startMs + windowHours * 3_600_000;
  const hourMs = hourOf(startMs);
  const cell = cellOf(loc.latDeg, loc.lonDeg);

  // Concurrent asks for the same key share one sweep; a failed one is not
  // kept. The sweep's window and elevation are rounded (radio-scan.mjs
  // stageWindowHours) so near-identical asks share it.
  const cache = deps.visualScanCache ?? null;
  const stageArgs = { cell, hourMs, windowHours: stageWindowHours(windowHours), minElevationDeg: stageMinElevation(minElevationDeg), tier };
  const key = `visual|${scanKey({ ...stageArgs, ...cell })}|${tier}`;
  let stage = cache?.get(key);
  if (!stage) {
    stage = coarseVisualStage(deps, stageArgs);
    cache?.set(key, stage);
    stage.catch(() => cache?.delete(key));
  }
  const [coarse, { forecast, weather }] = await Promise.all([stage, visualForecast(deps, loc)]);

  // Rated roughly as the rows will be, with the cloud badge at a moment as
  // the app badges a pass at its peak.
  const badgeAt = (ms) => passCloudBadge(forecast, ms, startMs);
  const rough = coarse.passes.map((p) => ({ ...p, ...roughVisualScore(p, { skyType, badgeAt }) }));
  const windows = refineWindows(rough, startMs, endMs, limit, byRoughVisual, VISUAL_REFINE_SLACK);
  const rateOpts = { cloud: forecast, skyType, nowMs: startMs };

  const observer = { latDeg: loc.latDeg, lonDeg: loc.lonDeg };
  const found = [];
  for (const [id, list] of windows) {
    const entry = resolveSatellite(id);
    const record = await deps.getRecord(id);
    if (!entry || !record) continue;
    for (const w of list) {
      const { track, obs, passes } = enginePasses({
        record, entry, standardMag: entry.standardMag, observer, minElevationDeg, mode: 'visual',
        startMs: w.startMs, windowHours: (w.endMs - w.startMs) / 3_600_000,
      });
      for (const p of passes) found.push({ entry, record, track, obs, p, key: rankKey(p, track, obs, 'visual', minElevationDeg, rateOpts) });
    }
  }
  found.sort((a, b) => byVisualRating(a.key, b.key) || (a.p.startMs - b.p.startMs));
  const sources = new Map();
  const rows = found.slice(0, limit).map(({ entry, record, track, obs, p }) => {
    const row = {
      satellite: displayName(entry, record), shortName: entry.shortName, noradId: entry.noradId, url: satUrl(entry.noradId),
      ...passRow(p, track, obs, 'visual', minElevationDeg, rateOpts), ...cloudCover(forecast, p.peakMs),
      elementAge: elementAgeAt(epochOf(record), startMs),
      passUrl: passUrl(entry.noradId, loc, 'visual', minElevationDeg, p.startMs, p.endMs),
    };
    sources.set(row, { entry, record });
    return row;
  });
  const best = rows[0] ?? null;
  const out = {
    resolvedLocation: loc,
    mode: 'visual',
    windowHours,
    ...(asked > windowHours && { windowNote: `A visual scan across the bright sky looks at most ${VISUAL_SCAN_MAX_HOURS} hours ahead.` }),
    satellitesScanned: coarse.swept,
    checkedInDetail: windows.size,
    skippedStaleElements: coarse.stale,
    skippedCounts: Object.keys(coarse.skipped).length ? coarse.skipped : undefined,
    weather,
    best,
    passes: rows,
    ...(!best && {
      note: skyGetsDark(observer, startMs, windowHours)
        ? `None of the ${coarse.swept} satellites scanned has a pass above ${minElevationDeg}° that is sunlit while the sky is dark here in the next ${windowHours} hours.`
        : `The sky never gets dark enough here in the next ${windowHours} hours (the Sun stays less than 6° below the horizon), so nothing can be seen by eye. Try mode "radio".`,
    }),
  };
  if (input.chart && best) {
    const { entry, record } = sources.get(best);
    const { pngBase64, summary } = await renderChart({ entry, record, loc, mode: 'visual', minElevationDeg, nowMs: scanStartForPass(best.peak) });
    return local({ ...out, summary, pngBase64 }, loc);
  }
  return local(out, loc);
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
  let stale = 0;
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
    // Stale at the start of the sweep leaves it out. (Judged at its end too,
    // a week-long sweep would drop every satellite a week after a refresh.)
    if (staleDuring(epochOf(record), hourMs, hourMs)) { stale++; continue; }
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
  const r = await coarseScan(sats, cell, hourMs, endMs, minElevationDeg - COARSE_MARGIN_DEG);
  if (r.unavailable.length) skipped["elements can't be propagated"] = (skipped["elements can't be propagated"] ?? 0) + r.unavailable.length;
  return { passes: r.passes, matched, swept: sats.length - r.unavailable.length, skipped, stale };
}

/** best_pass in radio mode with no satellite named: the best passes of any
 *  satellite with a known downlink, optionally only in some bands or modes.
 *  A coarse sweep of all of them (cached per 0.25 degree cell and hour) picks
 *  the candidates; the full engine scores those at the exact place and time. */
async function radioScanTool(input, deps, tier, loc) {
  const asked = windowIn(input, RADIO_SCAN_HOURS);
  const windowHours = Math.min(asked, RADIO_SCAN_MAX_HOURS);
  const minElevationDeg = minElevationIn(input);
  const limit = limitIn(input, 3, 20);
  const { bands, modes } = scanFilters(input);
  const startMs = deps.now();
  const endMs = startMs + windowHours * 3_600_000;
  const hourMs = hourOf(startMs);
  const cell = cellOf(loc.latDeg, loc.lonDeg);
  const stageArgs = {
    cell, hourMs, windowHours: stageWindowHours(windowHours), minElevationDeg: stageMinElevation(minElevationDeg), bands, modes, tier,
  };

  // Concurrent asks for the same key share one sweep (the cache holds the
  // promise); a failed sweep is not kept. The sweep's window and elevation
  // are rounded (radio-scan.mjs stageWindowHours) so near-identical asks
  // share it.
  const cache = deps.radioScanCache ?? null;
  const key = scanKey({ ...stageArgs, ...cell }) + `|${tier}`;
  let stage = cache?.get(key);
  if (!stage) {
    stage = coarseRadioStage(deps, stageArgs);
    cache?.set(key, stage);
    stage.catch(() => cache?.delete(key));
  }
  const coarse = await stage;

  const observer = { latDeg: loc.latDeg, lonDeg: loc.lonDeg };
  const windows = refineWindows(coarse.passes, startMs, endMs, limit);
  // Rank the candidates' exact passes on what the rows will say (rating,
  // then height, capture odds, length, time), then build full rows for the
  // winners only.
  const found = [];
  for (const [id, list] of windows) {
    const entry = resolveSatellite(id);
    const record = await deps.getRecord(id);
    if (!entry || !record) continue;
    for (const w of list) {
      const { track, obs, passes } = enginePasses({
        record, entry, standardMag: entry.standardMag, observer, minElevationDeg, mode: 'radio',
        startMs: w.startMs, windowHours: (w.endMs - w.startMs) / 3_600_000,
      });
      for (const p of passes) found.push({ entry, record, track, obs, p, key: rankKey(p, track, obs, 'radio', minElevationDeg) });
    }
  }
  found.sort((a, b) => byRadioRating(a.key, b.key));
  const sources = new Map();
  const rows = found.slice(0, Math.max(limit, 1)).map(({ entry, record, track, obs, p }) => {
    const downlinks = downlinkList({ downlinks: inBands(downlinksFor(entry, record), bands) });
    const row = {
      satellite: displayName(entry, record), shortName: entry.shortName, noradId: entry.noradId, url: satUrl(entry.noradId),
      ...passRow(p, track, obs, 'radio', minElevationDeg), downlinks,
      elementAge: elementAgeAt(epochOf(record), startMs),
      passUrl: passUrl(entry.noradId, loc, 'radio', minElevationDeg, p.startMs, p.endMs),
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
    satellitesScanned: coarse.swept,
    checkedInDetail: windows.size,
    skippedStaleElements: coarse.stale,
    skippedCounts: Object.keys(coarse.skipped).length ? coarse.skipped : undefined,
    best,
    passes: rows.slice(0, limit),
    ...(!best && {
      note: coarse.matched
        ? `None of the ${coarse.swept} satellites scanned rises above ${minElevationDeg}° here in the next ${windowHours} hours.`
        : 'No satellite with a known downlink matches those bands and modes.',
    }),
  };
  if (input.chart && best) {
    const { entry, record } = sources.get(best);
    const { pngBase64, summary } = await renderChart({ entry, record, loc, mode: 'radio', minElevationDeg, nowMs: scanStartForPass(best.peak) });
    return local({ ...out, summary, pngBase64 }, loc);
  }
  return local(out, loc);
}

/** Catalog search by name, alias or NORAD number, best match first. In radio
 *  mode satellites with known downlinks come first among equal matches. */
export async function searchSatellitesTool(input, deps) {
  const q = String(input?.query ?? '').trim();
  if (!q) throw new Error('a query is required');
  if (typeof deps.search !== 'function') throw new Error('search is unavailable');
  const limit = limitIn(input, 10, 20);
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
  const asked = timeIn(input);
  const read = asked == null ? null : readTime(asked, loc);
  assertNearEpoch(epochOf(record), read ? read.ms : nowMs, read ? 'time' : 'the time now');
  const passPeakMs = read ? read.ms : null;
  // From a few hours before the asked time, so the pass peaking nearest it
  // is found, past or future.
  const startMs = passPeakMs == null ? nowMs : passPeakMs - 6 * 3_600_000;
  const out = radioPass({
    record, entry,
    observer: loc,
    startMs,
    minElevationDeg: minElevationIn(input),
    frequencyHz: input.frequencyMHz ? Math.round(input.frequencyMHz * 1e6) : null,
    passPeakMs,
    windowHours: windowIn(input, 48),
  });
  // The pass (or day) it answers with must be near the epoch too.
  if (out.window?.end) assertNearEpoch(epochOf(record), Date.parse(out.window.end), 'that pass');
  return local({
    satellite: displayName(entry, record), noradId: entry.noradId, url: satUrl(entry.noradId), resolvedLocation: loc,
    ...(read && { interpretedAs: read.interpretedAs }),
    ...out, ...freshness(record, nowMs, read ? { atMs: read.ms, asked: true } : {}),
  }, loc);
}

const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/** Every satellite the catalog knows that this tier may see, ready to
 *  propagate (sky.mjs), leaving out those whose elements are stale at `ms`
 *  (over 14 days from it, freshness.mjs) and counting them. Premium
 *  satellites are left out for a free caller, as best_pass skips them. */
async function wholeSky(deps, tier, ms) {
  if (typeof deps.skyCatalog !== 'function') throw new Error('the satellite catalog is unavailable');
  const sats = [];
  let stale = 0;
  for (const s of prepareSky(await deps.skyCatalog())) {
    if (tier !== 'pro' && s.tier === 'premium') continue;
    if (staleAt(s.epochMs, ms)) { stale++; continue; }
    sats.push(s);
  }
  return { sats, stale };
}

/** The note for a whole-sky answer when stale elements were left out. */
function staleNote(stale, scanned) {
  if (!stale) return null;
  return scanned
    ? `${stale} satellites were left out because their orbital elements are more than 14 days from this time.`
    : `Every satellite was left out: their orbital elements are all more than 14 days from this time, so nothing can be placed in the sky then.`;
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
    elementAge: elementAgeAt(u.sat.epochMs, ms),
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
export async function whatsUpNowTool(input, deps, tier = 'free') {
  const loc = await resolveLocation(input, deps);
  const mode = input.mode ?? 'visual';
  const minElevationDeg = minElevationIn(input);
  const limit = limitIn(input, 10, 50);
  const ms = deps.now();
  const { sats, stale } = await wholeSky(deps, tier, ms);
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
    satellitesScanned: propagated,
    skippedStaleElements: stale,
    ...(staleNote(stale, propagated) && { staleNote: staleNote(stale, propagated) }),
  };
  if (mode === 'radio') {
    const heard = up.filter((u) => u.sat.downlinks.length > 0).sort((a, b) => b.elDeg - a.elDeg);
    return local({
      ...base,
      aboveCount: heard.length,
      satellites: heard.slice(0, limit).map((u) => skyRow(u, observer, ms, { radio: true })),
    }, loc);
  }
  if (!dark) {
    return local({
      ...base,
      aboveCount: 0,
      satellites: [],
      note: `The sky is not dark enough here: ${sunWords(sunAltDeg)}, and satellites only show once it is about ${-DARK_SUN_ALT_DEG}° below the horizon. Try mode "radio", or best_pass for tonight.`,
    }, loc);
  }
  const seen = [];
  for (const u of up) {
    const row = skyRow(u, observer, ms);
    if (row.sunlit && row.magnitude != null) seen.push(row);
  }
  seen.sort((a, b) => a.magnitude - b.magnitude);
  return local({ ...base, aboveCount: seen.length, satellites: seen.slice(0, limit), note: ESTIMATED_SKY_NOTE }, loc);
}

/** A sighting can be a satellite once the Sun is this far down: bright ones
 *  such as the ISS already show in civil twilight, a little before the -6
 *  degrees the pass search waits for. */
export const SIGHTING_SUN_ALT_DEG = -3;
/** Looks this far either side of the sighting give the direction of travel. */
const TRAVEL_DT_MS = 60_000;

const deg360 = (x) => ((x % 360) + 360) % 360;

/** "What was that moving light?": the satellites that were sunlit, above the
 *  horizon and near where it was seen, at that time, best match first. A
 *  match is scored on how far it was from the reported spot (as a share of
 *  the tolerance), how far its direction of travel was from the reported one
 *  (when given), and a little on brightness, so a known bright satellite wins
 *  a near tie over a faint guess. */
export async function identifySatelliteTool(input, deps, tier = 'free') {
  const loc = await resolveLocation(input, deps);
  const asked = timeIn(input);
  const read = asked == null ? null : readTime(asked, loc);
  const ms = read ? read.ms : deps.now();
  let azDeg = Number.isFinite(input.azimuth) ? input.azimuth : null;
  if (azDeg == null && input.direction != null) {
    azDeg = parseCompass(input.direction);
    if (azDeg == null) throw new Error(`unknown direction: ${input.direction} (use a compass word such as N, NE or SSW)`);
  }
  if (azDeg == null) throw new Error('say where it was seen: azimuth in degrees, or a direction such as "NE"');
  azDeg = deg360(azDeg);
  const elDeg = input.elevation;
  if (!Number.isFinite(elDeg) || elDeg < 0 || elDeg > 90) throw new Error('elevation is required: degrees above the horizon, 0 to 90');
  let travelDeg = null;
  if (input.travel != null) {
    travelDeg = parseCompass(input.travel);
    if (travelDeg == null) throw new Error(`unknown direction of travel: ${input.travel} (use a compass word such as N, NE or SSW)`);
  }
  const toleranceDeg = numberInput(input, ['tolerance'], { def: 10, min: 1, max: 45, unit: ' degrees' });
  const limit = limitIn(input, 5, 10);

  const { sats, stale } = await wholeSky(deps, tier, ms);
  const observer = { latDeg: loc.latDeg, lonDeg: loc.lonDeg };
  const { sunAltDeg } = skyDarkness(observer, ms);
  const skyDark = sunAltDeg <= SIGHTING_SUN_ALT_DEG;
  const base = {
    resolvedLocation: loc,
    time: iso(ms),
    ...(read && { interpretedAs: read.interpretedAs }),
    sighting: {
      azimuthDeg: r1(azDeg), direction: compass(azDeg), elevationDeg: elDeg,
      travel: travelDeg == null ? null : compass(travelDeg), toleranceDeg,
    },
    sunAltitudeDeg: r1(sunAltDeg),
    skyDark,
  };
  if (!skyDark) {
    return local({
      ...base, satellitesScanned: 0, skippedStaleElements: 0, candidates: [],
      note: `The sky was too bright to see a satellite by eye then: ${sunWords(sunAltDeg)}. Satellites show once it is about ${-SIGHTING_SUN_ALT_DEG}° below the horizon (the brightest) to ${-DARK_SUN_ALT_DEG}° (most).`,
    }, loc);
  }

  const { up, propagated } = skyAt(sats, observer, ms, Math.max(0, elDeg - toleranceDeg));
  const look = observerFrame(observer);
  const gmstBefore = satellite.gstime(new Date(ms - TRAVEL_DT_MS));
  const gmstAfter = satellite.gstime(new Date(ms + TRAVEL_DT_MS));
  const found = [];
  for (const u of up) {
    const errDeg = angularSeparationDeg(azDeg, elDeg, u.azDeg, u.elDeg);
    if (errDeg > toleranceDeg) continue;
    const b = brightnessAt(u.sat, observer, u.ecef, ms, u.elDeg);
    if (!b.sunlit || b.magnitude == null) continue;
    const before = ecefAt(u.sat, ms - TRAVEL_DT_MS, gmstBefore);
    const after = ecefAt(u.sat, ms + TRAVEL_DT_MS, gmstAfter);
    const heading = before && after ? travelBearingDeg(look(before), look(after)) : null;
    const travelErrDeg = travelDeg == null || heading == null ? null : bearingDiffDeg(heading, travelDeg);
    const score = errDeg / toleranceDeg
      + (travelErrDeg == null ? 0 : travelErrDeg / 45)
      + 0.1 * Math.min(4, Math.max(0, b.magnitude - 3));
    found.push({
      score,
      row: {
        noradId: u.sat.noradId,
        name: u.sat.name,
        url: satUrl(u.sat.noradId),
        azimuthDeg: r1(u.azDeg),
        direction: compass(u.azDeg),
        elevationDeg: r1(u.elDeg),
        angularErrorDeg: r1(errDeg),
        travel: heading == null ? null : compass(heading),
        travelBearingDeg: heading == null ? null : Math.round(heading),
        travelErrorDeg: travelErrDeg == null ? null : Math.round(travelErrDeg),
        rangeKm: Math.round(u.rangeM / 1000),
        magnitude: r1(b.magnitude),
        magnitudeEstimated: b.magnitudeEstimated,
        elementAge: elementAgeAt(u.sat.epochMs, ms, { asked: read != null }),
      },
    });
  }
  found.sort((a, b) => a.score - b.score);
  return local({
    ...base,
    satellitesScanned: propagated,
    skippedStaleElements: stale,
    ...(staleNote(stale, propagated) && { staleNote: staleNote(stale, propagated) }),
    candidates: found.slice(0, limit).map((f) => f.row),
    note: found.length
      ? 'Best match first: sunlit satellites within the tolerance of where it was seen, ranked by how close they were, how well their direction of travel matches, and brightness. Most magnitudes are estimates (magnitudeEstimated). A steady light moving smoothly and silently fits a satellite; blinking or coloured lights mean a plane.'
      : `No sunlit satellite was within ${toleranceDeg}° of that spot then. Check the time and direction, or widen the tolerance; a blinking or coloured light is a plane.`,
  }, loc);
}
