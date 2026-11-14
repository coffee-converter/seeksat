// lib/mcp/tool-specs.mjs - every MCP tool's name, title, summary,
// description and zod input schema, in one place. The route registers tools
// from this list, and the docs (/mcp, /llms.txt) print their parameters from
// the same schemas, so the two cannot drift.

import { z } from 'zod';
import { BAND_IDS } from '../radio/bands.mjs';
import { RADIO_WORDS } from '../radio/modes.mjs';

/** Largest inputs, shared by the schemas and the handlers' own checks. */
export const MAX_WINDOW_HOURS = 240;

/** How every time input is read. */
export const TIME_IN = 'ISO 8601 with Z or an offset, e.g. "2026-11-14T21:00:00-06:00"; a time with no offset, e.g. "2026-11-14T21:00", is read in the observer\'s time zone, and the result echoes how it was read (interpretedAs).';

const SAT_ID = z.union([z.string().min(1), z.number().int().positive()]);
const satellite = (extra = '', optional = false) => (optional ? SAT_ID.optional() : SAT_ID)
  .describe(`NORAD catalog number (as a number or a string) or a name, e.g. 25544, "25544" or "iss".${extra}`);
const lat = () => z.number().min(-90, 'lat is -90 to 90').max(90, 'lat is -90 to 90').optional()
  .describe('observer latitude in decimal degrees, north positive (-90 to 90). Give it with lon, or give location instead.');
const lon = () => z.number().min(-180, 'lon is -180 to 180').max(180, 'lon is -180 to 180').optional()
  .describe('observer longitude in decimal degrees, east positive and west negative (-180 to 180).');
const location = (extra = '') => z.string().max(200, 'location can be at most 200 characters').optional()
  .describe(`where the observer is, when lat and lon are not given (they win when both are): a Maidenhead grid square (EN52, EN52ve, EN52ve12), coordinates in any common form ("41.88, -87.63", "41.88N 87.63W", "41°52'48\"N 87°37'48\"W", a Google Maps link or geo: URI), all read locally, or a place name (city, address, landmark) looked up with OpenStreetMap. Prefer lat and lon, or a grid square, when you have them: a place name is a network lookup.${extra}`);
const windowHours = (def, extra = '') => z.number().positive().max(MAX_WINDOW_HOURS, `windowHours can be at most ${MAX_WINDOW_HOURS} (10 days)`).optional()
  .describe(`how far ahead to look, in hours, up to ${MAX_WINDOW_HOURS} (10 days). Default ${def}.${extra}`);
const minElevation = (what = 'lowest peak elevation that counts as a pass') => z.number().min(0, 'minElevation is 0 to 90 degrees').max(90, 'minElevation is 0 to 90 degrees').optional()
  .describe(`${what}, in degrees above the horizon (0 to 90). Default 10.`);
const mode = (visual, radio) => z.enum(['visual', 'radio']).optional()
  .describe(`"visual" (default): ${visual}; "radio": ${radio}.`);
const PASS_MODE = ['naked-eye passes, sunlit while the sky is dark', 'every line-of-sight pass, day or night'];
const limit = (max, def, what) => z.number().int().positive().max(max, `limit can be at most ${max}`).optional()
  .describe(`how many ${what} to return, 1 to ${max}. Default ${def}.`);
const time = (what) => z.string().optional().describe(`${what} ${TIME_IN}`);
const chart = (what) => z.boolean().optional()
  .describe(`true to also render ${what} polar sky chart (PNG) and return it in this same result. Default false.`);

const PASS_ROWS = 'Each pass has rise/peak/set times (UTC, plus riseLocal etc. on the observer\'s clock), peak elevation, azimuths with compass words (direction), the range at the peak (peakRangeKm), duration, brightness (magnitude, lower is brighter; peakMagnitudeEstimated means the satellite\'s size is unknown, so it is a cautious guess and visual quality stops at Fair, 0.4), a quality score 0-1, and when it can be seen by eye: visibleFrom/visibleUntil (null if never on that pass) plus leavesShadow/entersShadow when it appears or fades mid-sky. In visual mode rise and set are the part of the pass that can be seen, so they can start or end mid-sky. passUrl opens that pass on seeksat.com, from that place, to hand to the user.';

