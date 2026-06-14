# Webapp TLE Server-Seed — Design Spec

**Date:** 2026-06-14
**Status:** Approved (brainstorm)

## Goal

Make the pass-finder home page (`/`) render the ISS in the 3D globe **immediately
on load**, by server-seeding the initial TLE from the same Edge Config cache the
MCP server uses — instead of leaving the globe empty while the client-side
`fetchIssTle()` runs. This is spec "workstream 3" from
`2026-06-13-seeksat-mcp-design.md`, now scoped and de-risked.

This completes the "two faces, one data layer" story: the human web app and the
agent MCP both read the ISS TLE from one cron-refreshed source.

## Scope

- **Pass-finder page only** (`/` → `PassFinderApp`). The triangulate page keeps
  its deliberate button-driven fetch flow, unchanged.
- **No store/type changes.** The epoch guard parses `line1` directly, so
  `lib/pass-finder-store.ts` and `lib/types.ts` are untouched.
- **No clock-sync changes.** The client mount fetch stays exactly as-is.

## Non-Goals

- Seeding the triangulate page.
- Changing the `Tle` store shape to carry an epoch.
- Removing, deferring, or otherwise altering the client `fetchIssTle()` mount
  fetch (it already runs non-blocking; it also drives clock-sync — see below).
- A new client→server round-trip for the seed (that would defeat "instant"; the
  seed must be in the initial server-rendered payload).

## Key Constraint: Clock-Sync Rides on the Client Fetch

`lib/pass-finder/tle.js` calls `syncFromResponse(resp)` on every successful TLE
fetch, reading the HTTP `Date` header to estimate the user's clock skew. That
skew feeds `ClockSkewBanner`, `PlaybackControls` (`trueNow()`), and the Cesium
clock's initial `currentTime`. Clock-sync is driven **only** by the TLE fetch.

Therefore the client mount fetch must remain. The current fetch is **already
non-blocking** — the globe simply renders empty while it is in flight. So this
retrofit does not "make the fetch non-blocking"; it only:

1. Seeds the store from the server so the globe paints immediately, and
2. Guards the fetch's result so it doesn't overwrite a newer seed or a user edit.

Keeping the fetch means clock-sync is entirely unaffected.

## Data Flow

```
app/page.tsx (server component)
  └─ read Edge Config: createEdgeConfigStore().readMap()['25544']
        ├─ found  → initialTle = { name, line1, line2 }
        └─ absent / read fails / Edge Config unset → initialTle = null
  └─ <PassFinderApp initialTle={initialTle} />

PassFinderApp ("use client")
  └─ on mount: if (initialTle) setTle(initialTle)   // store → globe paints

TlePanel ("use client", unchanged mount fetch)
  └─ fetchIssTle() returns  → apply only if guards pass (see below)

Cesium scene + TlePanel both SUBSCRIBE to the store, so the ISS appears the
instant the seed (or a guarded fetch result) lands — no ordering coupling with
the async Cesium init.
```

## Components & Responsibilities

### 1. `lib/pass-finder/tle-seed.js` (new, pure, unit-tested)

The only new logic unit. Pure, no I/O, no React.

- `recordToTle(record)` → `{ name, line1, line2 }` or `null`. Maps an Edge Config
  TLE record (`{ noradId, name, line1, line2, epochMs, source, fetchedAtMs }`) to
  the store's `Tle` shape. Returns `null` for a missing/malformed record (so the
  server seed path degrades to "no seed").
- `isNewerTle(currentLine1, fetchedLine1)` → boolean. True iff
  `parseTleEpoch(fetchedLine1) > parseTleEpoch(currentLine1)` (strictly newer),
  using the existing `parseTleEpoch` from `tle.js`. Returns `false` if either
  epoch is non-finite (don't overwrite on ambiguous input) — except when the
  current line has no parseable epoch and the fetched one does (treat an empty/
  invalid current TLE as replaceable). Precise rule:
  - fetched epoch non-finite → `false` (never apply a junk fetch).
  - current epoch non-finite, fetched finite → `true` (replace empty/invalid).
  - both finite → `fetchedEpoch > currentEpoch`.

### 2. `app/page.tsx` (modify)

Server component. Before rendering `PassFinderApp`, read the ISS record from
Edge Config and compute `initialTle` via `recordToTle`, all inside a try/catch
that falls back to `null`. The existing `generateMetadata`/`searchParams` logic
is untouched. Because the page is already dynamic (it reads `searchParams`), the
Edge Config read happens per request — which is exactly Edge Config's design
point (sub-ms read-on-every-request). A slow or failing read must never block
render: fall back to `initialTle = null`.

### 3. `components/PassFinderApp.tsx` (modify)

Add `initialTle?: Tle` to its props. On mount (a `useEffect` with an empty dep
array, guarded by a ref so it runs once), if `initialTle` is present, call
`usePassFinderStore.getState().setTle(initialTle)` and set `tleStatus` to
`"ready"`. Everything else (Cesium loader, viewer hook, scene init) is unchanged.

### 4. `components/passes/TlePanel.tsx` (modify)

- Add a `userEditedRef` (a `useRef(false)`); set it `true` in each textarea's
  `onChange` handler.
- In the mount-fetch success handler (`doFetch`), before `setTle(fetched)`,
  apply both guards: skip if `userEditedRef.current` is true; otherwise apply
  only if `isNewerTle(store.line1, fetched.line1)`. The fetch itself, its status
  transitions, and `syncFromResponse` (inside `fetchIssTle`) are unchanged.
- Status nicety: when the store already holds a valid TLE (seeded), the panel
  shows that TLE immediately instead of the empty "fetching latest TLE…" state;
  the in-flight refresh is indicated subtly (e.g. a quiet "checking for newer…"
  rather than the empty-state message). The manual refresh button still works
  and bypasses the guards (an explicit user refresh always applies the result).

## Error Handling & Degradation

- **Edge Config unset / read error (e.g. local dev):** `initialTle = null`; the
  page renders exactly as today and the client fetch fills the globe. Pure
  progressive enhancement.
- **Stale seed:** the seed can be up to ~6h old (cron cadence). Irrelevant — the
  client fetch freshens it within seconds (subject to the epoch guard), and SGP4
  is accurate for days regardless.
- **Junk seed record:** `recordToTle` returns `null` → no seed.
- **Manual refresh button:** bypasses the guards so an explicit user action
  always wins.

## Testing

- **`test/tle-seed.test.mjs`** (new, `node:test`): `recordToTle` (valid record →
  Tle; missing/malformed → null) and `isNewerTle` (fetched newer → true; equal →
  false; fetched older → false; junk fetched → false; empty current + valid
  fetched → true).
- **Wiring** (server read → prop → seed → guarded fetch) is verified by
  `npm run typecheck`, `npm run build`, and a manual browser check (globe paints
  immediately with Edge Config seeded; a user paste survives an in-flight fetch;
  clock-sync banner still resolves). This matches the repo's pure-logic-only
  automated-test convention (no React testing harness exists).
- The full existing suite must stay green.

## Files Touched

| File | Change |
|---|---|
| `lib/pass-finder/tle-seed.js` | New pure module: `recordToTle`, `isNewerTle` |
| `test/tle-seed.test.mjs` | New unit tests |
| `app/page.tsx` | Read Edge Config, compute `initialTle`, pass as prop |
| `components/PassFinderApp.tsx` | Accept `initialTle`, seed store on mount |
| `components/passes/TlePanel.tsx` | User-edit + epoch guards on fetch apply; seeded status nicety |

## Open Questions / Deferred

- None. The triangulate page and any store-shape epoch tracking are explicitly
  out of scope.
