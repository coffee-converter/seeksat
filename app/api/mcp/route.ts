// app/api/mcp/route.ts — Streamable-HTTP MCP server. Thin adapter:
// validates input with zod, delegates to the pure handlers in
// lib/mcp/tools.mjs, returns the result as JSON text content.
import { createMcpHandler } from 'mcp-handler';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  listSatellites, findPassesTool, getPositionTool, nextVisiblePassTool, getPassWeatherTool, getPassChartTool,
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
      'Find upcoming passes of a satellite over a location. Provide lat+lon or a location string. mode "visual" returns only sunlit, after-dark passes; "radio" returns all line-of-sight passes.',
      {
        satellite: z.string().describe('NORAD id or name, e.g. "iss" or 25544'),
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
        location: z.string().optional().describe('place name, geocoded if lat/lon omitted'),
        windowHours: z.number().positive().max(240).optional(),
        minElevation: z.number().min(0).max(90).optional(),
        mode: z.enum(['visual', 'radio']).optional(),
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
      'Get the single next good visible pass of a satellite from a location.',
      {
        satellite: z.string(),
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
        location: z.string().optional(),
        mode: z.enum(['visual', 'radio']).optional(),
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'next_visible_pass', tier, keyId, satellite: args.satellite });
        try { return asText(await nextVisiblePassTool(args, deps, tier)); } catch (e) { return asError(e); }
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
      'Render a polar sky chart (PNG) of a satellite\'s next pass over a location — where to look, with the moon, planets, and stars in their real positions. mode "visual" (default) or "radio".',
      {
        satellite: z.string().describe('NORAD id or name, e.g. "iss" or 25544'),
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
        location: z.string().optional().describe('place name, geocoded if lat/lon omitted'),
        mode: z.enum(['visual', 'radio']).optional(),
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'get_pass_chart', tier, keyId, satellite: args.satellite });
        try {
          const res = await getPassChartTool(args, deps, tier);
          return res.pngBase64
            ? { content: [
                { type: 'image' as const, data: res.pngBase64, mimeType: 'image/png' },
                { type: 'text' as const, text: res.summary },
              ] }
            : { content: [{ type: 'text' as const, text: res.summary }] };
        } catch (e) { return asError(e); }
      },
    );
  },
  // serverOptions
  { serverInfo: { name: 'seeksat', version: '1.0.0' } },
  // config — route lives at /api/mcp, so basePath '/api' derives the
  // streamable-HTTP endpoint to '/api/mcp'. No redisUrl needed: redis is
  // only used for SSE session resumability, not streamable HTTP.
  { basePath: '/api' },
);

// Wrap the MCP dispatch: resolve the caller's tier from the API key and
// run the whole dispatch inside the ALS scope so the tool callbacks above
// can read it. Fail-open — an unknown/absent key is simply 'free'.
async function handler(req: Request): Promise<Response> {
  const { tier, keyId } = resolveTier(presentedKey(req), PRO_KEYS);
  return runWithRequestContext({ tier, keyId }, () => mcpHandler(req));
}

export { handler as GET, handler as POST };
