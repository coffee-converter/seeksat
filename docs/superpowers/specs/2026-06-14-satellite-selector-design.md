# Satellite Selector + Catalog Tiering — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)
**Scope:** Spec A of a 3-part batch. (B = MCP monetization seam; C = discoverability surfaces. Both follow, separate specs.)

## Purpose

Replace the pass-finder's raw TLE textarea panel with a **catalog-driven satellite
selector**, defaulting to the ISS, built to scale from 5 satellites to many. In the
same stroke, make `catalog.mjs` the single shared source of truth for the webapp UI,
the MCP server, and the cron seeder, and add a dormant free/premium **tier** field so
later monetization (Spec B) is a data change, not a refactor.

This is a webapp UX change plus a small data/product change. It is **not** the
mouse pan/zoom overhaul — that is the explicitly-deferred next piece of work.

## Background / current state

- `lib/mcp/catalog.mjs` holds 3 satellites (`{ noradId, name, aliases }`) and
  `resolveSatellite(idOrName)`. It is pure data, already imported by the MCP tools
  and the cron `refresh-tle` route.
- `components/passes/TlePanel.tsx` renders three `<textarea>`s (name/line1/line2) plus
  a Refresh button. On mount it calls `fetchIssTle()` and seeds the store, epoch- and
  user-edit-guarded.
- `lib/pass-finder/tle.js` `fetchIssTle()` is **hardcoded to ISS (25544)** at every
  source URL. Each successful fetch calls `syncFromResponse(resp)` (clock-sync.js),
  which is the **only** driver of the ClockSkewBanner.
- `app/page.tsx` already reads the full Edge Config record map server-side and seeds
  the ISS TLE (record 25544) into the store via `initialTle`.
- The Cesium scene subscribes to the store's `tle`; changing `tle` triggers
  `refreshSatrec` / orbit-cache invalidation. No scene changes are required to switch
  satellites — only the store's `tle` must update.
- Repo has **no React test harness**. Pure `.mjs`/`.js` modules are tested with
  `node:test`; components are verified via typecheck + build + manual.

## The starter catalog (5 satellites)

Chosen for a *pass finder*: brightness (naked-eye visibility), orbital inclination
(coverage), name recognition, and reliable public TLEs. The inclination spread is
intentional — it demonstrates the engine generalizes across orbit geometries and
across visual + radio modes, rather than being ISS-special-cased.

| Sat | NORAD | Incl. | Notes | defaultMode |
|-----|-------|-------|-------|-------------|
| ISS (ZARYA) | 25544 | 51.6° | mag ≈ -4, brightest object, broadest coverage | visual |
| Tiangong (CSS) | 48274 | 41.5° | mag ≈ -1, bright, topical | visual |
| BlueWalker 3 | 53807 | 53° | mag ≈ 0, one of the brightest sats; newsworthy | visual |
| Hubble Space Telescope | 20580 | 28.5° | mag ≈ +2, dim, **low-latitude only** | visual |
| NOAA-19 | 33591 | 99° (polar) | dim; **radio target**, all-latitude coverage | radio |

## Catalog schema (shared source of truth)

**Move** `lib/mcp/catalog.mjs` → `lib/catalog.mjs`. It is no longer MCP-specific once
the UI consumes it. Update the few MCP/route imports. `resolveSatellite` moves with it,
unchanged.

Enriched entry shape:

```js
{
  noradId: 25544,
  name: 'ISS (ZARYA)',
  aliases: ['iss', 'zarya', 'space station'],
  tier: 'free',              // 'free' | 'premium' — all 'free' for now
  inclinationDeg: 51.6,      // display + future filtering
  viewingHint: null,         // e.g. 'Best seen from lower latitudes' / 'Radio passes — too dim to see'
  defaultMode: 'visual',     // 'visual' | 'radio' — initial pass-search mode on selection
}
```

- `tier` is present on every entry and **all entries are `'free'` for now**. The
  selector renders premium styling + a lock affordance, but no current sat triggers it.
  Spec B enforces tiers server-side; flipping a sat to `'premium'` later is data-only.
- `viewingHint` is surfaced in the selected-sat readout so a legitimate `null`
  visible-pass result (Hubble at high latitude, NOAA in visual) reads as expected.
- `defaultMode` sets the pass-search mode when a sat is selected (NOAA-19 → radio).

## Components & data flow

### 1. Server-seed the whole catalog (`app/page.tsx`)

Already reads the Edge Config map. Extend it to build an `initialSatellites` array:
for each catalog entry, attach its seeded TLE record if present (`recordToTle`), else
`null`. Pass `initialSatellites` (and the resolved default selection = ISS) to
`PassFinderApp`. Graceful fallback unchanged: if Edge Config is empty/unset, every
TLE is `null` and the client fetch path fills them in on selection.

### 2. Store changes (`lib/pass-finder-store.ts`)

Add:
- `selectedNoradId: number` (default `25544`).
- `satelliteTles: Record<number, Tle>` — id → TLE map, seeded from `initialSatellites`.
- `setSelectedSatellite(noradId)` — sets `selectedNoradId`; if a TLE for that id is in
  `satelliteTles`, immediately `setTle(...)` it (instant switch, no fetch wait); and
  applies the entry's `defaultMode` via the **existing** pass-search mode state (the one
  `ModeToggle` drives), so NOAA-19 lands in radio mode. Selecting a sat never silently
  overrides a mode the user just set within the same selection — `defaultMode` applies
  on the *selection change* only.

