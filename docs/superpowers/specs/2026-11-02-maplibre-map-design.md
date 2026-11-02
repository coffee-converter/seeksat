# MapLibre Map Design

**Date:** 2026-11-02
**Status:** Draft, for Aaron's review
**Parent spec:** `docs/superpowers/specs/2026-10-30-any-satellite-tracker-design.md`

## Why

The home and satellite-page map is drawn by hand on a `<canvas>` with d3-geo, using its own land outline, place list and label placement. Aaron's verdict: "I'd like a nice style to our map, not homegrown labels that look bad."

A real cartographic basemap, with labels placed by a map engine, looks better and costs us less code to maintain than our label picker.

On 2026-11-02 Aaron compared 11 basemap styles on a local comparison page. He picked OpenFreeMap Positron, OpenFreeMap Dark and CARTO Dark Matter, then made these decisions:
- **Dark theme:** OpenFreeMap Dark, restyled by us to look like CARTO Dark Matter. CARTO's licence only allows free non-commercial use.
- **Views:** a flat map plus a globe, with globe buttons for On you, On the satellite, North pole and South pole. Lat/lon grid and Winkel tripel go away.
- **Tiles:** load from OpenFreeMap's servers, and say so in the privacy text. No self-hosting.

## Goals

1. The map uses MapLibre GL JS with OpenFreeMap vector tiles:
   - light theme: our copy of OpenFreeMap **Positron**;
   - dark theme: our copy of OpenFreeMap **Dark**, recoloured to match CARTO Dark Matter (muted grey labels, thin borders, near-black water, slightly lighter land).
2. **Two views:** `Flat` (Mercator) and `Globe`. Globe has four camera presets: `On you`, `On the satellite`, `North pole` and `South pole`.
3. **Every overlay** the canvas map draws today survives, with the same meaning and the same legend text. The full list is in "What must survive".
4. The bespoke place and label machinery is deleted.
5. **Load cost:** MapLibre loads lazily, so the first paint of the home page and satellite pages is no heavier than today.

## Non-goals

- Self-hosted tiles, satellite imagery, terrain or 3D buildings.
- New overlays: no ground station markers, coverage heatmaps or multiple footprints.
- A "view from the satellite" camera that matches the old `geoSatellite` projection exactly. The `On the satellite` preset on the globe replaces it.
- Changing the sky chart, radio chart, live view, pass card plots or OG images. None of them use lib/map drawing.

## Anti-goals

These would count as failure even if everything else works:
- Basemap labels covering satellite dots or names. Our overlays always win collisions.
- Map tiles or styles loading from any origin except OpenFreeMap, and fonts or sprites from any origin except OpenFreeMap. No API keys.
- Any call to CelesTrak from the browser or from Aaron's laptop.
- A blank rectangle with no explanation when WebGL is unavailable.
- Scrolling the page past the map getting stuck in map zoom on phones or in the stacked (non-docked) layout.

## Constraints

- **Library:** `maplibre-gl` 6.x, pinned to an exact version at least two weeks old (6.15.0 as of 2026-11-02). Globe projection has been in MapLibre since v5.
  - It is loaded with a dynamic `import()` inside the map component.
  - `test/bundle-split.test.mjs` gains a check that no entry chunk reaches `maplibre-gl` statically.
- **Tile origin:** `https://tiles.openfreemap.org` serves the vector source (`/planet`), glyphs and sprites.
  - Add it to `CONNECT_ORIGINS` and to `img-src` in the CSP. `test/csp.test.mjs` must pass.
  - MapLibre's worker runs from a `blob:` URL, which `worker-src blob:` already allows.
  - If the production CSP blocks anything MapLibre needs (such as `unsafe-eval`), use MapLibre's CSP build rather than loosening the policy.
- **Styles:** both styles are vendored as JSON in the repo, under `lib/map/styles/positron.json` and `lib/map/styles/dark.json`.
  - They point at the OpenFreeMap source, glyphs and sprites.
  - We do not fetch `tiles.openfreemap.org/styles/*` at runtime. That way a change on their side can't restyle our map, and we can recolour freely.
- **Attribution:** MapLibre's compact attribution control is kept: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap". The OpenStreetMap licence and OpenFreeMap's terms require it.
- **Privacy text:** the About section says that map tiles load from OpenFreeMap, which therefore sees which part of the map is being viewed. Copy is plain, with no em dashes.
- **Satellite colours:** `SAT_PALETTES` stays, and its test is re-pointed:
  - every satellite colour must be at least 3:1 against both the water and the land colour of its theme's style;
  - pairwise distance stays at OKLab ≥ 12.5.
  - If a colour fails against the new basemap, re-step that colour; do not lower the bar.
