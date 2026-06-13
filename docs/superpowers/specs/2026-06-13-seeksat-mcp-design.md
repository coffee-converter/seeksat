# SeekSat MCP Server — Design Spec

**Date:** 2026-06-13
**Status:** Approved (brainstorm)

## Goal

A real, deployed Model Context Protocol (MCP) server that lets AI agents query
satellite-pass and orbital-position data, reusing SeekSat's existing
pass-prediction engine. It is built to be genuinely useful **and** to serve as a
job-hunt portfolio artifact. When design choices trade off, favor depth and what
reads as competent to a technical reviewer over breadth.

The pitch: *same engine, two faces, one data layer — a 3D UI for humans (the
existing SeekSat app) and an MCP for agents, both reading SGP4 math and TLE data
from the same cron-cached source.*

## Non-Goals (v1)

- A generalized ephemeris/astronomy MCP (planets, arbitrary bodies, catalogs).
  The architecture must not *preclude* this, but v1 stays satellite-focused.
- Tracking arbitrary NORAD IDs on demand. v1 ships a curated catalog; the MCP
  layer is written so arbitrary-ID lookup is a later one-line extension.
- A separate repository or monorepo extraction. v1 lives inside the existing
  SeekSat Next.js repo.

## Workstreams

This project is one shared foundation plus two consumers that build on it.
Sequence:

1. **Shared TLE cache + refresh cron** (foundation) — Edge Config store +
   `/api/refresh-tle` endpoint. Both consumers below depend on it.
2. **MCP server** — the agent-facing tools.
3. **Webapp load-path retrofit** — server-seed the existing app's TLE from the
   shared cache (see "Webapp Load Path" below).

Workstream 3 is in scope precisely because it justifies the shared cache: the
same data layer powers both faces. It is the only change v1 makes to existing
app behavior.

## Where It Lives

A route handler inside the existing SeekSat repo:

```
app/api/mcp/route.ts        # MCP server (Streamable HTTP) via mcp-handler
app/api/refresh-tle/route.ts # Cron-invoked TLE refresh endpoint
```

- Served over **Streamable HTTP** using the `mcp-handler` / `@vercel/mcp-adapter`
  package, running as a normal Node function on Vercel Fluid Compute.
- Imports `lib/pass-finder/*` and related pure modules **directly** — no
  reimplemented orbital math. The agent-facing engine and the human-facing 3D
  app share one source of truth and cannot drift.
- Agents connect to `https://<domain>/api/mcp`.

Rationale for same-repo (vs separate repo / monorepo): zero math duplication,
one deploy/domain/maintenance surface, and the "two faces, one engine" demo
story. Monorepo extraction (`@seeksat/core`) remains a future option if it earns
its keep; it is not a v1 cost.

## Scope: Curated Catalog, Generality-Ready

v1 ships a small curated catalog of satellites, e.g.:

- ISS (NORAD 25544)
- Hubble Space Telescope (20580)
- Tiangong / CSS (48274)
- 1–2 additional bright, reliably-visible objects (final list TBD during
  implementation; chosen for brightness + TLE availability)

The MCP layer takes a **satellite identifier** (NORAD ID or name) as a parameter
and resolves it against the catalog. Nothing in the MCP layer is hardcoded to
25544. Adding "track any NORAD ID" later means relaxing the resolver to fetch an
unknown ID's TLE on demand — the rest of the pipeline is already general.

## Tool Surface

### Core tools (deterministic, fast, offline-capable)

**`list_satellites`**
Returns the curated catalog so an agent can discover what is trackable.
- Input: none.
- Output: array of `{ noradId, name, aliases[], tleEpoch, tleAgeHours, source }`.

**`find_passes`** — the centerpiece.
- Input:
  - `satellite`: NORAD ID or name (resolved against catalog).
  - Location: either `lat` + `lon`, **or** a `location` string (geocoded).
  - `windowHours` (optional, default 48).
  - `minElevation` (optional degrees, default per existing engine).
  - `mode` (optional, `visual` | `radio`, default `visual`).
- Output: array of passes, each:
  - `rise`, `peak`, `set` — ISO 8601 timestamps.
  - `peakElevationDeg`.
  - `azimuthDeg` at rise / peak / set.
  - `durationSec`.
  - `peakMagnitude` (nullable when not sunlit / not applicable).
  - `sunlit` (boolean).
  - `quality` — label/score derived from the existing scoring curves.
  - TLE freshness fields: `tleEpoch`, `tleAgeHours`, `source`.

