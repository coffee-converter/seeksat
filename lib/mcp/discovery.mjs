// lib/mcp/discovery.mjs - canonical facts about the MCP server, shared
// by every discoverability surface (/llms.txt, /mcp page, About pane) so
// they can't drift. Pure data + string builders; no I/O.

import { TOOL_SPECS } from './tool-specs.mjs';

export const MCP_ENDPOINT_PATH = '/api/mcp';

// One line per tool, from the tool specs the server registers.
export const TOOL_SUMMARIES = TOOL_SPECS.map(({ name, summary }) => ({ name, summary }));

// What the results carry beyond the obvious, for agents reading the docs.
export const RESULT_NOTES = [
  'Satellite results include url, the satellite\'s page on seeksat.com, to link to.',
  'Pass rows say when the satellite can really be seen: visibleFrom and visibleUntil (null if never on that pass), and leavesShadow or entersShadow when it appears or fades mid-sky. sunlit is only the state at the peak.',
  'Most satellites have no published brightness. Their magnitude is then a cautious estimate from an assumed small size, marked peakMagnitudeEstimated or magnitudeEstimated, and a visual pass rated on it stops at Fair (quality 0.4), as on the site.',
  'Every tool only reads (readOnlyHint). Tools that take a place name are open-world: they geocode it with an outside service.',
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
