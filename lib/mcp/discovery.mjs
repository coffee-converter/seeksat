// lib/mcp/discovery.mjs - canonical facts about the MCP server, shared
// by every discoverability surface (/llms.txt, the /mcp page, the server's
// own instructions) so they can't drift. Pure data + string builders; no I/O.

import { z } from 'zod';
import { TOOL_SPECS, TIME_IN, ALIASES } from './tool-specs.mjs';

export const MCP_ENDPOINT_PATH = '/api/mcp';
export const TRANSPORT = 'Streamable HTTP';

// One line per tool, from the tool specs the server registers.
export const TOOL_SUMMARIES = TOOL_SPECS.map(({ name, summary }) => ({ name, summary }));

// What the results carry beyond the obvious, for agents reading the docs.
export const RESULT_NOTES = [
  'Satellite results include url, the satellite\'s page on seeksat.com, to link to. Pass rows add passUrl, which opens that exact pass from that place.',
  'Times are UTC ISO 8601. Results with a place add resolvedLocation.timeZone (IANA) and, next to every time, the same moment on the observer\'s clock with its offset: rise and riseLocal, peak and peakLocal, and so on.',
  `Time inputs: ${TIME_IN}`,
  'Pass rows say when the satellite can really be seen: visibleFrom and visibleUntil (null if never on that pass), and leavesShadow or entersShadow when it appears or fades mid-sky. sunlit is only the state at the peak. Azimuths come with compass words (direction) and peakRangeKm is the distance at the peak.',
  'Pass rows carry rating, the rating seeksat.com shows: { word, bars (1-5), level, reason, and in visual mode headroomMag, how far it outshines the faintest stars you can see }, from brightness against the sky (skyType) and the cloud forecast in visual mode, and from peak height in radio mode. captureProbability (quality is its old name) is the chance a camera captures the pass, a different number that leaves brightness out.',
  'Most satellites have no published brightness. Their magnitude is then a cautious estimate from an assumed small size, marked peakMagnitudeEstimated or magnitudeEstimated, and a visual pass rated on it stops at Fair, as on the site.',
  'elementAge grades the orbital elements behind a result as the site does: fresh, old (over 7 days) or stale (over 14), with a warning when not fresh. Whole-sky tools and best_pass scans leave stale objects out and count them (skippedStaleElements). A tool for one satellite refuses to work out any time more than 30 days from the elements\' epoch, whether now, a time asked about, the end of a search window, or the pass it answers with.',
  'An empty pass list comes with a note saying why. get_pass_weather answers available:false with a reason when it has no forecast for the time.',
  'Every tool only reads (readOnlyHint). Tools that take a place name are open-world: they geocode it with OpenStreetMap. get_pass_weather, and in visual mode best_pass, find_passes, next_visible_pass and get_pass_chart, fetch a cloud forecast.',
];

/** Requests per window and per IP address, set as a Vercel firewall rule on
 *  /api/mcp (not in this code). */
export const RATE_LIMIT = { requests: 120, windowSeconds: 60 };
export const RATE_LIMIT_NOTE = `Up to ${RATE_LIMIT.requests} requests per ${RATE_LIMIT.windowSeconds} seconds per IP address (a firewall rule on the endpoint). Past that, requests are refused with HTTP 429 until the minute is up.`;

/** The old parameter names, as one line for the docs. */
export const ALIAS_NOTE = `Old parameter names still work on every tool that takes the parameter: ${Object.entries(ALIASES).map(([n, old]) => `${old.join(' and ')} for ${n}`).join('; ')}.`;

export const ERROR_NOTES = [
  'A tool that cannot answer (an unknown satellite, a place it cannot geocode, a time it cannot read) returns a normal tool result with isError: true and the text "Error: <message>", saying what to fix.',
  'Inputs of the wrong type or out of range are refused before the tool runs. That is also a tool result with isError: true (not a JSON-RPC error), whose text starts "MCP error -32602: Input validation error" and names the field and its limit.',
  `A parameter a tool does not take is refused the same way, with a message listing the ones it does take. ${ALIAS_NOTE}`,
];

/** The optional API key headers the server reads (app/api/mcp/route.ts). */
export const API_KEY_HEADERS = ['Authorization: Bearer <key>', 'X-API-Key: <key>'];

// One-line access note, surfaced on the /mcp page and in llms.txt.
export const ACCESS_NOTE =
  'Free and open: no sign-up and no key needed, and every satellite is free. The server also reads an optional API key ' +
  '(Authorization: Bearer <key>, or X-API-Key: <key>) so keyed access can be added later without an API change.';

