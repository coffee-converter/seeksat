# MapLibre Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-drawn canvas map with MapLibre GL JS and OpenFreeMap vector tiles. The map gets:
- a Positron look in light mode;
- a recoloured Dark (Dark Matter look) in dark mode;
- a Flat view and a Globe view with camera presets;
- every overlay the canvas map draws today.

**Architecture:**
- **Pure data in `lib/map/`, all tested with `node --test`:**
  - basemap styles (vendored JSON);
  - overlay GeoJSON builders;
  - layer specs;
  - camera maths;
  - polygon repair for the date line and the poles.
- **The component:** one React component, `components/home/FlatMap.tsx`, rewritten. It keeps its props contract, loads `maplibre-gl` with a dynamic `import()`, adds the overlay sources and layers on every `style.load`, and pushes new GeoJSON with `setData` when props change.
- **Order of tasks:** the canvas code is deleted only after the new map works (Task 6), so every task leaves the app working.

**Tech Stack:** Next.js 15 App Router, React, `maplibre-gl` 6.15.0, d3-geo (`geoCircle`, kept), `node --test`, Playwright (system Chrome) for the screenshot check.

**Spec:** `docs/superpowers/specs/2026-11-02-maplibre-map-design.md`. It is the authority for what must survive; read its "What must survive" section before each task.

## Global Constraints

- **Origins:** tiles, glyphs and sprites come only from `https://tiles.openfreemap.org`. No API keys, and no runtime fetch of `tiles.openfreemap.org/styles/*`.
- **Never call CelesTrak** from the browser or from Aaron's laptop.
- **Attribution:** keep MapLibre's compact attribution control: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap".
- **Satellite colours:** every `SAT_PALETTES` colour must be at least 3:1 against both its theme's water and land colours. Pairwise OKLab distance stays at least 12.5. Re-step a failing colour; never lower the bar.
- **Collisions:** a basemap label is hidden where it would touch a satellite dot or name. Dots never hide.
- **Copy:** plain language, no em dashes.
- **Theme:** colours outside style JSON and token definitions come from CSS tokens; `test/theme-css.test.mjs` enforces this.
- **Tests and commits:** `npm test` and `npx tsc --noEmit`. Conventional commits with no AI attribution lines.

## Review Focus

1. **Night and footprint near the date line and over a pole,** in both views: a night band containing the North Pole, and a GEO footprint centred at 179°E, fill the right area with no stripe or inverted fill. Pinned in Task 2 (`mapPolygons` tests) and checked in Task 7.
2. **Scrolling a phone page past the map:** one finger on the map at home zoom scrolls the page. Checked in Task 7 with touch emulation.
3. **Theme swap:** after light, then dark, then light, each overlay source exists exactly once, the focus and its footprint are still drawn, and the camera has not moved. Pinned in Task 5 (`addOverlays` is idempotent: its test calls it twice) and checked in Task 7.
4. **Old prefs:** every old `projection` value migrates without a crash, and unknown values fall back to `flat`. Pinned in Task 5 (`migrateProjection` table test).
5. **CSP in production:** no blocked tile, glyph, sprite or worker requests under `next start`. Pinned in Task 3 (`csp.test.mjs`) and checked in Task 7 (console has no CSP violations).

---

### Task 1: Move the satellite palette out of the canvas drawer

**Files:**
- Create: `lib/map/palette.mjs`
- Modify:
  - `lib/map/draw.mjs`: re-export from palette.mjs for now;
  - the imports in `components/home/HomeApp.tsx`, `components/sat/SatApp.tsx`, `components/sat/OrbitDiagram.tsx` and `components/home/useMapSats.ts`;
  - `test/map-draw.test.mjs`: move the palette tests to the new test file.
- Create: `test/map-palette.test.mjs`

**Interfaces:**
- **Produces:** `lib/map/palette.mjs` exports `SAT_PALETTE`, `SAT_PALETTES` (unchanged values) and `emphasisOf(s)`.
- **Contrast in this task:** the contrast tests keep their current ocean colours. Task 4 re-points them at the basemap.