**`get_position`**
Where the satellite is now (or at a given time).
- Input: `satellite`, optional `time` (ISO 8601, default now).
- Output: `{ latDeg, lonDeg, altitudeKm, sunlit, time, tleEpoch, tleAgeHours, source }`.

**`next_visible_pass`**
One-call answer to "when can I next see X from here?" — sugar over
`find_passes` returning just the single next *good visible* pass.
- Input: `satellite`, location (lat/lon or `location` string).
- Output: a single pass object (same shape as `find_passes` entries), or null if
  none in a reasonable horizon.

### Optional, isolated tool (network-dependent)

**`get_pass_weather`**
Cloud forecast + "will you actually see it" probability for a given time/location.
- Input: `lat`/`lon` (or `location`), `time`.
- Output: `{ cloudCoverPct, viewingProbability, forecastSource, forecastAgeHours }`.
- Kept deliberately separate from the core pass tools so the deterministic core
  stays fast, offline-capable, and demo-stable.

## Location Input & Geocoding

Core tools accept **either** explicit `lat`/`lon` **or** a `location` string.
A `location` string is geocoded server-side by reusing the existing pure module
`lib/pass-finder/geocode.js`:

```
geocodeOne(query) -> { latDeg, lonDeg, displayName } | null
```

**Required change for server-side use:** the current module relies on the
browser's User-Agent. Nominatim's usage policy requires a descriptive
`User-Agent` for server-side requests, so the MCP must set an explicit
`User-Agent` header (e.g. `seeksat-mcp/1.0 (contact)`), and respect the
1 req/sec polite-use limit. This will be a small, backward-compatible adjustment
to the geocode call path (header injection), not a rewrite.

## Visibility Depth

The core exposes SeekSat's real visibility physics — the part that signals
domain competence, all already written and unit-tested in `lib/pass-finder/*`:

- Predicted **apparent magnitude** (`ratings.js: magnitudeAt`, standard satellite
  brightness formula with Lambertian phase function).
- **Sunlit vs Earth-shadow** test (`visibility.js: issIlluminated`).
- **Twilight gating** (observer sun altitude ≤ nautical twilight).
- **Atmospheric refraction** correction (`refraction.js`, Bennett 1982).
- **Pass quality scoring** (`scoring.js`, `ratings.js`) for the `quality` field.

Weather/cloud scoring (`weather.js`) is the only network-dependent piece and is
surfaced exclusively through `get_pass_weather`, never folded into core results.

## TLE Data Flow

TLEs are never fetched on the request path. Freshness is decoupled from latency.

```
Vercel Cron (every 6h)
   └─► GET /api/refresh-tle
          └─► fetch TLE sources (wheretheiss.at, ivanstanojevic, celestrak)
                 └─► epoch-guarded write to Edge Config
                        (write only if fetched epoch is NEWER than stored)

Edge Config (shared TLE store)
   ├─► Agent  ─► /api/mcp ─► read TLEs (sub-ms) ─► SGP4 ─► response
   └─► Webapp ─► server component reads TLE ─► seeds initial render (see below)
```

- **Store:** Vercel **Edge Config** — tiny payload (a handful of
  `{ noradId, line1, line2, epoch, source, fetchedAt }` records), read on every
  request, written ~4×/day. Reads are near-zero-latency at the edge. (Fallback
  option if Edge Config is undesirable: a single JSON blob in Vercel Blob.)
- **Epoch-guarded writes:** the refresh endpoint parses each fetched TLE's epoch
  (`tle.js: parseTleEpoch`) and writes only if it is newer than the stored
  record, so a flaky source returning an older element set cannot clobber good
  data. Source ordering/preference from the existing `tle.js` is preserved.
- **Serve-stale-on-error:** if a refresh fails (e.g. `ivanstanojevic` 508s), the
  cron is a no-op and the MCP keeps serving the last-known-good TLE, which is
  still SGP4-valid for days. Upstream outages never reach the agent.
- **Freshness exposed:** every response carries `tleEpoch`, `tleAgeHours`, and
  `source` so callers can reason about data provenance.