`tle` / `setTle` / `tleStatus` semantics are unchanged; the scene keeps subscribing to
`tle`. Selecting a satellite is "set selection → push its TLE into `tle`".

### 3. New left-pane "Satellite" section (replaces `TlePanel`)

A new `components/passes/SatellitePanel.tsx` replaces the TLE `<details>` block:
- **Selector** — `components/passes/SatelliteSelector.tsx`: a custom dropdown (button
  trigger showing the current sat name + tier badge; popover list of catalog entries
  with name, inclination label, and tier badge). Premium entries render disabled with a
  lock + upsell tooltip (dormant — none are premium yet). Built so a filter `<input>`
  can be added later when the catalog grows; not built now (YAGNI).
- **Readout** — selected sat's NORAD id, TLE age ("updated 25h ago" from the record
  epoch), source, inclination, and `viewingHint` when present. This finally surfaces
  the freshness fields already plumbed through the seed/MCP.

The three raw TLE textareas and the Refresh button are removed entirely.

### 4. TLE sourcing + clock-sync (`lib/pass-finder/tle.js`)

Generalize `fetchIssTle()` → `fetchTle(noradId)`:
- Parameterize each source URL by NORAD id: wheretheiss
  `/v1/satellites/{id}/tles`, ivanstanojevic `/api/tle/{id}`, celestrak `CATNR={id}`.
- **wheretheiss is ISS-biased** but its endpoint is generic by id; if it fails for a
  non-ISS id, the existing fall-through to ivanstanojevic/celestrak handles it. No
  special-casing needed.
- `syncFromResponse(resp)` stays on every successful fetch, so **clock-sync now follows
  the selected satellite** instead of being ISS-only. Default-ISS-on-load preserves
  today's behavior exactly.
- Keep a thin `fetchIssTle()` wrapper (`= fetchTle(25544)`) if any caller still wants it,
  or update callers. Prefer updating callers and removing the alias.

### 5. Selection refresh behavior (`SatellitePanel`)

On selecting satellite N:
1. Immediately `setSelectedSatellite(N)` → pushes seeded TLE into `tle` (instant paint).
2. Fire `fetchTle(N)` to get the freshest elements **and** drive clock-sync.
3. Apply the fetched TLE only if `isNewerTle(currentLine1, fetched.line1)` (existing
   epoch guard) — a stale/failed fetch never regresses the seed. Update
   `satelliteTles[N]` on success.

`tleStatus` reflects fetching/ready/error for the *current* selection. No user-edit
guard is needed (manual editing is gone).

## Tiering stance

All 5 current satellites are `'free'`. The tier *infrastructure* (schema field, selector
badge + lock rendering, premium styling) is fully built but dormant. Rationale: a small
list with visible paywalled rows reads as hollow/user-hostile on a portfolio demo;
keeping it all-free shows a clean working product while leaving monetization a data flip.
Spec C's docs carry the "premium = more satellites + higher limits" narrative; Spec B
adds server-side enforcement.

## Error handling

- Edge Config empty / record missing for a sat → `initialSatellites` entry has `tle:
  null`; selecting it triggers `fetchTle(N)`; if that also fails, `tleStatus = 'error'`
  with a readout message. Globe simply doesn't paint that sat until a TLE arrives.
- `fetchTle(N)` total failure → status error, seed (if any) remains; no regression.
- Unknown/again-null epoch from a source → `isNewerTle` returns false → seed retained.

## Testing

`node:test` for pure logic (no React harness):
- `fetchTle(noradId)` builds correct per-source URLs for several ids; ISS unchanged.
- Catalog: every entry has the required fields; `tier ∈ {free, premium}`; `defaultMode
  ∈ {visual, radio}`; `resolveSatellite` still resolves id + aliases for all 5.
- Seed→store mapping helper: `initialSatellites` → `satelliteTles` map shape; missing
  records yield `null`, present records map via `recordToTle`.
- `isNewerTle` (existing) covers the refresh-guard path.

Components (`SatellitePanel`, `SatelliteSelector`): typecheck + `next build` + manual
verification, consistent with prior pass-finder work.

## Out of scope (explicitly deferred)

- **Mouse pan/zoom overhaul** — the stated next major work item.
- **Searchable combobox** — selector is built to accept a filter input later; not now.
- **Server-side tier enforcement / API keys / billing** — Spec B.
- **"Track any NORAD id" free-form entry** — possible later via `resolveSatellite`
  synthesizing unknown numeric ids; not now.
- **Discoverability surfaces** (llms.txt, About pane, /mcp route, SKILL.md) — Spec C.

## Files affected

- **Move:** `lib/mcp/catalog.mjs` → `lib/catalog.mjs` (+ enriched schema). Update MCP
  tool/route imports.
- **Modify:** `lib/pass-finder/tle.js` (`fetchTle(noradId)`), `lib/pass-finder-store.ts`
  (selection state + `satelliteTles`), `app/page.tsx` (seed whole catalog →
  `initialSatellites`), `components/PassFinderApp.tsx` (accept + seed
  `initialSatellites`).
- **Add:** `components/passes/SatellitePanel.tsx`, `components/passes/SatelliteSelector.tsx`,
  `lib/pass-finder/satellite-seed.js` (or extend `tle-seed.js`) for the seed→store helper.
- **Remove:** `components/passes/TlePanel.tsx` (and its mount in `PassFinderApp`).
- **Tests:** `test/` additions for the pure modules above.