- [ ] **Step 1: Write the test.** Create `test/map-palette.test.mjs` by moving the palette contrast, distance and light/dark tests out of `map-draw.test.mjs`, importing from `../lib/map/palette.mjs`.
- [ ] **Step 2: Run** `node --test test/map-palette.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Move the constants and `emphasisOf` into palette.mjs, re-export them from draw.mjs, and point the four importers at palette.mjs.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `refactor: Move the satellite palette into lib/map/palette.mjs`.

---

### Task 2: Polygons MapLibre can fill

**Files:**
- Modify: `lib/map/geometry.mjs`, `test/map-geometry.test.mjs`

**Interfaces:**
- **Produces:** `mapPolygons(ring: Array<[lon, lat]>) -> { type: 'MultiPolygon', coordinates }`.
  - **Input:** a closed spherical ring, as from `geoCircle()().coordinates[0]`.
  - **Output:** polygons in plain lon/lat with every longitude in [-180, 180]:
    - the ring is cut where it crosses the date line;
    - when the ring contains a pole, it is closed along latitude ±90 to that pole;
    - outer rings are counter-clockwise (RFC 7946), which MapLibre fills correctly.
  - **Containing a pole:** the ring's longitudes wind a full 360° (the unwrapped sum of longitude steps is ±360). The pole on the side of the ring's centre is the one it contains.

- [ ] **Step 1: Write the failing tests:**
  - **`mapPolygons leaves a small ring alone`:** a 10° circle at (0, 0) gives one polygon whose points equal the input, up to winding.
  - **`mapPolygons cuts a ring across the date line`:** a 10° circle at (179, 0) gives two polygons. Every longitude is in [-180, 180]. One polygon has max lon 180 and the other min lon -180. Their summed planar area (shoelace, in degrees²) is within 1% of the uncut ring's planar area, unwrapped.
  - **`mapPolygons closes a ring around a pole`:** take the night band from `nightBands(new Date('2026-06-21T12:00:00Z'))[0]`, the June solstice, when the North Pole is lit. Its antisolar circle contains the South Pole. The result contains a vertex at latitude -90, every longitude is in [-180, 180], and it has no vertex at +90.
  - **`mapPolygons winds outer rings counter-clockwise`:** the signed shoelace area of each outer ring is positive.
- [ ] **Step 2: Run** `node --test test/map-geometry.test.mjs`. Expected: FAIL (`mapPolygons` is not exported).
- [ ] **Step 3: Implement** `mapPolygons` in `geometry.mjs`.
  - Unwrap the longitudes and detect the winding sum.
  - Split where the unwrapped longitude crosses a multiple of 360 offset by 180, interpolating latitude at the cut.
  - Close polar rings with points at (±180, ±90).
  - Normalise the winding.
  - `nightBands` and `footprintFeature` are unchanged.
- [ ] **Step 4: Run** `node --test test/map-geometry.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat: Turn spherical rings into polygons MapLibre can fill`.

---

### Task 3: Basemap styles, CSP and the MapLibre dependency

**Files:**
- Create:
  - `lib/map/styles/positron.json`;
  - `lib/map/styles/dark.json`;
  - `lib/map/basemap.mjs`;
  - `test/map-basemap.test.mjs`.
- Modify:
  - `package.json` (`maplibre-gl` exactly `6.15.0`);
  - `lib/site/csp.mjs`;
  - `test/csp.test.mjs` if it pins the origin list;
  - `test/bundle-split.test.mjs`.

**Interfaces:**
- **`basemapStyle(theme: 'light' | 'dark') -> StyleSpecification`:** a fresh deep copy of the vendored JSON on each call, because MapLibre mutates styles.
- **`basemapColors(theme) -> { water: string, land: string }`:** read from the style. `water` is the fill colour of the layer with id `water`, and `land` is the `background` layer's colour. Both are hex.
- **`OPENFREEMAP = 'https://tiles.openfreemap.org'`.**

**Style content:**
- **positron.json** is OpenFreeMap's `positron` style, saved from `https://tiles.openfreemap.org/styles/positron` once, by hand, and committed.
- **dark.json** starts from OpenFreeMap's `dark` style:
  - Remove the `ne2_shaded` raster source and its layer.
  - Recolour toward CARTO Dark Matter, using the comparison screenshot at `/private/tmp/claude-501/-Users-aaron-work/43ed1f7f-2350-4934-a11b-ef9b444d0e87/scratchpad/qa/styles-merc.png` (the "CARTO Dark Matter" card):
    - water about `#0e1116`;
    - land about `#1b1e24`;
    - boundaries `#3a3f48`, at 0.6 px;
    - place labels `#7d838d` with a halo matching the water colour;
    - roads `#24282f`.
  - Exact values are the builder's call, within the contrast rule.
