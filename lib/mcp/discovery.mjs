// lib/mcp/discovery.mjs - canonical facts about the MCP server, shared
// by every discoverability surface (/llms.txt, /mcp page, About pane) so
// they can't drift. Pure data + string builders; no I/O.

export const MCP_ENDPOINT_PATH = '/api/mcp';

export const TOOL_SUMMARIES = [
  { name: 'list_satellites', summary: "What's trackable + each satellite's TLE freshness and tier." },
  { name: 'find_passes', summary: 'Upcoming passes for a satellite over a location: times, height, magnitude, quality, and when it can be seen by eye (visibleFrom, visibleUntil, entering or leaving Earth\'s shadow).' },
  { name: 'get_position', summary: 'Live sub-point latitude/longitude, altitude, and sunlit state.' },
  { name: 'next_visible_pass', summary: 'One-call "when can I next see X from here?"' },
  { name: 'get_pass_weather', summary: 'Cloud-cover forecast + viewing probability (network-dependent).' },
  { name: 'get_pass_chart', summary: 'A rendered polar sky chart (PNG) of the next pass - where to look, with the moon, planets, and stars in place.' },
  { name: 'best_pass', summary: 'The best upcoming pass over a location, for one satellite or from a scan: visual mode scans the popular satellites plus CelesTrak\'s visual group (the brightest objects), with the cloud forecast folded in; radio mode scans every satellite with known downlinks, optionally by band or mode.' },
  { name: 'search_satellites', summary: 'Find any satellite in the catalog by name or NORAD number.' },
  { name: 'whats_up_now', summary: 'What is in the sky over a place right now, from the whole catalog: brightest in a dark sky, or radio satellites highest first.' },
  { name: 'identify_satellite', summary: '"What was that moving light?" The satellites that were sunlit near where and when it was seen, best match first.' },
  { name: 'get_radio_pass', summary: 'Known frequencies, Doppler swing, when to tune where and where to point, for one pass (or 24 hours for a satellite that never sets).' },
];

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
