---
name: seeksat
description: Use when the user asks where a satellite (like the ISS, Hubble, Tiangong) is, when it will pass over or be visible from a place, what the best pass tonight is, what a moving light in the sky was, or radio pass details (frequencies, Doppler) - connects to the SeekSat MCP server for SGP4 passes, positions, sky charts and viewing conditions.
---

# SeekSat

SeekSat answers "where is this satellite and when can I see it?" with the
same SGP4 and visibility engine that powers seeksat.com, over MCP.

## Connect

Endpoint `https://seeksat.com/api/mcp`, Streamable HTTP, no sign-in:

```bash
claude mcp add --transport http seeksat https://seeksat.com/api/mcp
```

Full parameter reference: https://seeksat.com/mcp (or /llms.txt).

## Tools

- `best_pass` - the best passes over a place. Omit `satellite` to scan: visual mode scans the popular satellites plus CelesTrak's visual group with the cloud forecast folded in; radio mode scans every satellite with known downlinks. Use for "what's the best pass tonight?".
- `find_passes` - every pass of one satellite over a place, in time order (windowHours up to 240).
- `next_visible_pass` - the next pass of one satellite; `chart: true` adds its sky chart.
- `get_pass_chart` - a polar sky chart (PNG) of the next pass, or of the pass at `time`.
- `get_pass_weather` - cloud cover and clear-sky chance at a time; `available: false` with a reason when there is no forecast.
- `whats_up_now` - what is in the sky over a place right now, from the whole catalog.
- `identify_satellite` - "what was that moving light?" from where and when it was seen.
- `get_radio_pass` - frequencies, Doppler, when to tune where, and pointing for one pass.
- `get_position` - the point below a satellite, its altitude and whether it is sunlit.
- `search_satellites` - turn a name into a NORAD number, across the whole catalog.
- `list_satellites` - the popular satellites and their orbit data freshness.

## How to call it

- Place: `lat` and `lon` in decimal degrees (west negative), or `location` (a place name).
- Satellite: a NORAD number (25544 or "25544") or a name ("iss"); use `search_satellites` for others.
- Times: results are UTC with a local twin on the observer's clock (`rise` and `riseLocal`), and `resolvedLocation.timeZone`. A time input with no offset, like "2026-11-14T21:00", is read in the observer's time zone; the result says how it read it (`interpretedAs`).
- Give the user `passUrl` (or `url`) to open the pass on seeksat.com.
- Check `elementAge`: old or stale elements come with a warning. An empty pass list comes with a `note` explaining why.

## Example prompts

- "What's the best satellite pass tonight from Chicago, and will it be cloudy?"
- "When can I next see the ISS from Tokyo? Show me the sky chart."
- "I saw a bright moving light heading north-east at about 40 degrees up at 9:15pm in Denver. What was it?"
- "Give me the Doppler table for the next SO-50 pass over Chicago that peaks at 30 degrees or higher."