- **Tokens:** the `--map-*` CSS tokens in `app/globals.css` are re-tuned to the new styles' water and land colours, so the map shell, the legend swatches and `OrbitDiagram` stay in step.
- **Copy:** plain language, no em dashes.
- **Tests and commits:** `npm test` and `npx tsc --noEmit`. Conventional commits, no AI attribution lines.

## What must survive

These come from the inventory of today's map (`components/home/FlatMap.tsx`, `lib/map/*`).

### Overlays

Our overlays sit above all basemap layers, from bottom to top in this order:

1. **Night shading.**
   - Four nested night regions at sun altitude 0°, -6°, -12° and -18°, each filled once with the night colour, so deeper night is darker.
   - Recomputed every 60 s.
   - These regions contain a pole and can span the antimeridian. They must be valid GeoJSON that MapLibre fills correctly in both Mercator and globe; a raw `geoCircle` ring does not.
   - **Fix:** a new pure function in `geometry.mjs` turns a `geoCircle` ring into MapLibre-ready polygons. It cuts the ring at the antimeridian, closes it over a pole when the ring contains one, and orders the winding the way MapLibre expects.
   - The overlay builders pass `nightBands` and `footprintFeature` output through it. Those two functions keep returning `geoCircle` rings until the canvas map is deleted.
   - d3-geo stays.
   - The `map-geometry` tests gain cases for a ring around a pole and a ring across 180°.
2. **Footprint,** for the focus satellite only, using the `minElevDeg` pref:
   - fill in the satellite colour at about 0.18 opacity;
   - a dashed 1.5 px outline.
   - It must also render correctly when it crosses the antimeridian or contains a pole (a high-orbit satellite).
3. **Tracks,** for focus and normal satellites only:
   - **Past:** a quarter orbit (GEO: -12 h), dashed, at 0.5 opacity, 1.5 px.
   - **Future:** one orbit (GEO: +12 h), in 8 consecutive chunks whose opacity falls from 1 to 0.25, 2 px.
   - The tracks are already cut at the antimeridian by `splitTrack`.
4. **Direction chevron** near the start of the future track.
5. **Time ticks:** a short dash across the track at each tick, every 10 min (period under 3 h) or every hour.
   - Only the focus satellite's first two ticks are labelled `+10m` / `+1h`.
   - Chevron and ticks are skipped when the future track is under 16 px on screen (GEO).
6. **Observer:** a ring and crosshair in the observer colour.
7. **Satellite dots:**
   - **Normal:** radius 4. **Focus:** radius 5. Both have a 2 px ring in the water colour.
   - **Ghost:** radius 3, at 0.35 opacity, with no ring, name or track.
   - **Hidden:** not drawn.
   - Dots are drawn as symbol icons, not circle layers, so they take part in label collision:
     - each icon is a filled circle with its ring;
     - icons overlap each other freely, and never hide.
   - **Collision rule:** a basemap label is hidden where it would touch a satellite dot or name. It is never drawn on top of one, and never drawn underneath one.
8. **Satellite names,** in 11 px, weight 600, in the satellite colour, with a halo.
   - A name may sit right or left of its dot (variable anchor), replacing the old 90 px flip rule.
   - A name may be dropped only if it collides with another satellite's name. A dot is never dropped.

Positions update every second (`useMapSats` is unchanged), via `setData` on the GeoJSON sources. Tracks are recomputed every 60 s as today.

### Legend

- `legendItems` and its copy stay, with one change: the projection-specific wording is gone.
- The legend toggle behaves as today: always open below the map under 1100 px, and a toggle when docked.

### Interactions

- **Tap or click a dot** (ghosts included; hidden satellites excluded) calls `onSelect(noradId)`.
  - The hit radius is about 22 px, done with `queryRenderedFeatures` on a box around the point.
- **Gestures:** pan, zoom and pinch use MapLibre's handlers.
  - In the stacked layout (under 1100 px, not full screen, not zoomed in), a plain wheel or one-finger drag must scroll the page, not move the map. MapLibre's `cooperativeGestures` is the expected tool; the builder confirms it in a phone screenshot check.
  - Docked or full screen, the map captures gestures as today.
- **Buttons:** `+`, `−`, `Reset view` and Full screen stay. They keep our styling and today's full-screen code, including the CSS fallback.
  - Double-click uses MapLibre's default, which zooms in (my call; it used to reset). `Reset view` remains.
- **View control:** a `<select aria-label="Map view">` with `Flat` and `Globe` replaces the projection menu.
  - In Globe, four buttons appear: `On you` (disabled without an observer), `On the satellite` (disabled without a focus), `North pole` and `South pole`.
  - `On the satellite` keeps the globe centred on the moving satellite every second until the user pans (my call: this is the closest to the old "From the satellite" view).
  - The other presets move the camera once.