export const TOOL_SPECS = /** @type {Array<{ name: string, title: string, summary: string, description: string, online: boolean, inputSchema: Record<string, import('zod').ZodType> }>} */ ([
  {
    name: 'list_satellites',
    title: 'Popular satellites',
    summary: 'The popular satellites (ISS, Tiangong, Hubble and a few more) with each one\'s orbit data freshness.',
    description: 'List the popular satellites (ISS, Tiangong, Hubble and a few others) with each one\'s orbit data freshness. This is not the full list: every other tool also accepts any NORAD catalog number, e.g. 25544.',
    online: false,
    inputSchema: {},
  },
  {
    name: 'find_passes',
    title: 'Find passes',
    summary: 'Every upcoming pass of one satellite over a place, in time order: times (UTC and local), height, direction, brightness, quality, and when it can be seen by eye.',
    description: `List every upcoming pass of one satellite over a location in the next windowHours (default 48, up to 240), in time order. ${PASS_ROWS} This is the tool for comparing passes or finding the best or brightest one over a span of days, not just the next. An empty list comes with a note saying why (it never rises high enough from that latitude, the sky never gets dark, and so on). Feed a pass's peak time to get_pass_chart (to draw it) or get_pass_weather (to check clouds). To rank passes across many satellites at once, use best_pass.`,
    online: true,
    inputSchema: {
      satellite: satellite(),
      lat: lat(),
      lon: lon(),
      location: location(),
      windowHours: windowHours(48),
      minElevation: minElevation(),
      mode: mode(...PASS_MODE),
    },
  },
  {
    name: 'get_position',
    title: 'Satellite position',
    summary: 'Where a satellite is now or at a given time: the point below it, altitude, and whether it is sunlit.',
    description: 'Where a satellite is now, or at a given time: the point on Earth straight below it (latDeg, lonDeg, not where it is in your sky), its altitude, and whether it is sunlit, with url (its page on seeksat.com). A location is optional: it only sets the time zone for local times and for reading a time with no offset (UTC without one). A time more than 30 days from the orbital elements\' epoch is refused.',
    online: true,
    inputSchema: {
      satellite: satellite(),
      time: time('when. Default: now.'),
      lat: lat(),
      lon: lon(),
      location: location(' Optional here.'),
    },
  },
  {
    name: 'next_visible_pass',
    title: 'Next visible pass',
    summary: 'One call for "when can I next see it from here?", optionally with its sky chart.',
    description: 'Convenience shortcut: the next pass of one satellite from a location (looks windowHours ahead, default 72). Use this only when the user wants "the next pass". Set chart:true to also render that pass\'s sky chart in this same call. To compare upcoming passes, or find the best one over several days, use find_passes (one satellite) or best_pass (many) instead. When there is no pass, a note says why.',
    online: true,
    inputSchema: {
      satellite: satellite(),
      lat: lat(),
      lon: lon(),
      location: location(),
      mode: mode(...PASS_MODE),
      windowHours: windowHours(72),
      minElevation: minElevation(),
      chart: chart('that pass\'s'),
    },
  },
  {
    name: 'get_pass_weather',
    title: 'Pass weather',
    summary: 'Cloud-cover forecast and viewing probability for a place and time, or available:false with the reason.',
    description: 'Cloud-cover forecast (Open-Meteo and MET Norway) and the chance of a clear view for a location at one time, such as a pass\'s peak. The forecast reaches about 7 to 16 days ahead. viewingProbability is the clear-sky chance (0-1), blended toward 0.5 the further ahead the time is, since forecasts lose skill. When there is no forecast for that time (in the past, beyond the forecast, a time it cannot read, or the forecast could not be fetched) the result is available:false with a reason, never a stand-in number.',
    online: true,
    inputSchema: {
      lat: lat(),
      lon: lon(),
      location: location(),
      time: z.string().describe(`the time to check, e.g. a pass's peak. ${TIME_IN}`),
    },
  },
  {
    name: 'get_pass_chart',
    title: 'Pass sky chart',
    summary: 'A rendered polar sky chart (PNG) of a pass, the next one or the one at a given time: where to look, with the moon, planets and stars in place.',
    description: 'Render a polar sky chart (PNG) of a satellite\'s pass over a location: where to look, with the moon, planets and stars in their real positions. Returns JSON (the charted pass\'s times and a one-line summary) and the image. By default it charts the next pass; give `time` (the rise or peak of a pass from find_passes or best_pass) to chart that pass instead. Use the same minElevation as the pass came from. A time more than 30 days from the orbital elements\' epoch is refused.',
    online: true,
    inputSchema: {
      satellite: satellite(),
      lat: lat(),
      lon: lon(),
      location: location(),
      time: time('charts the pass around this time (a pass\'s rise or peak from find_passes or best_pass). Default: the next pass from now.'),
      mode: mode(...PASS_MODE),
      minElevation: minElevation(),
      windowHours: windowHours(72, ' Only used to find the next pass when no time is given.'),
    },
  },
  {
    name: 'search_satellites',
    title: 'Search satellites',
    summary: 'Find any satellite in the catalog (about 15,000) by name, alias or NORAD number.',
    description: 'Search the full satellite catalog (about 15,000 objects) by name, alias or NORAD number, best match first. Use it to turn a name like "SDO" or "NOAA 19" into a NORAD number for the other tools; names outside the popular list only resolve directly on an exact whole-name match.',
    online: false,
    inputSchema: {
      query: z.string().min(1, 'query is required').describe('a name, part of one, or a NORAD number, e.g. "sdo", "noaa 19", "25544".'),
      limit: limit(20, 10, 'results'),
      mode: mode('best name match first', 'satellites with known radio downlinks first among equally good matches; a downlink kind such as "sstv" lists satellites with one'),
    },
  },
  {
    name: 'get_radio_pass',
    title: 'Radio pass details',
    summary: 'Known frequencies, Doppler swing, when to tune where and where to point, for one pass (or 24 hours for a satellite that never sets).',
    description: 'Radio details for one pass of a satellite over a location: its known downlink (and uplink) frequencies, the Doppler swing, when to tune to what frequency (at 10 and 30 degrees up and closest approach), and a table (at most 40 evenly spaced rows) of time, azimuth, elevation, range and receive frequency for pointing an antenna and tuning a radio. Uses the next pass above minElevation, or the one peaking nearest `time` (past or future, within 30 days of the orbital elements\' epoch). A satellite that never sets here (geosynchronous) gets the next 24 hours instead. Give frequencyMHz to use a frequency other than the default downlink. Predictions from published elements: the transmitter\'s own frequency offset is unknown, so the curve\'s shape is what to compare.',
    online: true,
    inputSchema: {
      satellite: satellite(' e.g. "so-50" or 27607.'),
      lat: lat(),
      lon: lon(),
      location: location(),
      frequencyMHz: z.number().positive().max(300000, 'frequencyMHz can be at most 300000').optional().describe('the downlink to compute Doppler for, in MHz. Default: the satellite\'s default known downlink.'),
      time: time('a time near the wanted pass\'s peak (e.g. from find_passes), past or future. Default: the next pass.'),
      passTime: z.string().optional().describe('old name for time; still accepted.'),
      minElevation: minElevation(),
      minElevationDeg: z.number().min(0).max(90).optional().describe('old name for minElevation; still accepted.'),
      windowHours: windowHours(48, ' How far past the start to look for a pass.'),
    },
  },
  {
    name: 'best_pass',
    title: 'Best pass',
    summary: 'The best upcoming pass over a place, for one satellite or from a scan: visual mode scans the popular satellites plus CelesTrak\'s visual group (the brightest objects) with the cloud forecast folded in; radio mode scans every satellite with known downlinks, optionally by band or mode.',
    description: `Find the best upcoming pass(es) over a location, ranked by quality ("what's the best pass tonight?"). Give \`satellite\` to rank that one satellite's passes. Omit it to scan: in visual mode (default) the popular satellites plus every satellite in CelesTrak's visual group (the brightest objects in the sky, a few hundred, many of them spent rocket bodies), over 72 hours by default (168 at most); in radio mode every satellite with known downlinks (several hundred), optionally only those with a downlink in \`bands\` or of a kind in \`modes\`, over 24 hours by default (72 at most). A scan reports satellitesScanned, leaves out satellites whose orbital elements are more than 14 days old (skippedStaleElements), counts what else it skipped, and radio passes list the satellite's downlinks. Returns \`best\` (the top pass) plus a \`passes\` array of the top-ranked options, each tagged with its satellite. ${PASS_ROWS} Visual quality (0-1) folds in peak height, sky darkness, how long it can be seen, and the cloud forecast for the location where the forecast reaches (cloudCoverPct at the peak; \`weather\` says whether a forecast was used); without one, clouds count as a neutral 0.5. A pass whose brightness is only estimated is capped at Fair (0.4) and never outranks a known bright one on a tie. Radio quality is peak height and pass length only. An empty result comes with a note saying why. Set chart:true to also render the winning pass's sky chart in this same call.`,
    online: true,
    inputSchema: {
      satellite: satellite(' Omit to scan: visual mode scans the popular satellites plus CelesTrak\'s visual group, radio mode every satellite with known downlinks.', true),
      lat: lat(),
      lon: lon(),
      location: location(),
      windowHours: windowHours(72, ' With no satellite named, a visual scan stops at 168, and a radio scan defaults to 24 and stops at 72.'),
      minElevation: minElevation(),
      limit: limit(20, 3, 'ranked passes'),
      mode: mode(...PASS_MODE),
      bands: z.array(z.enum(/** @type {[string, ...string[]]} */ ([...BAND_IDS]))).optional()
        .describe('radio scan only: keep satellites with a downlink in these bands: hf (3-30 MHz), wx (137 MHz weather), 2m (144-148 MHz), 70cm (420-450 MHz), l (1-2 GHz), s (2-4 GHz), other. Default: any band.'),
      modes: z.array(z.enum(/** @type {[string, ...string[]]} */ ([...RADIO_WORDS]))).optional()
        .describe('radio scan only: keep satellites with a downlink of one of these kinds, matched on its mode or label, e.g. ["fm", "apt", "sstv"]. Default: any.'),
      chart: chart('the winning pass\'s'),
    },
  },
  {
    name: 'whats_up_now',
    title: 'Satellites up now',
    summary: 'What is in the sky over a place right now, from the whole catalog: brightest in a dark sky, or radio satellites highest first.',
    description: 'What is in the sky over a location right now, from every satellite in the catalog (about 15,000, active satellites plus CelesTrak\'s visual group; most debris is not in it). mode "visual" (default) lists sunlit satellites above minElevation while the sky is dark there (Sun more than about 6 degrees down), brightest first; most have no published brightness, so their magnitude is an estimate (magnitudeEstimated). mode "radio" lists satellites with known downlinks above minElevation, highest first, with their downlinks. Each has azimuth with a compass word, elevation, range, sunlit, magnitude and a url to its page. Satellites whose orbital elements are more than 14 days from now are left out and counted (skippedStaleElements). For upcoming passes rather than this moment, use best_pass or find_passes.',
    online: true,
    inputSchema: {
      lat: lat(),
      lon: lon(),
      location: location(),
      mode: mode('sunlit satellites in a dark sky, brightest first', 'satellites with known downlinks, highest first, day or night'),
      minElevation: minElevation('lowest elevation to list'),
      limit: limit(50, 10, 'satellites'),
    },
  },
  {
    name: 'identify_satellite',
    title: 'Identify a satellite',
    summary: '"What was that moving light?" The satellites that were sunlit near where and when it was seen, best match first.',
    description: '"What was that moving light?" Given where and when a light was seen, lists the satellites that were sunlit, above the horizon and within `tolerance` degrees of that spot, best match first, from every satellite in the catalog (active satellites plus CelesTrak\'s visual group). Needs the Sun at least about 3 degrees below the horizon. Say where it was with azimuth (degrees from north) or direction (a compass word such as "NE"), plus elevation (degrees above the horizon); add travel (the compass direction it was moving towards) to rank by direction of travel too. Each candidate has its azimuth, elevation, angular error, direction of travel, magnitude (often estimated, see magnitudeEstimated), name and a url to its page. Satellites whose orbital elements are more than 14 days from the sighting time are left out and counted (skippedStaleElements).',
    online: true,
    inputSchema: {
      lat: lat(),
      lon: lon(),
      location: location(),
      time: time('time of the sighting. Default: now.'),
      azimuth: z.number().min(0, 'azimuth is 0 to 360 degrees').max(360, 'azimuth is 0 to 360 degrees').optional().describe('where it was, in degrees from north (90 = east), 0 to 360. Give this or direction.'),
      direction: z.string().optional().describe('where it was, as a compass word: N, NNE, NE, ... or "north-east".'),
      elevation: z.number().min(0, 'elevation is 0 to 90 degrees').max(90, 'elevation is 0 to 90 degrees').describe('how high it was, in degrees above the horizon (0 to 90, 90 = straight up). Required.'),
      travel: z.string().optional().describe('the compass direction it was moving towards, e.g. "NE". Optional, but it sharpens the match.'),
      tolerance: z.number().min(1, 'tolerance is 1 to 45 degrees').max(45, 'tolerance is 1 to 45 degrees').optional().describe('how far off the reported spot a match may be, in degrees, 1 to 45. Default 10.'),
      limit: limit(10, 5, 'candidates'),
    },
  },
]);

/** The spec for one tool, by name. */
export function toolSpec(name) {
  const spec = TOOL_SPECS.find((t) => t.name === name);
  if (!spec) throw new Error(`no such tool: ${name}`);
  return spec;
}
