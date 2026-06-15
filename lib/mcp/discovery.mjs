// lib/mcp/discovery.mjs — canonical facts about the MCP server, shared
// by every discoverability surface (/llms.txt, /mcp page, About pane) so
// they can't drift. Pure data + string builders; no I/O.

export const MCP_ENDPOINT_PATH = '/api/mcp';

export const TOOL_SUMMARIES = [
  { name: 'list_satellites', summary: "What's trackable + each satellite's TLE freshness and tier." },
  { name: 'find_passes', summary: 'Upcoming passes (magnitude, sunlit, quality) for a satellite over a location.' },
  { name: 'get_position', summary: 'Live sub-point latitude/longitude, altitude, and sunlit state.' },
  { name: 'next_visible_pass', summary: 'One-call "when can I next see X from here?"' },
  { name: 'get_pass_weather', summary: 'Cloud-cover forecast + viewing probability (network-dependent).' },
];

// `origin` is the absolute site origin, e.g. "https://seeksat.com".
export function mcpUrl(origin) {
  return `${origin}${MCP_ENDPOINT_PATH}`;
}

export function claudeAddCommand(origin) {
  return `claude mcp add --transport http seeksat ${mcpUrl(origin)}`;
}

export function mcpJsonConfig(origin) {
  return JSON.stringify({ mcpServers: { seeksat: { url: mcpUrl(origin) } } }, null, 2);
}

// Optional public repo link. Empty string = omit links everywhere (the
// repo is private). Set to the public URL to enable links at once.
export const GITHUB_URL = '';

// One-line access/tiering note (ties to the monetization seam). Surfaced
// on the /mcp page and the About pane.
export const ACCESS_NOTE =
  'Free and open today. The server is key-gated-ready: premium satellites and ' +
  'higher rate limits can be enabled per API key without an API change.';