- **Home view:**
  - Flat: the whole world in longitude, roughly 60°S to 75°N, centred on the focus longitude, else the observer's, else 0.
  - Globe: centred on the observer, else the focus, else 0°, 20°N.
  - Entering a focus re-centres on it and keeps the zoom, as today.
- **Reduced motion:** camera moves jump instead of easing when `prefers-reduced-motion: reduce` is set.
- **Theme:** switching theme swaps the style, and the overlays are re-added once the new style loads. The current camera is kept.
- **Resize:** the map follows its container, as MapLibre does by default.

### Preferences

- The `projection` pref keeps its key, and its values become `flat` or `globe`.
- Globe presets are camera moves, not saved state:
  - They live inside FlatMap, so the props contract is unchanged.
  - A reload opens the globe at its home view.
  - `Reset view` returns to the home view and stops `On the satellite` following.
- Old saved values migrate on read in `lib/home/prefs.mjs`:
  - `equirectangular` and `winkel3` become `flat`;
  - `azimuthal`, `polar-north`, `polar-south` and `satellite` become `globe`;
  - anything else falls back to `flat`.

  The globe's home view is centred on the observer, which matches the old "Centered on you" view (my call).

### Accessibility

- The map keeps `role="img"`, an accessible name, and the screen-reader table "Current satellite positions".
- The new buttons have visible text.
- MapLibre's own keyboard handlers (arrows, +/-) are a bonus: the canvas gets `tabindex="0"` and a visible focus outline.

### Failure states

- **No WebGL** (MapLibre's `supported` check fails, or map creation throws): the map area shows "This browser can't draw the map. Passes and charts still work."
- **Tiles fail to load:** the overlays still draw on the water colour. Nothing else is needed.
- **Loading:** until the library and style load, the map area shows the theme's water colour, with no spinner.

### Print

Unchanged: the map is hidden in print.

## What gets deleted

- `lib/map/labels.mjs`, `lib/map/label-cache.mjs`, `lib/map/places.json`, `lib/map/regions.mjs` and `lib/map/visible.mjs`, with their tests.
- Most of `lib/map/draw.mjs` (canvas drawing and `hitTest`).
  - `SAT_PALETTES`, `SAT_PALETTE` and `emphasisOf` move to a small `lib/map/palette.mjs`, which HomeApp, SatApp, useMapSats and OrbitDiagram already need.
  - Whatever else is still used moves with them.
- `lib/map/projections.mjs`, replaced by a small view module that keeps the `PROJECTIONS` and `DEFAULT_PROJECTION` exports, which `prefs.mjs` imports.
- The `d3-geo-projection`, `world-atlas` and `topojson-client` dependencies, if nothing else uses them. `d3-geo` stays if `OrbitDiagram` or the geometry helpers use it.
- The graticule and lat/lon edge labels. A real basemap doesn't need them (my call).

## Kept as is

- `lib/map/geometry.mjs`: `subpoint`, `splitTrack`, `footprintFeature`, `tickStepMin` and the night-band maths. The passes engine test imports `subpoint`.
- `lib/map/legend.mjs`, `useMapSats.ts`, and the FlatMap props contract (`sats`, `observer`, `projectionId`, `selectedId`, `minElevDeg`, `selectedSub`, `top`, `chips`, `fill`, `onProjectionChange` and `onSelect`).
- The component file may keep the name `FlatMap.tsx` to limit churn.

## Left to the builder

- **Sources and layers:** how overlays map to MapLibre sources and layers. One source per kind, with data-driven paint from feature properties, is the expected shape.
- **Chevron and tick marks:** whether they are SDF icons, or symbol layers rotated by a bearing property.
- **Exact colours** of the restyled dark style, tuned by eye against the Dark Matter card in the comparison page and within the contrast rule above.
- **MapLibre's exact pinned version,** and whether to use its CSP build.
- **Dropping the camera centre** at very high zoom on the globe: whatever MapLibre's defaults allow.

## Review focus for the plan

1. Night and footprint polygons across the antimeridian and over a pole, in both views.
2. Page scrolling on phones past the map.
3. Overlays re-added after a theme swap, with no duplicated sources and no lost focus.
4. Old `projection` prefs migrating without a crash.
5. The CSP in production: no blocked tile, glyph, sprite or worker requests.

## Reference

- Style comparison page, kept outside the repo: `/private/tmp/claude-501/-Users-aaron-work/43ed1f7f-2350-4934-a11b-ef9b444d0e87/scratchpad/map-styles/index.html`.
- Screenshots: `.../scratchpad/qa/styles-merc.png` and `.../scratchpad/qa/styles-globe.png`.