- **Both styles:** layer ids `background` and `water` must exist. The `sprite` and `glyphs` URLs stay on OpenFreeMap.

**CSP:**
- Add `https://tiles.openfreemap.org` to `CONNECT_ORIGINS`, with the comment "map tiles, glyphs, sprites".
- Add it to `img-src` too, because sprites are images.
- `worker-src blob:` is already there.

- [ ] **Step 1: Write the failing tests:**
  - **`basemap styles load only from OpenFreeMap`:** walk every string in both styles. Every `http(s)` URL starts with `https://tiles.openfreemap.org/`.
  - **`basemap styles keep the layers the map relies on`:** both have a `background` and a `water` layer, plus `glyphs` and `sprite`.
  - **`basemapColors reads water and land`:** both themes return 7-character hex strings. Dark water is darker than dark land, by relative luminance.
  - **`basemapStyle returns a fresh copy`:** mutating one result does not change the next.
  - **In `bundle-split.test.mjs`, `${label} does not statically reach maplibre-gl`:** neither entry's `walk(...).packages` includes `maplibre-gl`.
  - **In `test/csp.test.mjs`, `CSP allows OpenFreeMap tiles`:** `buildCsp()` contains `https://tiles.openfreemap.org` in both `connect-src` and `img-src`.
- [ ] **Step 2: Run** `node --test test/map-basemap.test.mjs test/csp.test.mjs test/bundle-split.test.mjs`. Expected: FAIL (module missing, CSP lacks the origin).
- [ ] **Step 3: Implement.** Save and recolour the styles, write `basemap.mjs`, update the CSP, and run `npm install maplibre-gl@6.15.0 --save-exact`.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `feat: Add OpenFreeMap basemap styles and allow their origin`.

---

### Task 4: Overlay data and layer specs

**Files:**
- Create: `lib/map/overlays.mjs`, `test/map-overlays.test.mjs`
- Modify: `test/map-palette.test.mjs` (contrast now against `basemapColors`)

**Interfaces:**
- **Consumes:**
  - `MapSat` (the shape in `components/home/FlatMap.tsx:28`);
  - `mapPolygons` (Task 2);
  - `nightBands` and `footprintFeature` (geometry.mjs);
  - `legendItems` is untouched.
