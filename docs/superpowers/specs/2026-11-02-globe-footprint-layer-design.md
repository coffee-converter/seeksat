# Globe Footprint Layer Design

**Date:** 2026-11-02
**Status:** Approved approach. Aaron chose "Draw footprints in 3D ourselves" over filling the whole polar cap or leaving the gap.

## Why

On the globe, a footprint that reaches into the polar cap (above 85.05°) without surrounding the pole shows a missing slice.

MapLibre's map data is tiled in Web Mercator, which stops at 85.05°. It extends a shape up to the pole only when the shape wraps all the way round. This was confirmed in a bare MapLibre 6.15 page:
- a footprint around the pole fills the cap;
- a footprint that only reaches into the cap leaves a bite.

Polar-orbiting weather satellites (Meteor, NOAA) hit this on most orbits.

## Goal

On the globe, the focus satellite's footprint fill is drawn by a MapLibre **custom WebGL layer** as a true spherical cap. It is exact everywhere, including over and near the poles.

On the flat Mercator map, the existing GeoJSON fill stays. Mercator has no cap, so nothing is missing there.

## How

- **Layer:** a `CustomLayerInterface` with id `ss-footprint-globe`, `renderingMode: '2d'`. It is inserted where `ss-footprint-fill` sits today, below the tracks.
- **Which fill draws:**
  - In globe view, `ss-footprint-fill` is hidden (`visibility: none`) and the custom layer draws.
  - In Mercator, the reverse.
  - The edge line (`ss-footprint-line`) stays GeoJSON in both views, clipped at 85.05° as today. Inside the cap the edge is not drawn, which is accepted.
- **Mesh (pure, tested):** `capMesh(centerLonLat, radiusDeg, { rings = 12, segments = 120 }) -> { positions: Float32Array, indices: Uint16Array }`.
  - **Vertices:** Web Mercator coordinates (x, y in world units 0..1, as MapLibre's `projectTile` expects). They lie on concentric rings around the cap centre, from the centre out to `radiusDeg`, taken along great-circle destinations so the mesh follows the sphere.
  - **Longitude:** unwrapped relative to the centre, so x may leave 0..1. The globe shader treats x as angle, so wrapping is harmless.
  - **Latitude:** at most 89.9°, so y stays finite. A ring passing over the pole puts a vertex near 89.9°, and the fan closes the gap.
  - Triangles are indexed rings: a fan at the centre, then quads between rings.
- **Shader:**
  - Built from `shaderData.vertexShaderPrelude` and `shaderData.define`. The vertex shader calls `projectTile(a_pos)`, which handles globe projection and far-side clipping.
  - The fragment shader outputs the satellite colour at the fill opacity (`FOOTPRINT_FILL_OPACITY`, today 0.05), premultiplied to match MapLibre's blending.
  - Compiled shaders are cached by `shaderData.variantName`.
- **Uniforms:** from `args.defaultProjectionData`, named as MapLibre's prelude expects. Read the 6.15 sources for the exact uniform names (`src/geo/projection/projection_data.ts`, `src/shaders/glsl/_projection_globe.vertex.glsl`).
- **Updates:**
  - FlatMap passes `{ center, radiusDeg, color }` for the focus footprint, or null, whenever the footprint changes (once a second, as now).
  - The mesh is rebuilt only when the centre moves more than 0.01° or the radius changes, and is then re-uploaded to its buffer.
  - The layer calls `map.triggerRepaint()` only when data changes.
- **Theme swap:** `setStyle` drops custom layers, so it is re-added on `style.load` with the other overlays. `addOverlays` becomes able to add it idempotently.
- **Failure:** if shader compile or link fails, log once to the console, and keep the GeoJSON fill visible in globe view (today's behaviour, with the gap).

## Constraints

- No new dependencies. Raw WebGL2 only (MapLibre 6 requires WebGL2).
- No change to the Mercator rendering, the edge line, the tracks or night shading.
- `prefers-reduced-motion` and the other camera behaviour are unaffected.
- Never call CelesTrak.

## Out of scope (possible follow-up)

- **Night shading near the poles,** which can show the same bite near the equinoxes for the -18° band. It would use the same layer type later if it turns out to matter.
- **The edge line inside the cap.**

## Review focus

1. A cap containing the pole, and one reaching past 85° without containing it, both fill smoothly, with no bite and no seam, from several camera angles including straight above the pole.
2. A cap crossing the date line, and the far side of the globe, show no artefacts. Hidden parts are clipped by `projectTile`.
3. A theme swap and a flat/globe switch leave exactly one fill visible, never both and never neither.
4. Performance: no per-frame allocation. The mesh rebuilds only when the footprint moves.
