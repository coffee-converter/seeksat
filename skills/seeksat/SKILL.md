---
name: seeksat
description: Use when the user asks where a satellite (like the ISS, Hubble, Tiangong) is right now, or when it will next be visible / pass over a location — connects to the SeekSat MCP server for SGP4-accurate passes, positions, and viewing conditions.
---

# SeekSat

SeekSat answers "where is this satellite and when can I see it?" using the same
SGP4 + visibility engine that powers the SeekSat 3D web app, exposed over MCP.

## Connect

Streamable HTTP endpoint: `https://seeksat.com/api/mcp`

```bash
claude mcp add --transport http seeksat https://seeksat.com/api/mcp
```

## Tools

- `list_satellites` — what's trackable + each satellite's TLE freshness and tier.
- `find_passes` — upcoming passes (magnitude, sunlit, quality) for a satellite over a location.
- `get_position` — live sub-point latitude/longitude, altitude, and sunlit state.
- `next_visible_pass` — one-call "when can I next see X from here?"
- `get_pass_weather` — cloud-cover forecast + viewing probability (network-dependent).
- `get_pass_chart` — a rendered polar sky chart (PNG) of the next pass: where to look, with the moon, planets, and stars in place.

Locations accept either `lat`/`lon` or a place-name string (geocoded). Passes
carry a `quality` score and `tier`/freshness metadata.

## Example prompts

- "When can I next see the ISS from Tokyo?"
- "Is the ISS sunlit right now, and where is it?"
- "Find tonight's visible passes of Tiangong over Paris, and will it be cloudy?"