- **Produces, from `overlays.mjs`:**
  - **`OVERLAY_SOURCES`:** `['ss-night', 'ss-footprint', 'ss-track-past', 'ss-track-future', 'ss-marks', 'ss-observer', 'ss-sats']`.
  - **`overlayData({ sats, observer, nightDate, shortTrackIds }) -> { [sourceId]: FeatureCollection }`:**
    - **`ss-night`:** 4 features with `{ band: 0 | -6 | -12 | -18 }`, geometry from `mapPolygons`.
    - **`ss-footprint`:** the focus satellite's footprint, through `mapPolygons`, with `{ color }`. Empty without a focus.
    - **`ss-track-past`:** a LineString or MultiLineString for each focus or normal satellite, with `{ color }`.
    - **`ss-track-future`:** 8 chunk features for each focus or normal satellite. Chunk `i` has `{ color, opacity: 1 - 0.75 * i / 7 }`. The chunks are cut from `trackFuture` by point count, keeping antimeridian splits.
    - **`ss-marks`:** for each focus or normal satellite not in `shortTrackIds`:
      - one `{ kind: 'chevron', bearing, color }` point, 10% of the way along the first future segment;
      - one `{ kind: 'tick', bearing, color, label }` point per `trackTicks` entry. `label` is `+10m` or `+1h` style, and only for the focus satellite's first two ticks; otherwise it is the empty string.
      - Bearings are in degrees clockwise from north, from the neighbouring track points.
    - **`ss-observer`:** one point, or empty.
    - **`ss-sats`:** one point per satellite whose emphasis is not `hidden`, with `{ noradId, name, color, emphasis, sortKey }`, where `sortKey` is ghost 0, normal 1, focus 2. Ghost names are the empty string.
  - **`overlayLayers(colors) -> LayerSpecification[]`,** where `colors = { water, observer, night }`. The order, bottom to top:
    1. `ss-night` (fill; opacity by band, so that stacked bands darken);
    2. `ss-footprint-fill` (0.18 opacity);
    3. `ss-footprint-line` (dashed `[4, 3.3]`, 1.5 px);
    4. `ss-track-past` (dashed `[1.3, 2.7]`, 1.5 px, 0.5 opacity);
    5. `ss-track-future` (2 px, `line-opacity` from `opacity`);
    6. `ss-marks` (a symbol layer with icons `ss-chevron` and `ss-tick`; `icon-rotate` from `bearing`; `icon-rotation-alignment: map`; `icon-color` from `color`; SDF icons; tick `text-field` from `label`, 9 px);
    7. `ss-observer` (symbol icon `ss-observer`);
    8. `ss-sats` (symbol layer):
       - `icon-image` from emphasis: `ss-dot-focus`, `ss-dot` or `ss-dot-ghost`;
       - `icon-allow-overlap: true`, `icon-ignore-placement: false`;
       - `text-field` from `name`, `text-variable-anchor: ['left', 'right']` (left anchor first, so the name sits right of the dot), `text-radial-offset` about 0.8;
       - text 11 px, in the satellite colour, with a halo in the water colour;
       - `text-optional: true`;
       - `symbol-sort-key` from `sortKey`, so the focus places first.
  - **`overlayImages(colors) -> Array<{ id, width, height, data: Uint8ClampedArray, sdf: boolean }>`:**
    - `ss-chevron` and `ss-tick` are SDF, coloured per feature.
    - `ss-dot`, `ss-dot-focus` and `ss-dot-ghost` are white SDF discs. Their ring comes from `icon-halo-color` (the water colour) with `icon-halo-width` 2, and the fill colour from `icon-color`.
    - `ss-observer` is a ring with a crosshair in `colors.observer`, not SDF.
    - Images are drawn on an `OffscreenCanvas` when available, otherwise pre-rasterised by hand. The builder's call, but the function must run under `node --test`, so rasterise in plain JS.
  - **Ghost opacity:** 0.35, through `icon-opacity` keyed on `emphasis`.

- [ ] **Step 1: Write the failing tests:**
  - **`overlayData builds every source`:** all 7 keys are present, each a FeatureCollection.
  - **`hidden satellites are not drawn and ghosts have no track`:**
    - a hidden satellite is in no source;
    - a ghost is in `ss-sats` with name `''` and is absent from the track and mark sources.
  - **`future track fades over 8 chunks`:** the focus satellite has 8 `ss-track-future` features. Opacity is 1 at chunk 0 and 0.25 at chunk 7, falling at every step.
  - **`marks skip short tracks`:** with the focus id in `shortTrackIds`, `ss-marks` has no feature for it.
  - **`only the focus gets tick labels, and only two`:** the focus has 2 non-empty labels. Normal satellites have none.
  - **`footprint only for the focus`:** with no focus, `ss-footprint` is empty.
  - **`night and footprint use repaired polygons`:** every coordinate in `ss-night` and `ss-footprint` has a longitude in [-180, 180].
  - **`overlayLayers keeps the overlay order`:** the ids, in order, match the list above. Every layer's source is in `OVERLAY_SOURCES`.
  - **`overlayImages draws every icon the layers name`:** each `icon-image` value found in the layers has an image, with `data.length === width * height * 4`.
  - **In `map-palette.test.mjs`:** the contrast tests now use `basemapColors(theme).water` and `.land`, with ratio ≥ 3. If a colour fails, re-step that `SAT_PALETTES` slot and keep the OKLab distance test passing.
