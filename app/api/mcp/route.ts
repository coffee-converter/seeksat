// app/api/mcp/route.ts — Streamable-HTTP MCP server. Thin adapter:
// validates input with zod, delegates to the pure handlers in
// lib/mcp/tools.mjs, returns the result as JSON text content.
import { createMcpHandler } from 'mcp-handler';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  listSatellites, findPassesTool, getPositionTool, nextVisiblePassTool, getPassWeatherTool,
} from '@/lib/mcp/tools.mjs';
import { createEdgeConfigStore } from '@/lib/mcp/tle-store.mjs';
import { geocodeOne } from '@/lib/pass-finder/geocode.js';
import { fetchCloudForecast } from '@/lib/pass-finder/weather.js';

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

const handler = createMcpHandler(
  (server: McpServer) => {
    server.tool(
      'list_satellites',
      'List the satellites this server can track, with each one\'s current TLE freshness.',
      {},
      async () => { try { return asText(await listSatellites(deps)); } catch (e) { return asError(e); } },
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
      async (args) => { try { return asText(await findPassesTool(args, deps)); } catch (e) { return asError(e); } },
    );

    server.tool(
      'get_position',
      'Get the current (or at a given time) sub-point latitude/longitude, altitude, and sunlit state of a satellite.',
      {
        satellite: z.string(),
        time: z.string().optional().describe('ISO 8601; defaults to now'),
      },
      async (args) => { try { return asText(await getPositionTool(args, deps)); } catch (e) { return asError(e); } },
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
      async (args) => { try { return asText(await nextVisiblePassTool(args, deps)); } catch (e) { return asError(e); } },
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
      async (args) => { try { return asText(await getPassWeatherTool(args, deps)); } catch (e) { return asError(e); } },
    );
  },
  // serverOptions
  { serverInfo: { name: 'seeksat', version: '1.0.0' } },
  // config — route lives at /api/mcp, so basePath '/api' derives the
  // streamable-HTTP endpoint to '/api/mcp'. No redisUrl needed: redis is
  // only used for SSE session resumability, not streamable HTTP.
  { basePath: '/api' },
);

export { handler as GET, handler as POST };
