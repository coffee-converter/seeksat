# Map and Satellite Page Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The flat map becomes easier to read and to use:
- a full-screen toggle;
- city labels whose number follows the view and zoom;
- lat/lon labels neatly on the map edges;
- at least one reference label on every map, including a "from the satellite" view of open ocean;
- a ground track and a footprint that look clearly different, with the footprint less grey.

**Architecture:**
- **Place data:** cities come from Natural Earth's populated places (public domain), reduced by a build script to a small ranked JSON file that loads lazily after first paint.
- **Hand-made regions:** continent, ocean and sea label points live in a hand-written module.
- **Label logic:** choosing which labels fit is a pure function of the projection, canvas size and zoom, with greedy collision rejection by rank.
- **Recompute only on view change:** labels are recomputed only when the view changes, not every second.

**Tech Stack:** d3-geo (existing), canvas 2D, Fullscreen API with a CSS fallback, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-30-any-satellite-tracker-design.md`, sections 6.2 and 6.2a (flat map, projections). These requests were added by Aaron on 2026-11-01:

> maps need a way to toggle them to full screen - also maybe a dynamic lat/lon and city label system - just the right amount of cities for reference depending on view and zoom ... the view from satellite is really cool, though some are small bits of earth - often over pacific, antarctica, etc. would love if lat lon lines are labeled neatly on map edges, and all maps get at least one reference label (city, continent name, ocean name, something). the maps also need some visual differences between the ground track line, and the footprint defining line (also maybe a hair too grayed out in the footprints?

Plans 1 to 5 come first.

## Global Constraints

- **Weight:** the place data never loads with the first paint of `/` or `/sat/*`. It comes in with a dynamic `import()` after mount. `test/bundle-split.test.mjs` must keep passing.
- **Network:** no new external origins at run time. The Natural Earth download happens once, at build-script time, on a developer machine. It comes from GitHub, never CelesTrak.
- **Phone-friendly:** labels stay legible at 360 px wide, and full screen works on iPhone Safari, which has no element Fullscreen API, through the CSS fallback.
- **Look:** dark theme. Labels are quieter than satellites: satellite dots and names always draw on top.
- **Copy:** plain language, no em dashes. Quoted copy is exact.
- **Tests and commits:** `npm test`, `npx tsc --noEmit`. Conventional commit prefixes, no AI attribution lines.

## Review Focus

1. **"From the satellite" over open ocean or Antarctica.** The view must still show a reference label (an ocean or continent name). Pinned in Task 2.
2. **Labels piling up** at any zoom or projection, or running off the canvas. Pinned in Task 2 (no overlaps, all inside the canvas).
3. **Antimeridian and pole label edge cases:** 180° shows once, not as "180°E" and "180°W" side by side, and the poles get no meridian labels. Pinned in Task 2.
4. **Leaving full screen** with Esc, the button or the browser's back gesture. The map refits to its normal size and the page scroll is restored. A browser is needed for this, so it is Task 4's manual check.
5. **Redraw cost:** label picking must not run every second. Pinned in Task 4 by memoising on the view key, and checked by a test that counts `pickLabels` calls.

---

### Task 1: Place data

**Files:**
- Create: `scripts/build-places.mjs`, `lib/map/places.json` (generated, committed), `lib/map/regions.mjs`, `test/map-places.test.mjs`

**Interfaces:**
- `scripts/build-places.mjs <input.geojson>`:
  - Its input is Natural Earth `ne_50m_populated_places_simple.geojson`. Download it with `curl -L -o "$SCRATCH/places.geojson" https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_populated_places_simple.geojson`, keeping the raw file out of the repo.
  - It writes `lib/map/places.json` as `[[name, latDeg, lonDeg, rank], ...]`, sorted by rank and then by population, descending.
  - `rank` is the integer `min_zoom` field, falling back to `scalerank` when absent. Lower means more important.
  - Coordinates are rounded to 2 decimals. Names use `name` (ASCII-safe).
  - It keeps every place with rank ≤ 7. The target is under 60 KB raw.
- `lib/map/regions.mjs` exports `REGIONS: Array<{ name, kind: 'continent' | 'ocean' | 'sea', rank, points: [lonDeg, latDeg][] }>`, hand-written:
  - The 7 continents: `Africa`, `Antarctica`, `Asia`, `Australia`, `Europe`, `North America`, `South America`.
  - 5 oceans:
    - `Pacific Ocean` with label points [-150, 25], [-140, -20], [160, 20], [-120, 0], [170, -35];
    - `Atlantic Ocean` with [-40, 30], [-20, -20], [-50, 5];
    - `Indian Ocean` with [80, -15], [65, -30];
    - `Southern Ocean` with [0, -60], [120, -62], [-120, -62];
    - `Arctic Ocean` with [0, 85], [150, 80].
  - About 14 seas and gulfs, with rank 2: Mediterranean, Caribbean, Gulf of Mexico, Bering, Arabian, Bay of Bengal, South China, Coral, Tasman, Philippine, Sea of Japan, Hudson Bay, Gulf of Alaska and North Sea.
  - Continents and oceans have rank 0. Multiple points exist so a big ocean has a label in any part of it.

- [ ] **Step 1: Write the failing tests:**
  - `places.json` parses, has at least 800 entries, every entry is `[string, number, number, int]` with valid ranges, and London, Tokyo, Chicago and Sydney are present with rank ≤ 2.
  - `REGIONS` holds the 7 continents and 5 oceans, and every point is in range.
- [ ] **Step 2: Download the data, run the script, run the tests.** Expected: PASS. Record the file size and entry count in the report.
- [ ] **Step 3: Commit** with `git commit -m "feat: Add ranked city and region label data for the map"`. Include a line in `README.md` crediting Natural Earth (public domain).

---

### Task 2: Label picking

**Files:**
- Create: `lib/map/labels.mjs`, `test/map-labels.test.mjs`

**Interfaces:**
- Consumes: `makeProjection`, `PROJECTIONS` (`lib/map/projections.mjs`), `isVisible` (`lib/map/draw.mjs`), `REGIONS`, the places array (Task 1).
- Produces:
  - `graticuleStep(zoom) -> 30 | 15 | 10 | 5`: 30 below zoom 2, 15 below 4, 10 below 6, else 5.
  - `formatLat(deg) -> '30°N' | '0°' | '45°S'` and `formatLon(deg) -> '60°W' | '0°' | '180°' | '120°E'`.
  - `graticuleLabels(projection, { width, height, step }) -> Array<{ text, x, y, align: 'left' | 'center' | 'right', baseline }>`:
    1. Sample each meridian (excluding the poles, |lat| ≤ 85) and each parallel (|lat| < 90) every 1°.
    2. Keep the projected points that are visible and inside the canvas inset by 2 px.
    3. Label a parallel at its visible point with the smallest x (the left edge or disc rim). Label a meridian at its visible point with the largest y (the bottom edge or rim).
    4. Nudge the label 4 px inward.
    5. Drop labels whose box would overlap an earlier one. Box width is 6.2 px per character and height is 12 px.
    6. 180° appears once.
  - `pickPlaceLabels(projection, { width, height, zoom, places, regions }) -> Array<{ text, x, y, kind: 'city' | 'region' }>`:
    1. Budget: `maxCities = clamp(round(width * height / 9000 * min(zoom, 4) / 2), 3, 60)`.
    2. Candidates: regions first (points visible, best rank first, at most one point per region), then cities whose rank ≤ `2 + 2 * log2(zoom)`, in file order.
    3. Each label's box comes from the 6.2 px per character estimate plus a 4 px dot for cities. A label is accepted when it is inside the canvas and overlaps no accepted box.
    4. Stop at `maxCities` cities.
    5. **Guarantee:** if nothing was accepted, label the view's centre `projection.invert([width / 2, height / 2])` with the name of the nearest region point by great-circle distance, placed at the canvas centre with kind `region`.
- Tests:
  - Every projection id at 360×240 and at 900×450: no two labels overlap, and all are inside the canvas.
  - `satellite` over [-150, 0] at 420 km and over [0, -80] at 800 km each return ≥ 1 label; the first gives `Pacific Ocean`.
  - City count at zoom 4 is ≥ the count at zoom 1 (equirectangular, 900×450).
  - `formatLon(180)` and `formatLon(-180)` are both `'180°'`, and `graticuleLabels` on equirectangular has exactly one `'180°'`.
  - Graticule labels on `polar-north` include parallels and no meridian label for ±90.

- [ ] **Step 1: Write the failing tests.** **Step 2: Run** `node --test test/map-labels.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat: Pick map labels and edge coordinates that fit the view"`.

---

### Task 3: Drawing: labels, adaptive grid, track vs footprint

**Files:**
- Modify: `lib/map/draw.mjs`, `test/map-draw.test.mjs`, `lib/map/legend.mjs` (if labels change), `app/home.css` (legend swatches)

**Interfaces:**
- `drawMap(ctx, { ..., zoom = 1, labels = null })`:
  - `labels` is `{ places: [...], graticule: [...] }` from Task 2, or null.
  - The graticule uses `geoGraticule().step([s, s])` with `s = graticuleStep(zoom)`, cached per step.
  - Draw order:
    1. ocean
    2. graticule
    3. land
    4. night
    5. graticule labels, at 10 px, colour `rgba(207, 224, 255, 0.55)`, with a 3 px ocean-coloured halo
    6. region labels, at 11 px, uppercase, letter-spaced 1.5 px, colour `rgba(207, 224, 255, 0.35)`
    7. city labels: a 2.5 px dot and 11 px text, colour `rgba(207, 224, 255, 0.75)`, with a halo
    8. footprint
    9. tracks
    10. observer
    11. satellite dots and names
- **Footprint:**
  - fill: the satellite's colour at alpha 0.18;
  - outline: the satellite's colour, 1.5 px, dashed `[6, 5]`;
  - `MAP_COLORS.footprint` is removed.
- **Ground track:** solid, 2 px, the satellite's colour. The part before "now" is drawn at alpha 0.45 and the part from now on at full alpha. `groundTrack`'s MultiLineString is split at the sample nearest `nowMs`, so `MapSat` gains `trackPast` and `trackFuture`. Keep `track` for hit and back-compat or remove it; the report says which.
- **Legend:**
  - The track swatch shows solid then faded.
  - The footprint swatch is a dashed circle in the accent colour.
  - The label copy becomes `"Line: ground track, faded behind the satellite, solid ahead"` and `"Dashed circle: where <name> is at least <minElevDeg>° up"`.
- Tests, using the existing recording-context pattern:
  - The footprint outline calls `setLineDash([6, 5])` and then resets to `[]`.
  - The track past part strokes with alpha 0.45.
  - Labels draw before satellites (order of `fillText` calls).
  - The graticule step changes with zoom.

- [ ] **Step 1: Write the failing tests.** **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat: Draw map labels and an adaptive grid, and tell the track from the footprint"`.

---

### Task 4: Full screen, lazy places, label memo

**Files:**
- Modify: `components/home/FlatMap.tsx`, `components/home/HomeApp.tsx`, `components/sat/SatApp.tsx`, `app/home.css`
- Create: `lib/map/label-cache.mjs`, `test/map-label-cache.test.mjs`

**Interfaces:**
- `createLabelCache(pick = pickPlaceLabels) -> { get(key, args) }`. It returns the cached result while `key` is unchanged. `key` is built from the projection id, width, height, zoom, rounded pan, the observer, and (for the `satellite` view only) the selected subpoint rounded to 0.5°.
  - Test: with an injected `pick` counter, 10 `get` calls with the same key cost 1 pick, and a changed key costs 1 more.
- `FlatMap`:
  - After mount it loads `import('@/lib/map/places.json')` and `REGIONS` once. Until they arrive, only graticule labels draw.
  - Labels and graticule labels go through the cache and are passed to `drawMap` with `zoom`.
  - **Full-screen button:**
    - It sits in the map's control cluster, labelled `⛶`, with `aria-label` `"Full screen"`, and `"Exit full screen"` when active.
    - It wraps the map and legend in `.flat-map-shell`.
    - It calls `shell.requestFullscreen()` when `document.fullscreenEnabled`. Otherwise it toggles the class `.flat-map-shell--full`: `position: fixed; inset: 0; z-index: 1000; background: #0a0e1a`, with the map height set to `calc(100dvh - legend height)` and `overflow: hidden` on `body` while active.
    - Esc exits the fallback, and `fullscreenchange` keeps the state in sync.
    - In full screen, a plain wheel zooms without ctrl or meta, and a one-finger drag pans at any zoom, because there is no page to scroll.
    - The canvas refits through the existing ResizeObserver.
- Footprint and track inputs come from Task 3's `trackPast` / `trackFuture`.

- [ ] **Step 1: Write the failing cache test.** **Step 2: Run.** Expected: FAIL. **Step 3: Implement** the cache, then the component changes.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds. Report First Load JS for `/` and `/sat/[id]`, which should be unchanged within 2 kB, and the size of the places chunk.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add full screen to the map and load place labels lazily"`.
- [ ] **Step 6: Manual check for Aaron** (preview):
  1. **Full screen:** it works on desktop Chrome and on iPhone Safari, Esc and the button exit, and the page scroll comes back.
  2. **Labels:** on every projection at phone width and in full screen, the city count feels right at zoom 1 and grows when zooming in, and lat/lon labels sit on the edges or rim.
  3. **From the satellite:** over the Pacific it shows `PACIFIC OCEAN`.
  4. **Track and footprint:** the footprint is a dashed, tinted circle, and the track fades behind the satellite.

---

### Task 5: Satellite page as a live dashboard

Added 2026-11-01 at Aaron's request:

> the live data changes on pages need some visual flash as they update? current time display should be somewhat prominent... really the detail page is a bit ugly - needs some nice compact live dashboard feel, large data, clearly updating (visual flash etc)

**Files:**
- Create: `components/LiveClock.tsx`, `components/sat/StatTile.tsx`, `lib/ui/use-flash.ts` (hook), `test/sat-dashboard.test.mjs`
- Modify: `components/sat/SatApp.tsx`, `components/sat/LiveNumbers.tsx` (it becomes the tile grid), `components/sat/PassSection.tsx` (an `onNextPass` callback), `lib/sat/numbers.mjs` (`sunlit`, `dashboardValues`), `components/home/HomeApp.tsx` (a compact `LiveClock`), `app/sat.css`, `app/home.css`

**Interfaces:**
- `liveNumbers` gains `sunlit: boolean`, from `satIlluminated(rEcef, sunPositionEcef(date))`.
- `dashboardValues(live, elements) -> Array<{ key, label, value, unit, note }>`. It is pure and formatted with `formatNumber`. Exact rows:

  | key | label | value | unit | note |
  |---|---|---|---|---|
  | altitude | `Altitude` | 1 decimal | `km` | `above the WGS84 ellipsoid` |
  | speed | `Speed` | 3 decimals | `km/s` | `inertial, from SGP4` |
  | groundSpeed | `Ground speed` | 3 decimals | `km/s` | `over Earth's surface` |
  | radius | `From Earth's center` | 1 decimal | `km` | `distance, from SGP4` |
  | lat | `Latitude` | 3 decimals, with N/S | | `below the satellite` |
  | lon | `Longitude` | 3 decimals, with E/W | | `below the satellite` |
  | sun | `Sunlight` | `Sunlit` / `In shadow` | | `Earth's shadow, no refraction` |

  Test: the keys, labels, digits and hemisphere letters for an ISS fixture moment.
- `useFlash(value: string) -> string` returns a class name, `"is-ticking"`, for 700 ms after `value` changes, then `""`. It restarts the CSS animation on every change. No flash on the first render.
- `StatTile({ label, value, unit, note, size = 'md' | 'lg' })`:
  - an uppercase 11 px label;
  - the value in `font-variant-numeric: tabular-nums`, at 30 px on desktop and 24 px under 480 px (`lg`: 40 / 30), with the unit at 0.5 em;
  - the note in 11 px muted text.

  Only the value span carries the flash class.
- CSS flash: `@keyframes tick { from { background: rgba(126,184,255,0.24); color: #fff; } to { background: transparent; } }`, 700 ms ease-out on `.is-ticking`. Under `prefers-reduced-motion: reduce`, there is no animation.
- `LiveClock({ nowMs, timeZone, compact = false })`:
  - UTC `HH:MM:SS` large (28 px; 18 px when compact) with a pulsing green `LIVE` dot, then the local time and the zone abbreviation on a smaller line (`"14:12:07 CST, your time"`).
  - Its first render uses the passed `nowMs`, so it is hydration-safe.
- **Page layout, top to bottom:**
  1. A header row: wordmark, name, `NORAD · designator`, Follow and Share on the left; `LiveClock` on the right (below on phones).
  2. The tile grid (`.sat-dash`): 2 columns under 480 px, 3 from 480, 4 from 720.
     - A `lg` tile `Next pass`: `"in 42 min"`, `"up now, 6 min left"`, `"none in the next 10 days"`, or `"Set your location"`, linking to `#passes`. Its value comes from PassSection's `onNextPass(pass | null)` and the clock.
     - The seven `dashboardValues` tiles.
  3. A wide tile: `"v²r/GM <a> vs 2 − r/a <b>, within <pct>%"`.
  4. Element age with its badge, and a compact two-column table of mean elements (perigee, apogee, period, inclination, eccentricity, semi-major axis).
  5. The map and the orbit diagram side by side from 900 px, stacked below that.
  6. Passes, downlinks and raw elements, as now.
  7. `How we compute these`: every `HOW_WE_COMPUTE` line as visible text, in place of the per-row lines. Tiles carry the short notes above. This keeps the honesty rule: visible text, never tooltips.
- **Home:** a compact `LiveClock` sits beside the wordmark. The "Next up" headline countdown flashes on change with `useFlash`.
- The implementer loads the `frontend-design` skill first and keeps the dark theme, the Exo 2 wordmark and the existing colour tokens.

- [ ] **Step 1: Write the failing tests** for `dashboardValues` and `sunlit` (ISS fixture: sunlit at one fixed moment, in shadow at another; pick the moments from the fixture and assert both). **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the pure parts, then the components and CSS.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds.
- [ ] **Step 5: Screenshot check.**
  - Run `npx next dev -p 3457`. It reads the stored snapshot, never CelesTrak.
  - Capture `/sat/25544` at 390×844 and 1280×800 with Playwright through the system Chrome channel (`/Users/aaron/work/qrz-swapmeet-watch/node_modules/playwright`), plus a second capture 1 s later.
  - View both and fix anything cramped or misaligned. Report the image paths.
- [ ] **Step 6: Commit** with `git commit -m "feat: Turn the satellite page into a live dashboard with ticking values"`.