- [ ] **Step 2: Run** `node --test test/map-overlays.test.mjs test/map-palette.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `overlays.mjs`, and re-step palette slots if needed.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `feat: Build map overlays as GeoJSON and MapLibre layers`.

---

### Task 5: The MapLibre map (flat view)

**Files:**
- Create:
  - `lib/map/view.mjs`, `test/map-view.test.mjs`;
  - `lib/map/maplibre-overlays.mjs`, `test/map-maplibre-overlays.test.mjs`.
- Modify:
  - `components/home/FlatMap.tsx` (rewritten);
  - `lib/home/prefs.mjs` and its test;
  - `app/home.css` (map controls, no-WebGL message);
  - `components/home/AboutSection.tsx` (privacy line).

**Interfaces:**
- **`view.mjs`:**
  - **`PROJECTIONS`:** `[{ id: 'flat', label: 'Flat' }, { id: 'globe', label: 'Globe' }]`.
  - **`DEFAULT_PROJECTION = 'flat'`.**
  - **`migrateProjection(v) -> 'flat' | 'globe'`:** per the spec's table: `equirectangular` and `winkel3` give `flat`; `azimuthal`, `polar-north`, `polar-south` and `satellite` give `globe`; `flat` and `globe` pass through; anything else gives `flat`.
  - **`homeCamera(view, { observer, focus, width, height }) -> { center: [lon, lat], zoom }`:**
    - **Flat:** centre longitude is the focus's, else the observer's, else 0, at latitude 20. Zoom fits 360° of longitude into `width`, using `log2(width / 512)` for 512 px tiles, and no less than the zoom that fills `height` between 60°S and 75°N.
    - **Globe:** centre on the observer, else the focus, else (0, 20). Zoom is `log2(min(width, height) / 512) + 0.6`, chosen so the disc fits with a margin; the builder tunes this by eye and pins it in a test.
  - **`presetCamera(preset, { observer, focus }) -> { center, zoom: null } | null`:**
    - `you`: the observer (null without one);
    - `sat`: the focus subpoint (null without one);
    - `north`: (0, 90);
    - `south`: (0, -90).
    - A null zoom means keep the current zoom.
- **`maplibre-overlays.mjs`:** `addOverlays(map, { images, layers, data })`.
  - It adds each image, source and layer only if `map.hasImage`, `map.getSource` or `map.getLayer` says it is missing. Otherwise it calls `setData` on existing sources. It is safe to call on every `style.load`.
  - It is tested with a small fake map object that records calls: calling it twice adds each source once and calls `setData` the second time.
- **`prefs.mjs`:** imports from `view.mjs` and stores `migrateProjection(v.projection)`.

**FlatMap behaviour:**
- **Keeps:** the same props and exports (`MapSat`, `MapObserver`, `SelectedSub`, `Emphasis`), the legend block, the screen-reader positions table, the chips and top slots, the zoom buttons, `Reset view`, the full-screen code with its CSS fallback, and the docked legend toggle.
- **Library loading:** `import("maplibre-gl")` and its CSS (`maplibre-gl/dist/maplibre-gl.css`) load inside an effect.
  - Before they arrive, show the container with `background: var(--map-ocean)`.
  - If `maplibregl.supported?.()` is false, or `new Map` throws, show `<p className="flat-map__nogl">This browser can't draw the map. Passes and charts still work.</p>`.
