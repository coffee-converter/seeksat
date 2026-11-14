# SeekSat MCP

Same engine, two faces: the SeekSat web app shows satellite pages and pass
lists for people; this MCP server gives AI agents the same SGP4 and
visibility engine.

The full reference, with every parameter, default and range generated from
the server's own schemas, is at https://seeksat.com/mcp and
https://seeksat.com/llms.txt. This file is the short version.

## Connect

- Endpoint: `https://seeksat.com/api/mcp`
- Transport: Streamable HTTP. No sign-in.

Claude Code:

```sh
claude mcp add --transport http seeksat https://seeksat.com/api/mcp
```

Add `--scope user` to have it in every project. Or in a project's `.mcp.json`
(a remote server needs `"type": "http"`):

```json
{
  "mcpServers": {
    "seeksat": { "type": "http", "url": "https://seeksat.com/api/mcp" }
  }
}
```

Claude Desktop and claude.ai: Settings > Connectors > Add custom connector,
name it SeekSat, and paste `https://seeksat.com/api/mcp`. Where custom
connectors are not available, bridge it in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "seeksat": { "command": "npx", "args": ["-y", "mcp-remote", "https://seeksat.com/api/mcp"] }
  }
}
```

Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "seeksat": { "url": "https://seeksat.com/api/mcp" }
  }
}
```

## Access, limits and errors

- Free and open, no key needed. The server also reads an optional API key,
  `Authorization: Bearer <key>` or `X-API-Key: <key>`, so keyed access can be
  added later without an API change (`claude mcp add ... --header
  "Authorization: Bearer YOUR_KEY"`, or `headers` in Cursor's JSON).
- Rate limit: 120 requests per 60 seconds per IP address, a Vercel firewall
  rule on the endpoint (not in this code). Past that, requests get HTTP 429.
- A tool that cannot answer returns a normal result with `isError: true` and
  the text `Error: <message>`. Inputs of the wrong type or out of range, and
  parameters the tool does not take, are refused before it runs, also as a
  tool result with `isError: true` (not a JSON-RPC error): its text starts
  `MCP error -32602: Input validation error` and names the field (or lists
  the parameters the tool takes).

## Tools

| Tool | What it does | Main inputs (defaults) |
| --- | --- | --- |
| `list_satellites` | The popular satellites with orbit data freshness | none |
| `find_passes` | Every pass of one satellite, in time order | satellite, place, windowHours (48, up to 240), minElevation (10), mode (visual), skyType (suburban) |
| `get_position` | Point below the satellite, altitude, sunlit | satellite, time (now), optional place for the time zone |
| `next_visible_pass` | The next pass, optionally with its chart | satellite, place, windowHours (72), minElevation (10), mode, skyType, chart |
| `get_pass_weather` | Cloud cover and clear-sky chance at one time | place, time; `available: false` with a reason when there is no forecast |
| `get_pass_chart` | Polar sky chart (PNG) of a pass, plus its pass row | satellite, place, time (next pass), mode, minElevation (10), skyType |
| `search_satellites` | Name or number to NORAD id, whole catalog | query, limit (10, up to 20), mode |
| `get_radio_pass` | Frequencies, Doppler, tuning and pointing for one pass | satellite, place, time (next pass), frequencyMHz, minElevation (10), windowHours (48) |
| `best_pass` | Best passes for one satellite or from a scan | satellite (omit to scan), place, windowHours (72), minElevation (10), limit (3, up to 20), mode, skyType, bands, modes, chart |
| `whats_up_now` | What is in the sky right now, whole catalog | place, mode, minElevation (10), limit (10, up to 50) |
| `identify_satellite` | "What was that moving light?" | place, time (now), azimuth or direction, elevation, travel, tolerance (10), limit (5, up to 10) |

A place is `lat` and `lon` in decimal degrees (west negative) or a
`location` name, geocoded with OpenStreetMap. A satellite is a NORAD number
(as a number or a string) or a name. Old names still work on every tool
that takes the parameter: `minElevationDeg` and `minElev` for
`minElevation`, `passTime` for an optional `time`.

`best_pass` with no satellite scans: in visual mode the popular satellites
plus CelesTrak's visual group (72 hours by default, 168 at most), ranked by
the site's visual rating with the cloud forecast folded in; in radio mode
every satellite with known downlinks (24 hours by default, 72 at most),
ranked by the radio rating (peak height).

## Results

- Times are UTC ISO 8601. With a place, results add
  `resolvedLocation.timeZone` and a local twin next to every time (`rise` and
  `riseLocal: "2026-11-14T17:41:00-06:00"`). A time input with no offset is
  read in the observer's time zone and echoed back as `interpretedAs`.
- Pass rows: rise, peak and set, peak elevation, azimuths with compass words,
  `peakRangeKm`, brightness (`peakMagnitudeEstimated` when the size is
  unknown), when it can be seen by eye (`visibleFrom`, `visibleUntil`,
  `leavesShadow`, `entersShadow`), and `passUrl`, a link to that pass on
  seeksat.com.
- `rating` is the rating the site shows: `{ word, bars (1-5), level, reason }`.
  Visual: brightness against the faintest star visible for `skyType`
  (`headroomMag`), stepped down for a cloudy forecast, and no higher than
  Fair when the brightness is estimated. Radio: peak height. Passes rank by it.
- `captureProbability` (0-1) is the chance a camera captures the pass (sky
  darkness, height, clear-sky odds, length; brightness plays no part).
  `quality` is its old name and carries the same number.
- `elementAge` grades the orbital elements as the site does (fresh, old over
  7 days, stale over 14) with a warning when not fresh. Whole-sky tools leave
  stale objects out (`skippedStaleElements`); a time more than 30 days from
  the elements' epoch is refused.
- An empty pass list carries a `note` saying why.

## Design decisions

- **Deterministic core.** Pass geometry, magnitude, visibility and the
  observer's time zone are worked out with no outside calls. Only geocoding
  (OpenStreetMap), the cloud forecast (Open-Meteo and MET Norway) and fetching
  a satellite missing from the snapshot (CelesTrak) reach other services.
- **Cron-cached, epoch-guarded elements.** A 4-hour cron mirrors the CelesTrak
  catalog into Vercel Blob; requests read that snapshot. A flaky source
  returning an older element set can't clobber good data, and an upstream
  outage just means serving the last good elements.
- **One source for tool definitions.** `lib/mcp/tool-specs.mjs` holds every
  tool's description and input schema; the route registers from it and the
  docs print from it.
- **Engine reuse.** Every pass number comes from the same unit-tested modules
  that drive the web app, so the two faces can't drift.
