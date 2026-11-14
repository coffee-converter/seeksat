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
import { callerOf, createHeavyGate, isHeavyCall } from '@/lib/mcp/heavy-gate.mjs';
import { readCappedText } from '@/lib/mcp/body.mjs';
import { createHash } from 'node:crypto';
import { logUsage } from '@/lib/mcp/usage.mjs';
import { createLru } from '@/lib/mcp/radio-scan.mjs';
import { createReceptionReader } from '@/lib/reception/reader.mjs';
import { createBlobReceptionStore } from '@/lib/reception/store.mjs';

// SatNOGS reception (lib/reception/), read at most hourly per instance.
const receptionReader = createReceptionReader({ store: createBlobReceptionStore() });

const PRO_KEYS = parseProKeys(process.env.MCP_PRO_KEYS);

// Trimmed here, once: the tier check and the caller's identity both use it.
function presentedKey(req: Request): string | null {
  const auth = req.headers.get('authorization');
  const raw = auth && auth.startsWith('Bearer ') ? auth.slice(7) : req.headers.get('x-api-key');
  const key = raw?.trim();
  return key ? key : null;
}

export const runtime = 'nodejs';
// A ceiling on any one call (the scans take a few seconds at most).
export const maxDuration = 60;

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
  reception: () => receptionReader.index(),
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
// What clients show for the server (MCP Implementation: title, website and
// icons, the site's own). mcp-handler types only name and version, but passes
// the object through to the SDK as is.
const SERVER_INFO = {
  name: 'seeksat',
  title: 'SeekSat',
  version: '1.0.0',
  websiteUrl: 'https://seeksat.com',
  icons: [
    { src: 'https://seeksat.com/icon.svg', mimeType: 'image/svg+xml', sizes: ['any'] },
    { src: 'https://seeksat.com/icon-512.png', mimeType: 'image/png', sizes: ['512x512'] },
    { src: 'https://seeksat.com/icon-192.png', mimeType: 'image/png', sizes: ['192x192'] },
  ],
};

const LOCAL = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ONLINE = { ...LOCAL, openWorldHint: true };

type Args = Record<string, unknown>;

/** Tools that scan many satellites or draw an image. */
const heavyGate = createHeavyGate();
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
          const { tier, keyId, caller } = getRequestContext() as { tier: string; keyId: string | null; caller?: string };
          logUsage({ tool: spec.name, tier, keyId, satellite: args.satellite == null ? null : String(args.satellite) });
          // JSON first and a chart image (when there is one) LAST, so it is
          // the trailing content block clients are likeliest to show inline.
          // The scans and the chart render are heavy: one at a time per caller,
          // in a pool per tier (lib/mcp/heavy-gate.mjs).
          let release: (() => void) | null = null;
          if (isHeavyCall(spec.name, args)) {
            const slot = heavyGate.enter(tier, caller ?? 'anon');
            if (typeof slot !== 'function') return asError(new Error(slot.busy));
            release = slot;
          }
          try { return asResult(await run(args, tier as Tier)); } catch (e) { return asError(e); } finally { release?.(); }
        },
      );
    }
  },
  // serverOptions: the instructions reach every client at initialize.
  { serverInfo: SERVER_INFO, instructions: SERVER_INSTRUCTIONS },
  // config - route lives at /api/mcp, so basePath '/api' derives the
  // streamable-HTTP endpoint to '/api/mcp'. No redisUrl needed: redis is
  // only used for SSE session resumability, not streamable HTTP.
  { basePath: '/api' },
);

// Wrap the MCP dispatch: resolve the caller's tier from the API key and
// run the whole dispatch inside the ALS scope so the tool callbacks above
// can read it. Fail-open - an unknown/absent key is simply 'free'.
async function handler(req: Request): Promise<Response> {
  // One message per request, of a modest size: a JSON-RPC batch would let one
  // HTTP request (all the firewall's rate limit counts) carry a hundred tool
  // calls, and a huge body costs memory before any check runs.
  if (req.method === 'POST') {
    // Read up to the cap and no further (UTF-8 is at most 4 bytes a character).
    const text = await readCappedText(req, MAX_BODY_CHARS * 4);
    if (text == null || text.length > MAX_BODY_CHARS) return jsonRpcRefusal(413, 'request too large');
    if (text.trimStart().startsWith('[')) return jsonRpcRefusal(400, 'batches are not supported: send one message per request');
    // The original Content-Length goes: the body is now the decoded text,
    // whose length can differ (invalid UTF-8 decodes to longer characters).
    const headers = new Headers(req.headers);
    headers.delete('content-length');
    req = new Request(req.url, { method: 'POST', headers, body: text });
  }
  const key = presentedKey(req);
  const { tier, keyId } = resolveTier(key, PRO_KEYS);
  const keyHash = tier === 'pro' && key ? createHash('sha256').update(key).digest('hex') : null;
  return runWithRequestContext({ tier, keyId, caller: callerOf(keyHash, tier, req.headers) }, () => mcpHandler(req));
}

const MAX_BODY_CHARS = 64 * 1024;
function jsonRpcRefusal(status: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message } }, { status });
}

export { handler as GET, handler as POST };
