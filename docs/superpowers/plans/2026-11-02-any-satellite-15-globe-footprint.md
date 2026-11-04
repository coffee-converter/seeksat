# Globe Footprint Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the globe, draw the focus footprint's fill as a true spherical cap with a MapLibre custom WebGL layer, so it no longer loses a slice near the poles.

**Architecture:**
- **`lib/map/cap-mesh.mjs`:** a pure, tested mesh builder.
- **`lib/map/footprint-layer.mjs`:** the custom layer, using WebGL2 and MapLibre's `projectTile` prelude.
- **FlatMap** shows either the custom layer (globe view) or the GeoJSON fill (Mercator), never both.

**Tech Stack:** MapLibre GL 6.15 custom layers, WebGL2, `node --test`, Playwright (system Chrome).

**Spec:** `docs/superpowers/specs/2026-11-02-globe-footprint-layer-design.md`.

## Global Constraints

- No new dependencies. Never call CelesTrak.
- Mercator rendering, the edge line, the tracks and night shading are unchanged.
- The fill opacity comes from `FOOTPRINT_FILL_OPACITY` in `lib/map/overlays.mjs`.
- Tests and commits: `npm test` and `npx tsc --noEmit`. Conventional commits, with no AI attribution lines.

## Review Focus

See the spec's "Review focus". Each item is checked in Task 2's screenshot check, and item 4 by code review.

---

### Task 1: Cap mesh

**Files:**
- Create: `lib/map/cap-mesh.mjs`, `test/map-cap-mesh.test.mjs`

**Interfaces:**
- **`capMesh([lon, lat], radiusDeg, { rings = 12, segments = 120 } = {}) -> { positions: Float32Array, indices: Uint16Array }`:**
  - `positions` holds (x, y) Web Mercator world coordinates.
  - x is `(lon + 180) / 360`, with lon unwrapped continuously from the centre.
  - y is `0.5 - ln(tan(π/4 + φ/2)) / (2π)`, with |lat| clamped to 89.9.
- **`mercToLonLat(x, y) -> [lon, lat]`:** exported for tests.

- [ ] **Step 1: Write the failing tests:**
  - **Counts:** vertex count `1 + rings * segments`; triangle count `segments + 2 * segments * (rings - 1)`; every index below the vertex count.
  - **Outer ring:** every outer-ring vertex, mapped back with `mercToLonLat`, lies within 0.05° of `radiusDeg` great-circle distance from the centre. Check this for a cap at (0, 0) r 20, and at (-40, 78) r 18, which contains the pole.
  - **No mercator blow-up:** for the (-40, 78) r 18 cap and a (-40, 70) r 18 cap (reaches past 85°, misses the pole), every y is finite, and every lat after mapping back is at most 89.9.
  - **Date line:** a cap at (179, 0) r 10 has continuous x (no jump over 0.5 between neighbouring ring vertices).
- [ ] **Step 2: Run** `node --test test/map-cap-mesh.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `feat: Build spherical cap meshes for globe footprints`.

---

### Task 2: Custom layer and FlatMap wiring

**Files:**
- Create: `lib/map/footprint-layer.mjs`
- Modify:
  - `lib/map/maplibre-overlays.mjs` (add the custom layer idempotently on `style.load`);
  - `components/home/FlatMap.tsx`;
  - `lib/map/overlays.mjs` (export the fill opacity if needed);
  - `test/map-maplibre-overlays.test.mjs`.

**Interfaces:**
- **`createFootprintLayer() -> CustomLayerInterface & { setFootprint(f: { center: [lon, lat], radiusDeg, color } | null): void }`:**
  - id `ss-footprint-globe`, `renderingMode: '2d'`.
  - `onAdd` keeps `map` and `gl`. `render(gl, args)` compiles (cached by `args.shaderData.variantName`), binds the buffers, sets the projection uniforms from `args.defaultProjectionData`, and draws the triangles with premultiplied colour.
  - `onRemove` frees GL resources.
  - On compile failure it logs once and draws nothing.
- **Wiring:**
  - In globe view, `ss-footprint-fill` gets `visibility: none` and the custom layer is present.
  - In Mercator view, the fill is visible and the custom layer draws nothing (or is removed).
  - Switch on the view effect and on `style.load`.
  - Feed `setFootprint` from the focus satellite's subpoint and `footprintRadiusDeg(altKm, minElevDeg)` (from `lib/map/geometry.mjs`), with `useMapSats` as the source of the position and altitude.
- **`addOverlays`:** accepts an optional `custom: CustomLayerInterface[]` and adds each one only if `!map.getLayer(id)`, before `ss-track-past`. Tested with the existing fake map.

- [ ] **Step 1: Write the failing test** in `test/map-maplibre-overlays.test.mjs`: a custom layer is added once across two `addOverlays` calls and sits before `ss-track-past`.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** the layer and the wiring. Read MapLibre 6.15's source for the uniform names its globe prelude uses (`node_modules/maplibre-gl/src/geo/projection/projection_data.ts` and `src/shaders/glsl/_projection_globe.vertex.glsl`) and follow its own custom-layer conventions.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds.
- [ ] **Step 5: Do the screenshot check** with `npx next start -p 3461` and Playwright. Follow Meteor-M2 3 (`following: [57166]`), Globe, "On the satellite".
  - **Shapes:** capture a pole-containing footprint and one reaching past 85° (drag the globe or wait), both from straight above the pole ("North pole") and at an angle. There is no bite and no seam.
  - **Date line:** a footprint crossing it shows no artefact.
  - **Theme:** after dark, light, dark, exactly one fill shows.
  - **Views:** Mercator then Globe then Mercator, exactly one fill.
  - **Console:** no WebGL errors.
- [ ] **Step 6: Commit** with `feat: Draw globe footprints as true spherical caps`.
