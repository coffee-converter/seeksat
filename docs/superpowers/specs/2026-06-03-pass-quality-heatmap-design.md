# Pass-Quality Heatmap — Design

**Date:** 2026-06-03
**Status:** Approved (pre-implementation)

## Summary

A **regional, observer-anchored heatmap** of ISS pass quality, painted onto the
existing Cesium globe as an in-place mode. A floating **"Heatmap" toggle** flips
the globe into a flat dark map over the region around the user's placed
observer(s). Each location is colored by how good its ISS passes are over a
selectable window (1d / 7d / 14d), answering: *"around my location, where's the
sweet spot, and where's generally reliable over the next week?"*

This is distinct from the app's normal multi-observer joint-capture flow: here
every grid cell is its own **virtual single observer**, scored independently.

## Goals

- Show, at a glance, how pass quality varies across the local region (≈ a few
  hundred km — "reasonable drive" scale).
- Default metric: **count of good passes** in the window per cell.
- Reuse the existing scoring math (`ratings.js` factor curves + single-observer
  pass scorers) so the heatmap is consistent with the passes list.
- Keep it cheap: one ISS propagation per timestep fanned out across all cells;
  clouds (the only network-expensive layer) fetched coarse + interpolated.

## Non-Goals (YAGNI)

- Global / whole-band view (regional only).
- Per-pass "drive to *tonight's* 9:47 pass" mode (only window aggregates).
- Time animation / scrubbing across the window.
- Saving, sharing, or deep-linking a heatmap.

## User-Facing Behavior

1. A **"Heatmap" toggle** sits among the existing floating globe controls.
2. Toggling on:
   - Switches the scene to a **flat dark map** (`SceneMode.SCENE2D` + a dark
     imagery layer) centered on the region around the placed observer(s).
   - Paints a **color ramp** over the region showing the chosen metric per cell.
   - Reveals floating overlays: **window selector (1d / 7d / 14d)**, **metric
     toggle (Good-pass count / Best P%)**, and a **legend**.
3. The heatmap **respects the app's current visual/radio mode and
   min-elevation**, so it matches what the passes list would report.
4. Toggling off restores Esri imagery + 3D globe and removes the overlays.

### Metrics

- **Default — Good-pass count:** number of passes in the window whose
  single-observer P% ≥ threshold (default **0.5**, the "coin-flip+" line).
  Color ramp normalized against the region's max count.
- **Secondary — Best single pass P%:** the highest single-pass P% any cell
  achieves in the window, colored with the existing red→yellow→green rating
  gradient (`interpRatingStop`).

### Missing data

If cloud forecasts fail to load, scoring falls back to a neutral P(clear)=0.5
(identical to today's `effectivePClear` behavior), and the legend shows a
**"clouds: N/A"** note so the user knows geometry/twilight are driving the map.

## Region & Grid

- **Region:** bounding box around all placed observers + padding. For a single
  observer, a default radius of **±2.5°** lat/lon (≈ 500 km across).
- **Fine grid:** **24×24** virtual-observer cells for geometry/twilight. Cheap
  because every cell shares one ISS track per timestep.
- **Cloud grid:** **6×6** coarse points fetched in bulk, bilinearly
  interpolated up to the fine grid (clouds vary smoothly in space).

These are defaults, tunable: region radius, threshold (0.5), grid 24×24, cloud
grid 6×6, default window 7d.

## Compute Architecture (the key efficiency)

The expensive part of pass-finding is SGP4 propagation. **The ISS position at
time `t` is shared by every cell**, so:

1. Walk time from `now → now + window` at a coarse step (≈ 30–60 s),
   propagating the ISS **once per step** to build an ISS-ECEF track.
2. For each fine cell (virtual observer), find its pass windows against the
   shared track using the existing single-observer visibility predicate
   (`observerSeesIss` / `passWindowAtMsForObserver`).
3. Score each pass with the existing single-observer scorer
   (`passSuccessProbability` degenerates cleanly to one observer) + the pure
   `ratings.js` curves (twilight, altitude, duration). Clouds come from the
   interpolated coarse grid via the same `effectivePClear` path.
4. Aggregate per cell into the chosen metric.

Clouds are the only network cost: one **Open-Meteo bulk multi-location request**
for the 6×6 grid (met.no is skipped here — it has no bulk endpoint and asks for
coarse precision; the dual-source averaging stays in the normal passes flow).

## Rendering

- Paint the fine grid to an **offscreen `<canvas>`** (smoothed/interpolated
  colors), then **drape it as a single imagery layer over the region
  rectangle** — not hundreds of Cesium entities. One texture, fast to repaint
  when window or metric changes.
- **Dark basemap:** while in heatmap mode, switch to `SceneMode.SCENE2D` and add
  a dark imagery layer (dark-gray canvas tiles) beneath the paint. Restore Esri
  + `SceneMode.SCENE3D` on toggle off.

## Module Layout (isolated, testable)

- `lib/pass-finder/heatmap.js` — **pure compute.** Region/grid builder, the
  shared-track pass fan-out, per-cell aggregation, metric functions. No Cesium,
  unit-testable.
- `lib/pass-finder/heatmap-render.js` — canvas painting + Cesium drape/teardown
  + scene-mode/imagery swap.
- `components/passes/HeatmapControls.tsx` — floating toggle, window selector,
  metric toggle, legend (inconspicuous floating style per branding direction).
- `lib/pass-finder-store.ts` — new slice: `heatmapMode`, `heatmapWindow`,
  `heatmapMetric` (+ setters).

## Reuse

- `lib/pass-finder/ratings.js` — `twilightFactor`, `altitudeFactor`,
  `coordinationFactor`, `effectivePClear`, `interpRatingStop` (color ramp).
- `lib/pass-finder/observer-pass.js` — `observerSeesIss`,
  `passWindowAtMsForObserver`.
- `lib/pass-finder/scoring.js` — `passSuccessProbability` (single-observer case).
- `lib/pass-finder/weather.js` — cloud combination logic; add a bulk
  multi-location Open-Meteo fetch variant for the coarse grid.
- `lib/cesium-viewer.ts` — imagery-layer + scene-mode management.

## Testing

- Unit tests for `heatmap.js`: grid/region builder bounds, the shared-track
  fan-out (a known TLE + known observers → expected pass counts), metric
  aggregation, cloud bilinear interpolation.
- Manual verification: toggle on with a placed observer, confirm dark flat map +
  colored region + working window/metric switches, toggle off restores the
  globe.

## Defaults Chosen (adjustable)

| Parameter | Default |
|---|---|
| Region radius (single observer) | ±2.5° (~500 km) |
| Good-pass threshold | P% ≥ 0.5 |
| Fine grid | 24×24 |
| Cloud grid | 6×6 |
| Default window | 7 days |
| Time step | ~30–60 s |
