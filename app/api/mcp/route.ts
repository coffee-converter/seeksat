// app/api/mcp/route.ts - Streamable-HTTP MCP server. Thin adapter:
// validates input with zod, delegates to the pure handlers in
// lib/mcp/tools.mjs, returns the result as JSON text content.
import { createMcpHandler } from 'mcp-handler';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  listSatellites, findPassesTool, getPositionTool, nextVisiblePassTool, getPassWeatherTool, getPassChartTool, bestPassTool,
  searchSatellitesTool, radioPassTool, whatsUpNowTool, identifySatelliteTool,
} from '@/lib/mcp/tools.mjs';
import { getCatalogReader } from '@/lib/mirror/server.mjs';
import { geocodeOne } from '@/lib/pass-finder/geocode.js';
import { fetchCloudForecast } from '@/lib/pass-finder/weather.js';
import { parseProKeys, resolveTier } from '@/lib/mcp/auth.mjs';
import { runWithRequestContext, getRequestContext } from '@/lib/mcp/request-context.mjs';
import { logUsage } from '@/lib/mcp/usage.mjs';
import { createLru } from '@/lib/mcp/radio-scan.mjs';
import { BAND_IDS } from '@/lib/radio/bands.mjs';
import { RADIO_WORDS } from '@/lib/radio/modes.mjs';

const PRO_KEYS = parseProKeys(process.env.MCP_PRO_KEYS);

function presentedKey(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return req.headers.get('x-api-key');
}

export const runtime = 'nodejs';

const deps = {
  getRecord: (id: number) => getCatalogReader().getRecord(id),
  geocode: (q: string, opts?: object) => geocodeOne(q, opts),
  fetchWeather: (lat: number, lon: number) => fetchCloudForecast(lat, lon),
  now: () => Date.now(),
  search: (q: string, limit: number, opts?: { radio?: boolean }) => getCatalogReader().search(q, limit, opts),
  radioIds: () => getCatalogReader().radioIds(),
  // Stage 1 of the all-satellite radio scan, per 0.25 degree cell and hour
  // (lib/mcp/radio-scan.mjs). Lives as long as the server instance.
  radioScanCache: createLru(32),
  // The visual best_pass scan: the popular satellites plus CelesTrak's
  // visual group, with its own stage 1 cache (lib/mcp/visual-scan.mjs).
  visualIds: () => getCatalogReader().visualIds(),
  visualScanCache: createLru(32),
  skyCatalog: () => getCatalogReader().skyCatalog(),
};

const asText = (obj: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }],
});
const asError = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

// Like asText, but when a handler embedded a rendered chart (`pngBase64`),
// split it into a trailing image content block - JSON data first, image LAST -
// so the chart returns in the same single tool call and gets the best shot at
// rendering inline.
const asResult = (res: unknown) => {
  if (res && typeof res === 'object' && 'pngBase64' in res && (res as { pngBase64?: unknown }).pngBase64) {
    const { pngBase64, ...rest } = res as { pngBase64: string };
    return { content: [
      { type: 'text' as const, text: JSON.stringify(rest, null, 2) },
      { type: 'image' as const, data: pngBase64, mimeType: 'image/png' },
    ] };
  }
  return asText(res);
};

// Tool hints (MCP ToolAnnotations): every tool only reads, and asking twice
// changes nothing. Tools that can geocode a place name, fetch weather or look
// up a time zone reach services outside SeekSat, so they are open-world.
// How every time input is read, and how results give times.
const TIME_IN = 'ISO 8601 with Z or an offset, e.g. "2026-11-14T21:00:00-06:00"; a time with no offset, e.g. "2026-11-14T21:00", is read in the observer\'s time zone, and the result echoes how it was read (interpretedAs).';

const LOCAL = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ONLINE = { ...LOCAL, openWorldHint: true };

