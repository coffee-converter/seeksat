// app/api/mcp/route.ts - Streamable-HTTP MCP server. Thin adapter:
// validates input with zod, delegates to the pure handlers in
// lib/mcp/tools.mjs, returns the result as JSON text content.
import { createMcpHandler } from 'mcp-handler';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  listSatellites, findPassesTool, getPositionTool, nextVisiblePassTool, getPassWeatherTool, getPassChartTool, bestPassTool,
} from '@/lib/mcp/tools.mjs';
import { createEdgeConfigStore } from '@/lib/mcp/tle-store.mjs';
import { geocodeOne } from '@/lib/pass-finder/geocode.js';
import { fetchCloudForecast } from '@/lib/pass-finder/weather.js';
import { parseProKeys, resolveTier } from '@/lib/mcp/auth.mjs';
import { runWithRequestContext, getRequestContext } from '@/lib/mcp/request-context.mjs';
import { logUsage } from '@/lib/mcp/usage.mjs';

const PRO_KEYS = parseProKeys(process.env.MCP_PRO_KEYS);

function presentedKey(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return req.headers.get('x-api-key');
}

export const runtime = 'nodejs';

const store = createEdgeConfigStore();
const deps = {
  readMap: () => store.readMap(),
  geocode: (q: string, opts?: object) => geocodeOne(q, opts),
  fetchWeather: (lat: number, lon: number) => fetchCloudForecast(lat, lon),
  now: () => Date.now(),
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

const mcpHandler = createMcpHandler(
  (server: McpServer) => {
    server.tool(
      'list_satellites',
      'List the satellites this server can track, with each one\'s current TLE freshness.',
      {},
      async () => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'list_satellites', tier, keyId });
        try { return asText(await listSatellites(deps)); } catch (e) { return asError(e); }
      },
    );

    server.tool(
      'find_passes',
      'List ALL upcoming passes of one satellite over a location, ranked by a quality score. Returns an array of passes, each with rise/peak/set times, peak elevation (deg), brightness (magnitude - lower/more-negative is brighter), duration, and a quality score 0-1. Scans windowHours ahead (default 48, up to 240 = 10 days), so this is the tool for comparing passes or finding the best/brightest one over a span of days - not just the next one. mode "visual" returns only sunlit, after-dark (naked-eye) passes; "radio" returns all line-of-sight passes. Provide lat+lon or a location string. Feed any pass\'s peak time to get_pass_chart (to draw it) or get_pass_weather (to check clouds). To rank across ALL tracked satellites at once, use best_pass.',
      {
        satellite: z.string().describe('NORAD id or name, e.g. "iss" or 25544'),
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
        location: z.string().optional().describe('place name, geocoded if lat/lon omitted'),
        windowHours: z.number().positive().max(240).optional().describe('how far ahead to search, in hours. Default 48; max 240 (10 days). Widen this to find the best pass over the coming days.'),
        minElevation: z.number().min(0).max(90).optional().describe('only return passes whose peak rises at least this many degrees above the horizon. Default 10.'),
        mode: z.enum(['visual', 'radio']).optional().describe('"visual" (default) = naked-eye, sunlit, after-dark passes; "radio" = all line-of-sight passes regardless of light.'),
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'find_passes', tier, keyId, satellite: args.satellite });
        try { return asText(await findPassesTool(args, deps, tier)); } catch (e) { return asError(e); }
      },
    );

    server.tool(
      'get_position',
      'Get the current (or at a given time) sub-point latitude/longitude, altitude, and sunlit state of a satellite.',
      {
        satellite: z.string(),
        time: z.string().optional().describe('ISO 8601; defaults to now'),
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'get_position', tier, keyId, satellite: args.satellite });
        try { return asText(await getPositionTool(args, deps, tier)); } catch (e) { return asError(e); }
      },
    );

    server.tool(
      'next_visible_pass',
      'Convenience shortcut: the single next good visible pass of one satellite from a location. Use this only when the user wants "the next pass." Set chart:true to also render that pass\'s sky chart and return it in this same call (so the user sees the chart without a separate get_pass_chart step). To compare multiple upcoming passes, or to find the best/brightest pass over the next several days, use find_passes (one satellite) or best_pass (ranked across all tracked satellites) instead.',
      {
        satellite: z.string(),
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
        location: z.string().optional(),
        mode: z.enum(['visual', 'radio']).optional(),
        chart: z.boolean().optional().describe('When true, also render the pass\'s polar sky chart (PNG) and include it in this result - use whenever the user wants to see or visualise the pass.'),
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'next_visible_pass', tier, keyId, satellite: args.satellite });
        try { return asResult(await nextVisiblePassTool(args, deps, tier)); } catch (e) { return asError(e); }
      },
    );

    server.tool(
      'get_pass_weather',
      'Cloud-cover forecast and viewing probability for a location at a given time. Network-dependent.',
      {
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
        location: z.string().optional(),
        time: z.string().describe('ISO 8601 time of the pass'),
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'get_pass_weather', tier, keyId });
        try { return asText(await getPassWeatherTool(args, deps)); } catch (e) { return asError(e); }
      },
    );

    server.tool(
      'get_pass_chart',
      'Render a polar sky chart (PNG) of a satellite\'s pass over a location - where to look, with the moon, planets, and stars in their real positions. By default it charts the NEXT pass; pass `time` (the rise or peak of a specific pass from find_passes / best_pass) to chart THAT pass instead - this is how you visualise the best pass rather than just the next one. mode "visual" (default) or "radio".',
      {
        satellite: z.string().describe('NORAD id or name, e.g. "iss" or 25544'),
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
        location: z.string().optional().describe('place name, geocoded if lat/lon omitted'),
        time: z.string().optional().describe('ISO 8601. Charts the pass occurring around this time (use a pass\'s rise or peak from find_passes/best_pass). Omit to chart the next pass from now.'),
        mode: z.enum(['visual', 'radio']).optional(),
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'get_pass_chart', tier, keyId, satellite: args.satellite });
        try {
          const res = await getPassChartTool(args, deps, tier);
          // Image LAST so it's the trailing content block: clients that render
          // the final block inline (rather than only inside the tool-call
          // accordion) are more likely to surface the chart in the response.
          return res.pngBase64
            ? { content: [
                { type: 'text' as const, text: res.summary },
                { type: 'image' as const, data: res.pngBase64, mimeType: 'image/png' },
              ] }
            : { content: [{ type: 'text' as const, text: res.summary }] };
        } catch (e) { return asError(e); }
      },
    );

    server.tool(
      'best_pass',
      'Find the best upcoming pass(es) over a location, ranked by quality. Omit `satellite` to scan ALL tracked satellites and return the single best thing flying over ("what\'s the best pass tonight?"); give `satellite` to rank that one satellite\'s passes. Returns `best` (the top pass) plus a `passes` array of the top-ranked options, each tagged with its satellite, times, peak elevation, brightness, and quality score. Set chart:true to also render the winning pass\'s sky chart and return it in this same call - prefer this over a separate get_pass_chart step when the user wants to see the best pass. mode "visual" (default) or "radio".',
      {
        satellite: z.string().optional().describe('NORAD id or name (e.g. "iss") to rank one satellite. Omit to scan and rank across every tracked satellite.'),
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
        location: z.string().optional().describe('place name, geocoded if lat/lon omitted'),
        windowHours: z.number().positive().max(240).optional().describe('how far ahead to search, in hours. Default 72; max 240 (10 days).'),
        minElevation: z.number().min(0).max(90).optional().describe('ignore passes peaking below this many degrees. Default 10.'),
        limit: z.number().int().positive().max(20).optional().describe('how many ranked passes to return. Default 3.'),
        mode: z.enum(['visual', 'radio']).optional().describe('"visual" (default) = naked-eye sunlit passes after dark; "radio" = all line-of-sight passes.'),
        chart: z.boolean().optional().describe('When true, also render the winning pass\'s polar sky chart (PNG) and include it in this result - use whenever the user wants to see or visualise the best pass.'),
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'best_pass', tier, keyId, satellite: args.satellite });
        try { return asResult(await bestPassTool(args, deps, tier)); } catch (e) { return asError(e); }
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