- **Map options:**
  - `style: basemapStyle(theme)`;
  - `attributionControl: { compact: true }`;
  - `renderWorldCopies: true`;
  - `dragRotate: false`, `pitchWithRotate: false`, `touchPitch: false`;
  - `maxZoom: 8` (5 on the globe is fine);
  - `cooperativeGestures` set to true when not docked (`DOCKED_QUERY`) and not full screen, and switched with `map.cooperativeGestures.enable()` or `.disable()` when either changes.
- **On every `style.load`:** call `addOverlays` with `overlayImages(colorsFor(theme))`, `overlayLayers(...)` and the current `overlayData(...)`. Then apply the projection: `map.setProjection({ type: projectionId === 'globe' ? 'globe' : 'mercator' })`.
- **Props change:** push new data with `setData` on each source.
  - Night is recomputed at most every 60 s, as today.
  - `shortTrackIds` holds satellites whose projected `trackFuture` bounding box is under 16 px on both axes, computed with `map.project`.
- **Theme change:** on the `seeksat:theme` event, call `map.setStyle(basemapStyle(next), { diff: false })`. `style.load` re-adds the overlays, and the camera is untouched.
- **Click or tap:** `map.queryRenderedFeatures([[x - 22, y - 22], [x + 22, y + 22]], { layers: ['ss-sats'] })`. Pick the feature closest to the point and call `onSelect(noradId)`. Hidden satellites are never in the layer.
- **Focus entered:** `easeTo({ center: [lon, lat], zoom: current })` once, when `selectedId` changes and the satellite has a position. With reduced motion, use `jumpTo`.
- **Reset view:** `easeTo(homeCamera(...))`, or `jumpTo` with reduced motion.
- **View select:** `<select aria-label="Map view">` with `PROJECTIONS`. A change calls `onProjectionChange(id)`.
- **Canvas:** `role="img"`, `aria-label="Map of followed satellites"` and `tabIndex={0}` on the MapLibre canvas, plus a visible `:focus-visible` outline in home.css.
- **Legend copy:** drop any projection-specific wording, if any exists. `legendItems` already has none.
- **About:** after "Your location and the satellites you follow stay on this device.", add "Map tiles load from OpenFreeMap, which sees which part of the map you are viewing."

- [ ] **Step 1: Write the failing tests:**
  - **`migrateProjection maps every old value`:** the full table, plus `undefined` and `'nonsense'` giving `flat`.
  - **`homeCamera flat centres on the focus, then the observer`:** a focus at lon 100 gives a centre lon of 100. With no focus, the observer at -88 gives -88. With neither, 0.
  - **`homeCamera flat shows the whole world across`:** at width 1024, zoom is at most `log2(1024 / 512)`.
  - **`presetCamera needs an observer or a focus`:** `you` without an observer gives null, `sat` without a focus gives null, and `north` gives center [0, 90].
  - **`addOverlays is safe to call twice`:** with the fake map, sources and layers are added once each, and the second call's `setData` count equals the source count.
  - **In the prefs test, `old projection prefs migrate`:** `parsePrefs(JSON.stringify({ projection: 'polar-north' }))` gives `projection: 'globe'`.
