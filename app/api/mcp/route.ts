// app/api/mcp/route.ts - Streamable-HTTP MCP server. Thin adapter:
// registers every tool in lib/mcp/tool-specs.mjs (strict zod input schemas
// the SDK validates), delegates to the pure handlers in lib/mcp/tools.mjs, and
// returns the result as JSON text content (plus an image for a chart).
import { createMcpHandler } from 'mcp-handler';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  listSatellites, findPassesTool, getPositionTool, nextVisiblePassTool, getPassWeatherTool, getPassChartTool, bestPassTool,
  searchSatellitesTool, radioPassTool, whatsUpNowTool, identifySatelliteTool,
} from '@/lib/mcp/tools.mjs';
import { TOOL_SPECS, inputObject } from '@/lib/mcp/tool-specs.mjs';
import { SERVER_INSTRUCTIONS } from '@/lib/mcp/discovery.mjs';
import { getCatalogReader } from '@/lib/mirror/server.mjs';
import { geocodeOne } from '@/lib/pass-finder/geocode.js';
import { fetchCloudForecast } from '@/lib/pass-finder/weather.js';
import { parseProKeys, resolveTier } from '@/lib/mcp/auth.mjs';
import { runWithRequestContext, getRequestContext } from '@/lib/mcp/request-context.mjs';
import { logUsage } from '@/lib/mcp/usage.mjs';
import { createLru } from '@/lib/mcp/radio-scan.mjs';

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
// changes nothing. Tools that can geocode a place name or fetch weather reach
// services outside SeekSat, so they are open-world (spec.online).
const LOCAL = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ONLINE = { ...LOCAL, openWorldHint: true };

type Args = Record<string, unknown>;
type Tier = 'free' | 'pro';

// The handler behind each tool in TOOL_SPECS.
const HANDLERS: Record<string, (args: Args, tier: Tier) => Promise<unknown>> = {
  list_satellites: () => listSatellites(deps),
  find_passes: (a, t) => findPassesTool(a, deps, t),
  get_position: (a, t) => getPositionTool(a, deps, t),
  next_visible_pass: (a, t) => nextVisiblePassTool(a, deps, t),
  get_pass_weather: (a) => getPassWeatherTool(a, deps),
  get_pass_chart: (a, t) => getPassChartTool(a, deps, t),
  search_satellites: (a) => searchSatellitesTool(a, deps),
  get_radio_pass: (a, t) => radioPassTool(a, deps, t),
  best_pass: (a, t) => bestPassTool(a, deps, t),
  whats_up_now: (a, t) => whatsUpNowTool(a, deps, t),
  identify_satellite: (a, t) => identifySatelliteTool(a, deps, t),
};

const mcpHandler = createMcpHandler(
  (server: McpServer) => {
    for (const spec of TOOL_SPECS) {
      const run = HANDLERS[spec.name];
      server.registerTool(
        spec.name,
        {
          title: spec.title,
          description: spec.description,
          // Strict: an unknown parameter is an error naming the ones it takes.
          inputSchema: inputObject(spec),
          annotations: spec.online ? ONLINE : LOCAL,
        },
        async (args: Args) => {
          const { tier, keyId } = getRequestContext();
          logUsage({ tool: spec.name, tier, keyId, satellite: args.satellite == null ? null : String(args.satellite) });
          // JSON first and a chart image (when there is one) LAST, so it is
          // the trailing content block clients are likeliest to show inline.
          try { return asResult(await run(args, tier as Tier)); } catch (e) { return asError(e); }
        },
      );
    }
  },
  // serverOptions: the instructions reach every client at initialize.
  { serverInfo: { name: 'seeksat', version: '1.0.0' }, instructions: SERVER_INSTRUCTIONS },
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