const mcpHandler = createMcpHandler(
  (server: McpServer) => {
    server.registerTool(
      'list_satellites',
      {
        title: 'Popular satellites',
        description: 'List the popular satellites (ISS, Tiangong, Hubble and a few others) with each one\'s current orbit data freshness. This is not the full list: every other tool also accepts any NORAD catalog number, e.g. "25544".',
        inputSchema: {},
        annotations: LOCAL,
      },
      async () => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'list_satellites', tier, keyId });
        try { return asText(await listSatellites(deps)); } catch (e) { return asError(e); }
      },
    );

    server.registerTool(
      'find_passes',
      {
        title: 'Find passes',
        description: 'List ALL upcoming passes of one satellite over a location, ranked by a quality score. Returns an array of passes, each with rise/peak/set times, peak elevation (deg), brightness (magnitude - lower/more-negative is brighter; peakMagnitudeEstimated true means the satellite\'s size is unknown, so the magnitude is a cautious guess and visual quality stops at Fair, 0.4), duration, a quality score 0-1, and when it can be seen by eye: visibleFrom/visibleUntil (null if never on that pass) plus leavesShadow/entersShadow when it appears or fades mid-sky at the edge of Earth\'s shadow (sunlit is only the state at the peak). Scans windowHours ahead (default 48, up to 240 = 10 days), so this is the tool for comparing passes or finding the best/brightest one over a span of days - not just the next one. mode "visual" returns only sunlit, after-dark (naked-eye) passes; "radio" returns all line-of-sight passes. Provide lat+lon or a location string. Feed any pass\'s peak time to get_pass_chart (to draw it) or get_pass_weather (to check clouds). To rank passes across many satellites at once, use best_pass.',
        inputSchema: {
          satellite: z.string().describe('NORAD id or name, e.g. "iss" or 25544'),
          lat: z.number().min(-90).max(90).optional(),
          lon: z.number().min(-180).max(180).optional(),
          location: z.string().optional().describe('place name, geocoded if lat/lon omitted'),
          windowHours: z.number().positive().max(240).optional().describe('how far ahead to search, in hours. Default 48; max 240 (10 days). Widen this to find the best pass over the coming days.'),
          minElevation: z.number().min(0).max(90).optional().describe('only return passes whose peak rises at least this many degrees above the horizon. Default 10.'),
          mode: z.enum(['visual', 'radio']).optional().describe('"visual" (default) = naked-eye, sunlit, after-dark passes; "radio" = all line-of-sight passes regardless of light.'),
        },
        annotations: ONLINE,
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'find_passes', tier, keyId, satellite: args.satellite });
        try { return asText(await findPassesTool(args, deps, tier)); } catch (e) { return asError(e); }
      },
    );

    server.registerTool(
      'get_position',
      {
        title: 'Satellite position',
        description: 'Get the current (or at a given time) sub-point latitude/longitude, altitude, and sunlit state of a satellite, with url (its page on seeksat.com). A location is optional: it only sets the time zone for local times and for reading a time with no offset (UTC without one).',
        inputSchema: {
          satellite: z.string(),
          time: z.string().optional().describe(`when, default now. ${TIME_IN}`),
          lat: z.number().min(-90).max(90).optional(),
          lon: z.number().min(-180).max(180).optional(),
          location: z.string().optional().describe('place name, geocoded if lat/lon omitted; optional'),
        },
        annotations: ONLINE,
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'get_position', tier, keyId, satellite: args.satellite });
        try { return asText(await getPositionTool(args, deps, tier)); } catch (e) { return asError(e); }
      },
    );

    server.registerTool(
      'next_visible_pass',
      {
        title: 'Next visible pass',
        description: 'Convenience shortcut: the single next good visible pass of one satellite from a location. Use this only when the user wants "the next pass." Set chart:true to also render that pass\'s sky chart and return it in this same call (so the user sees the chart without a separate get_pass_chart step). To compare multiple upcoming passes, or to find the best/brightest pass over the next several days, use find_passes (one satellite) or best_pass (ranked across all tracked satellites) instead.',
        inputSchema: {
          satellite: z.string(),
          lat: z.number().min(-90).max(90).optional(),
          lon: z.number().min(-180).max(180).optional(),
          location: z.string().optional(),
          mode: z.enum(['visual', 'radio']).optional(),
          chart: z.boolean().optional().describe('When true, also render the pass\'s polar sky chart (PNG) and include it in this result - use whenever the user wants to see or visualise the pass.'),
        },
        annotations: ONLINE,
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'next_visible_pass', tier, keyId, satellite: args.satellite });
        try { return asResult(await nextVisiblePassTool(args, deps, tier)); } catch (e) { return asError(e); }
      },
    );

    server.registerTool(
      'get_pass_weather',
      {
        title: 'Pass weather',
        description: 'Cloud-cover forecast and viewing probability for a location at a given time. Network-dependent.',
        inputSchema: {
          lat: z.number().min(-90).max(90).optional(),
          lon: z.number().min(-180).max(180).optional(),
          location: z.string().optional(),
          time: z.string().describe(`time of the pass. ${TIME_IN}`),
        },
        annotations: ONLINE,
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'get_pass_weather', tier, keyId });
        try { return asText(await getPassWeatherTool(args, deps)); } catch (e) { return asError(e); }
      },
    );

    server.registerTool(
      'get_pass_chart',
      {
        title: 'Pass sky chart',
        description: 'Render a polar sky chart (PNG) of a satellite\'s pass over a location - where to look, with the moon, planets, and stars in their real positions. By default it charts the NEXT pass; pass `time` (the rise or peak of a specific pass from find_passes / best_pass) to chart THAT pass instead - this is how you visualise the best pass rather than just the next one. mode "visual" (default) or "radio".',
        inputSchema: {
          satellite: z.string().describe('NORAD id or name, e.g. "iss" or 25544'),
          lat: z.number().min(-90).max(90).optional(),
          lon: z.number().min(-180).max(180).optional(),
          location: z.string().optional().describe('place name, geocoded if lat/lon omitted'),
          time: z.string().optional().describe(`charts the pass occurring around this time (use a pass's rise or peak from find_passes/best_pass). Omit to chart the next pass from now. ${TIME_IN}`),
          mode: z.enum(['visual', 'radio']).optional(),
        },
        annotations: ONLINE,
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'get_pass_chart', tier, keyId, satellite: args.satellite });
        // JSON (with the summary) first and the image LAST, so it is the
        // trailing content block: clients that render the final block inline
        // are more likely to surface the chart in the response.
        try { return asResult(await getPassChartTool(args, deps, tier)); } catch (e) { return asError(e); }
      },
    );

    server.registerTool(
      'search_satellites',
      {
        title: 'Search satellites',
        description: 'Search the full satellite catalog (about 15,000 objects) by name, alias or NORAD number, best match first. Use it to turn a name like "SDO" or "NOAA 19" into a NORAD number for the other tools; names outside the popular list only resolve directly on an exact whole-name match. mode "radio" lists satellites with known radio downlinks first among equally good matches.',
        inputSchema: {
          query: z.string().min(1).describe('a name, part of one, or a NORAD number, e.g. "sdo", "noaa 19", "25544"'),
          limit: z.number().int().positive().max(20).optional().describe('how many results. Default 10.'),
          mode: z.enum(['visual', 'radio']).optional(),
        },
        annotations: LOCAL,
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'search_satellites', tier, keyId });
        try { return asText(await searchSatellitesTool(args, deps)); } catch (e) { return asError(e); }
      },
    );

    server.registerTool(
      'get_radio_pass',
      {
        title: 'Radio pass details',
        description: 'Radio details for one pass of a satellite over a location: its known downlink (and uplink) frequencies, the Doppler swing, when to tune to what frequency (at 10 and 30 degrees up and closest approach), and a table of time, azimuth, elevation, range and receive frequency for pointing an antenna and tuning a radio. Uses the next pass above minElevationDeg, or the one peaking nearest passTime. A satellite that never sets here (geosynchronous) gets the next 24 hours instead. Give frequencyMHz to use a frequency other than the default downlink. Predictions from published elements: the transmitter\'s own frequency offset is unknown, so the curve\'s shape is what to compare.',
        inputSchema: {
          satellite: z.string().describe('NORAD id or name, e.g. "iss", "so-50" or 36395'),
          lat: z.number().min(-90).max(90).optional(),
          lon: z.number().min(-180).max(180).optional(),
          location: z.string().optional().describe('place name, geocoded if lat/lon omitted'),
          frequencyMHz: z.number().positive().max(300000).optional().describe('downlink to compute Doppler for, in MHz. Default: the satellite\'s default known downlink.'),
          passTime: z.string().optional().describe(`a time near the wanted pass's peak (e.g. from find_passes), past or future. Default: the next pass. ${TIME_IN}`),
          minElevationDeg: z.number().min(0).max(90).optional().describe('lowest peak elevation that counts as a pass. Default 10.'),
          windowHours: z.number().positive().max(240).optional().describe('how far ahead to look for a pass, in hours. Default 48.'),
        },
        annotations: ONLINE,
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'get_radio_pass', tier, keyId, satellite: args.satellite });
        try { return asText(await radioPassTool(args, deps, tier)); } catch (e) { return asError(e); }
      },
    );

    server.registerTool(
      'best_pass',
      {
        title: 'Best pass',
        description: 'Find the best upcoming pass(es) over a location, ranked by quality ("what\'s the best pass tonight?"). Give `satellite` to rank that one satellite\'s passes. Omit it to scan: in visual mode (default) the popular satellites plus every satellite in CelesTrak\'s visual group (the brightest objects in the sky, a few hundred, many of them spent rocket bodies), over 72 hours by default (168 at most); in radio mode every satellite with known downlinks (several hundred), optionally only those with a downlink in `bands` or of a kind in `modes`, over 24 hours by default (72 at most). A scan reports satellitesScanned and counts what it skipped, and radio passes list the satellite\'s downlinks. Returns `best` (the top pass) plus a `passes` array of the top-ranked options, each tagged with its satellite, times, peak elevation, brightness, and quality score. Visual quality (0-1) folds in peak height, sky darkness, how long it can be seen, and the cloud forecast for the location where the forecast reaches (cloudCoverPct at the peak; `weather` says whether a forecast was used); without one, clouds count as a neutral 0.5. A pass whose brightness is only estimated (peakMagnitudeEstimated) is capped at Fair (0.4) and never outranks a known bright one on a tie. Radio quality is peak height and pass length only. Set chart:true to also render the winning pass\'s sky chart and return it in this same call - prefer this over a separate get_pass_chart step when the user wants to see the best pass.',
        inputSchema: {
          satellite: z.string().optional().describe('NORAD id or name (e.g. "iss") to rank one satellite. Omit to scan: visual mode scans the popular satellites plus CelesTrak\'s visual group, radio mode every satellite with known downlinks.'),
          lat: z.number().min(-90).max(90).optional(),
          lon: z.number().min(-180).max(180).optional(),
          location: z.string().optional().describe('place name, geocoded if lat/lon omitted'),
          windowHours: z.number().positive().max(240).optional().describe('how far ahead to search, in hours. Default 72; max 240 (10 days). With no satellite named, a visual scan stops at 168, and a radio scan defaults to 24 and stops at 72.'),
          minElevation: z.number().min(0).max(90).optional().describe('ignore passes peaking below this many degrees. Default 10.'),
          limit: z.number().int().positive().max(20).optional().describe('how many ranked passes to return. Default 3.'),
          mode: z.enum(['visual', 'radio']).optional().describe('"visual" (default) = naked-eye sunlit passes after dark; "radio" = all line-of-sight passes.'),
          bands: z.array(z.enum(BAND_IDS as unknown as [string, ...string[]])).optional().describe('radio scan only: keep satellites with a downlink in these bands, e.g. ["2m", "70cm"]. Default: any band.'),
          modes: z.array(z.enum(RADIO_WORDS as unknown as [string, ...string[]])).optional().describe('radio scan only: keep satellites with a downlink of one of these kinds, matched on its mode or label, e.g. ["fm", "apt", "sstv"]. Default: any.'),
          chart: z.boolean().optional().describe('When true, also render the winning pass\'s polar sky chart (PNG) and include it in this result - use whenever the user wants to see or visualise the best pass.'),
        },
        annotations: ONLINE,
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'best_pass', tier, keyId, satellite: args.satellite });
        try { return asResult(await bestPassTool(args, deps, tier)); } catch (e) { return asError(e); }
      },
    );

    server.registerTool(
      'whats_up_now',
      {
        title: 'Satellites up now',
        description: 'What is in the sky over a location right now, from every satellite in the catalog (about 15,000). mode "visual" (default) lists sunlit satellites above minElevation while the sky is dark there (Sun below about -6 degrees), brightest first; most have no published brightness, so their magnitude is an estimate (magnitudeEstimated). mode "radio" lists satellites with known downlinks above minElevation, highest first, with their downlinks. Each has azimuth, elevation, range, sunlit, magnitude and a url to its page. For upcoming passes rather than this moment, use best_pass or find_passes.',
        inputSchema: {
          lat: z.number().min(-90).max(90).optional(),
          lon: z.number().min(-180).max(180).optional(),
          location: z.string().optional().describe('place name, geocoded if lat/lon omitted'),
          mode: z.enum(['visual', 'radio']).optional().describe('"visual" (default) = sunlit satellites in a dark sky, brightest first; "radio" = satellites with known downlinks, highest first.'),
          minElevation: z.number().min(0).max(90).optional().describe('lowest elevation to list, in degrees. Default 10.'),
          limit: z.number().int().positive().max(50).optional().describe('how many satellites to list. Default 10.'),
        },
        annotations: ONLINE,
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'whats_up_now', tier, keyId });
        try { return asText(await whatsUpNowTool(args, deps, tier)); } catch (e) { return asError(e); }
      },
    );

    server.registerTool(
      'identify_satellite',
      {
        title: 'Identify a satellite',
        description: '"What was that moving light?" Given where and when a light was seen, lists the satellites that were sunlit, above the horizon and within `tolerance` degrees of that spot, best match first, from every satellite in the catalog. Say where it was with azimuth (degrees from north) or direction (a compass word such as "NE"), plus elevation (degrees above the horizon); add travel (the compass direction it was moving towards) to rank by direction of travel too. Each candidate has its azimuth, elevation, angular error, direction of travel, magnitude (often estimated, see magnitudeEstimated), name and a url to its page. time defaults to now.',
        inputSchema: {
          lat: z.number().min(-90).max(90).optional(),
          lon: z.number().min(-180).max(180).optional(),
          location: z.string().optional().describe('place name, geocoded if lat/lon omitted'),
          time: z.string().optional().describe(`time of the sighting. Default: now. ${TIME_IN}`),
          azimuth: z.number().min(0).max(360).optional().describe('where it was, in degrees from north (90 = east). Give this or direction.'),
          direction: z.string().optional().describe('where it was, as a compass word: N, NNE, NE, ... or "north-east".'),
          elevation: z.number().min(0).max(90).describe('how high it was, in degrees above the horizon (90 = straight up).'),
          travel: z.string().optional().describe('the compass direction it was moving towards, e.g. "NE". Optional, but it sharpens the match.'),
          tolerance: z.number().min(1).max(45).optional().describe('how far off the reported spot a match may be, in degrees. Default 10.'),
          limit: z.number().int().positive().max(10).optional().describe('how many candidates to return. Default 5.'),
        },
        annotations: ONLINE,
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'identify_satellite', tier, keyId });
        try { return asText(await identifySatelliteTool(args, deps, tier)); } catch (e) { return asError(e); }
      },
    );
  },
  // serverOptions
  { serverInfo: { name: 'seeksat', version: '1.0.0' } },
  // config - route lives at /api/mcp, so basePath '/api' derives the
  // streamable-HTTP endpoint to '/api/mcp'. No redisUrl needed: redis is
  // only used for SSE session resumability, not streamable HTTP.
  { basePath: '/api' },
);

// Wrap the MCP dispatch: resolve the caller's tier from the API key and
// run the whole dispatch inside the ALS scope so the tool callbacks above
// can read it. Fail-open - an unknown/absent key is simply 'free'.
async function handler(req: Request): Promise<Response> {
  const { tier, keyId } = resolveTier(presentedKey(req), PRO_KEYS);
  return runWithRequestContext({ tier, keyId }, () => mcpHandler(req));
}

export { handler as GET, handler as POST };
