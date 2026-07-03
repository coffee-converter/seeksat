# SeekSat MCP

Same engine, two faces, one data layer: the SeekSat web app renders ISS passes
in a 3D globe for humans; this MCP server exposes the *same* SGP4 +
visibility-physics engine to AI agents.

## Connect

Streamable HTTP endpoint: `https://<your-domain>/api/mcp`

```json
{
  "mcpServers": {
    "seeksat": { "url": "https://<your-domain>/api/mcp" }
  }
}
```

## Tools

- `list_satellites` - what's trackable + TLE freshness
- `find_passes` - upcoming passes (magnitude, sunlit, quality) for a sat + location
- `get_position` - live sub-point + sunlit state
- `next_visible_pass` - one-call "when can I next see X from here?"
- `get_pass_weather` - cloud forecast + viewing probability (network-dependent)

## Design decisions

- **Deterministic, offline core.** Pass geometry, magnitude, and visibility run
  with zero network calls; weather is the only network-dependent tool and is
  deliberately separate.
- **Cron-cached, epoch-guarded TLEs.** A 6-hour cron refreshes TLEs into Edge
  Config; requests read from the cache (sub-ms), never upstream. A flaky source
  returning an older element set can't clobber good data, and an upstream outage
  just means serving the last-known-good TLE - still SGP4-valid for days.
- **Engine reuse.** Every pass number comes from the same unit-tested
  `lib/pass-finder/*` modules that drive the web app, so the two faces can't
  drift.