- [ ] **Step 2: Run** `node --test test/map-view.test.mjs test/map-maplibre-overlays.test.mjs test/home-prefs.test.mjs`. Expected: FAIL. (Use the prefs test file's real name.)
- [ ] **Step 3: Implement** `view.mjs`, `maplibre-overlays.mjs`, the prefs change, the FlatMap rewrite (flat view only; the globe preset buttons come in Task 6), the CSS and the About line.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds. Old canvas-map tests may still pass, because their modules still exist.
- [ ] **Step 5: Commit** with `feat: Draw the map with MapLibre and OpenFreeMap tiles`.

---

### Task 6: Globe presets, then delete the canvas map

**Files:**
- Modify:
  - `components/home/FlatMap.tsx`;
  - `app/home.css`;
  - `package.json` (remove `d3-geo-projection`, `world-atlas` and `topojson-client` if nothing else imports them; check with `grep -r`).
- Delete:
  - `lib/map/draw.mjs`, `lib/map/labels.mjs`, `lib/map/label-cache.mjs`, `lib/map/places.json`, `lib/map/regions.mjs`, `lib/map/visible.mjs` and `lib/map/projections.mjs`;
  - `test/map-draw.test.mjs`, `test/map-labels.test.mjs`, `test/map-label-cache.test.mjs`, `test/map-places.test.mjs` and `test/map-projections.test.mjs`;
  - `loadLand`, and its test in `map-geometry.test.mjs`;
  - the "place data" check in `bundle-split.test.mjs`.

**Globe presets:**
- When the view is `globe`, a button group appears with the label "Globe camera" and the buttons `On you`, `On the satellite`, `North pole` and `South pole`.
  - `On you` is disabled without an observer, and `On the satellite` without a focus.
  - Each button calls `easeTo(presetCamera(...))`, or `jumpTo` with reduced motion.
- **`On the satellite` follows:**
  - It sets a `following` ref, and each props update re-centres on the focus subpoint with `jumpTo` (no easing).
  - A user `dragstart`, `zoomstart` from a wheel or touch, `Reset view`, another preset, or the focus changing all clear it.
  - Tell user gestures from our own camera moves with `e.originalEvent`.
  - The button shows `aria-pressed` while following.
- **Keyboard:** MapLibre's keyboard handler stays enabled.

- [ ] **Step 1: Delete** the files listed, then run `grep -rn "map/draw\|map/labels\|label-cache\|places.json\|map/regions\|map/visible\|map/projections\|world-atlas\|topojson\|d3-geo-projection" app components lib test`. Expected: no matches. Remove whatever remains.
- [ ] **Step 2: Add** the preset buttons and the follow logic.
- [ ] **Step 3: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds.
- [ ] **Step 4: Commit** with `feat: Add globe camera presets and remove the canvas map`.

---

### Task 7: Tokens and the screenshot check

**Files:**
- Modify: `app/globals.css` (the `--map-*` tokens), plus any fixes found.

**Tokens:**
- Set `--map-ocean` and `--map-land` per theme to `basemapColors(theme)`.
- Re-tune `--map-border`, `--map-muted` and `--map-text` so the legend and the map shell sit well on the new basemaps.
- `test/theme-css.test.mjs` must pass.

- [ ] **Step 1: Update the tokens,** then run `npm test`. Expected: PASS.
- [ ] **Step 2: Do the screenshot check** with `npm run build` and `npx next start -p 3461`. Use Playwright with system Chrome, ISS and RADFXSAT followed, and Chicago as the location.
  - **Captures:** `/` and `/sat/25544` at 360, 390 and 1440 px, in light and dark, in both Flat and Globe.
  - **The console has no CSP violations and no MapLibre errors.**
  - **Overlays and collisions:**
    - dots, names, tracks, ticks, the footprint, night and the observer are all visible;
    - no basemap label overlaps a satellite name.
  - **Theme toggle:** dark, light, dark. The focus footprint is still drawn, and `map.getStyle().sources` has each `ss-` source once.
  - **Globe:** `North pole` shows the pole, and `On the satellite` keeps the ISS centred across 3 s.
  - **Phone scrolling:** at 390 px with touch emulation, a one-finger vertical swipe starting on the map scrolls the page.
  - **No WebGL:** launch with `--disable-gpu --disable-software-rasterizer` (or stub `maplibregl.supported`). The no-WebGL message shows.
  - **Polar band:** in November the night side holds the North Pole, so the night band must cover the Arctic with no stripe at 180°. A fake clock does not help here: `trueNow()` follows server time.
- [ ] **Step 3: Fix** anything found, rerun the check, and commit any fixes with `fix:` messages. Commit the tokens with `style: Match map tokens to the new basemaps`.