Rationale: ISS receives a new element set ~1–2×/day and SGP4 stays accurate for
days off a given TLE, so a 6-hour cached refresh is correct physics, not a stale
shortcut.

## Webapp Load Path (Server-Seed + Non-Blocking Client Refresh)

The same Edge Config TLE cache powers the existing webapp, removing the
load-time wait on client-side TLE fetches.

**Behavior:**

1. The Next.js server layer (page / server component) reads the current TLE
   from Edge Config and passes it to the client as an **initial prop**. The 3D
   globe renders with a valid ISS position immediately — no blocking fetch, no
   dependency on flaky CORS sources at load.
2. The client **still** kicks off its existing TLE fetch, but now it is
   **non-blocking background freshen**, not the critical path.
3. When the client fetch returns, it swaps in the new TLE **only if its epoch is
   newer** than the server-seeded one — the same epoch-guard comparison used in
   the refresh endpoint, applied client-side.

**Why this is a strict upgrade over the status quo:**

- Instant first paint with a valid satellite position.
- The flaky client fetch (CORS, 508s, source-ordering — the subject of recent
  commits) leaves the critical path; worst case it fails and the app still has a
  valid server-seeded TLE.
- Freshness is preserved: when the network cooperates, the client still upgrades
  to the freshest available element set.

**Scope:** This is the only change v1 makes to existing app behavior. It touches
the page's server data-loading and the client TLE-init path; the epoch-guard
swap logic is shared with the MCP/refresh layer rather than duplicated.

## Architecture Reuse Map

Pure modules consumed by the MCP (no React/Cesium/DOM coupling; existing unit
tests port unchanged):

| Module | Role in MCP |
|---|---|
| `lib/pass-finder/tle.js` | TLE fetch + epoch parsing (used by refresh endpoint) |
| `lib/truth.js` | SGP4 propagation → ECEF |
| `lib/coords.js` | ECEF ↔ geodetic (sub-point for `get_position`) |
| `lib/pass-finder/search.js` | Pass-window discovery |
| `lib/pass-finder/observer-pass.js` | Per-observer pass-window edges |
| `lib/pass-finder/visibility.js` | Alt/az, sunlit, twilight predicates |
| `lib/pass-finder/scoring.js`, `ratings.js` | Magnitude + quality scoring |
| `lib/refraction.js` | Apparent-altitude correction |
| `lib/pass-finder/geocode.js` | Location-string resolution (+ UA header) |
| `lib/pass-finder/weather.js` | `get_pass_weather` only |

New code (the thin MCP layer):

- `app/api/mcp/route.ts` — MCP server, tool definitions, input validation,
  satellite resolution, response shaping.
- `app/api/refresh-tle/route.ts` — cron endpoint, epoch-guarded Edge Config write.
- A small catalog module (curated satellite list) and an Edge-Config TLE
  read/write helper (shared by the MCP, the refresh cron, and the webapp seed).
- Webapp retrofit: server-side TLE read in the page/server component + initial
  prop wiring, and the client TLE-init path switched to non-blocking
  epoch-guarded freshen.

## Testing

- Existing `lib/pass-finder/*` `node:test` unit tests run unchanged.
- New tests:
  - MCP tool layer: input validation, satellite resolution (id + name +
    unknown), location resolution (lat/lon vs `location`), response shapes.
  - Refresh logic: epoch-guard accepts newer / rejects older / handles
    source failure (serve-stale).
  - Webapp seed: server read returns the cached TLE; client freshen swaps only
    on a newer epoch (shared epoch-guard).
- Demonstrate end-to-end against a real MCP client (Claude Desktop / Cursor /
  MCP inspector) as a manual acceptance check.

## Portfolio Layer

- A focused README: the "two faces, one engine" framing, a connect-and-demo
  walkthrough ("when can I next see the ISS from Tokyo?"), and a short
  design-decisions section (deterministic core vs network enrichment;
  cron-cached, epoch-guarded TLEs; serve-stale resilience; tool ergonomics like
  `next_visible_pass`).
- Optional: a short demo GIF/recording of an agent calling the tools.

## Open Questions / Decisions Deferred to Implementation

- Final curated satellite list (brightness + reliable TLE availability).
- Exact `quality` representation (numeric probability vs labeled tier) in tool
  output — pick one and keep it consistent across `find_passes` /
  `next_visible_pass`.
- Edge Config vs Blob final call (default: Edge Config).