/** Short guidance every client gets at connection (MCP initialize). */
export const SERVER_INSTRUCTIONS = [
  'SeekSat predicts satellite passes, positions and visibility from published orbital elements.',
  'Places: lat/lon in decimal degrees (west negative) or a place name. Satellites: a NORAD number (25544) or a name ("iss"); use search_satellites for anything else.',
  'Times in results are UTC with a <key>Local twin on the observer\'s clock; a time input with no offset is read in the observer\'s time zone.',
  'For "the best pass tonight" use best_pass; for every pass of one satellite use find_passes; for "what was that light?" use identify_satellite; for clouds use get_pass_weather with a pass\'s peak time.',
  'Give the user passUrl (or url) so they can open the pass on seeksat.com.',
].join(' ');

// `origin` is the absolute site origin, e.g. "https://seeksat.com".
export function mcpUrl(origin) {
  return `${origin}${MCP_ENDPOINT_PATH}`;
}

/** Claude Code: add the server from the command line. */
export function claudeAddCommand(origin) {
  return `claude mcp add --transport http seeksat ${mcpUrl(origin)}`;
}

/** Claude Code with an API key header. */
export function claudeAddCommandWithKey(origin) {
  return `${claudeAddCommand(origin)} --header "Authorization: Bearer YOUR_KEY"`;
}

/** Claude Code project config (.mcp.json): a remote server needs "type": "http". */
export function claudeCodeJsonConfig(origin) {
  return JSON.stringify({ mcpServers: { seeksat: { type: 'http', url: mcpUrl(origin) } } }, null, 2);
}

/** Cursor (~/.cursor/mcp.json or .cursor/mcp.json), with the optional key header. */
export function cursorJsonConfig(origin, { withKey = false } = {}) {
  const server = { url: mcpUrl(origin), ...(withKey && { headers: { Authorization: 'Bearer YOUR_KEY' } }) };
  return JSON.stringify({ mcpServers: { seeksat: server } }, null, 2);
}

/** Claude Desktop through the mcp-remote bridge (claude_desktop_config.json),
 *  for when a custom connector is not available. */
export function claudeDesktopBridgeConfig(origin) {
  return JSON.stringify({ mcpServers: { seeksat: { command: 'npx', args: ['-y', 'mcp-remote', mcpUrl(origin)] } } }, null, 2);
}

/** Claude Desktop and claude.ai: a custom connector by URL. */
export function claudeDesktopSteps(origin) {
  return `Settings > Connectors > Add custom connector, name it SeekSat, and paste ${mcpUrl(origin)}. No sign-in is needed.`;
}

/** The generic shape most clients take (Cursor, Windsurf and others). */
export function mcpJsonConfig(origin) {
  return cursorJsonConfig(origin);
}

/** A JSON Schema type as a short label: number, string, "visual" | "radio",
 *  array of ..., number or string. */
function typeLabel(js) {
  if (!js) return 'any';
  if (js.enum) return js.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (js.anyOf) return js.anyOf.map(typeLabel).join(' or ');
  if (js.type === 'array') return `array of ${typeLabel(js.items)}`;
  if (js.type === 'integer') return 'whole number';
  return js.type ?? 'any';
}

/** "0 to 90", "above 0, up to 240", "1 to 20", or "" for a plain value. */
function rangeLabel(js) {
  if (!js || js.anyOf) return '';
  if (js.type === 'integer' && js.exclusiveMinimum === 0 && js.maximum != null && js.maximum < 1e12) return `1 to ${js.maximum}`;
  const lo = js.minimum ?? js.exclusiveMinimum;
  const hi = js.maximum;
  if (lo == null && hi == null) return '';
  const from = js.exclusiveMinimum != null ? `above ${lo}` : lo != null ? `${lo}` : '';
  if (hi == null || hi > 1e12) return from ? `from ${from}` : '';
  return js.exclusiveMinimum != null ? `${from}, up to ${hi}` : `${from || 'up'} to ${hi}`;
}

/**
 * Each tool's parameters from its zod schema (the same one the server
 * validates with): [{ name, type, required, range, description }]. The
 * description carries the default.
 */
export function toolParams(spec) {
  const js = z.toJSONSchema(z.object(spec.inputSchema));
  const required = new Set(js.required ?? []);
  // Old names are listed once, in ALIAS_NOTE, not in every table.
  const aliases = spec.aliases ?? {};
  return Object.entries(js.properties ?? {}).filter(([name]) => !(name in aliases)).map(([name, p]) => ({
    name,
    type: typeLabel(p),
    required: required.has(name),
    range: rangeLabel(p),
    description: p.description ?? '',
  }));
}

/** Every tool with its title, description and parameters, for the docs. */
export function toolDocs() {
  return TOOL_SPECS.map((spec) => ({
    name: spec.name, title: spec.title, summary: spec.summary, description: spec.description, params: toolParams(spec),
  }));
}

// Optional public repo link. Empty string = omit links everywhere (the
// repo is private). Set to the public URL to enable links at once.
export const GITHUB_URL = '';
