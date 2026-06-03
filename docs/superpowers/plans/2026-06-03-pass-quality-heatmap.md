# Pass-Quality Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-place "Heatmap" mode to the pass-finder globe that paints a regional color map of ISS pass quality (per-cell virtual-observer P%) over a 1d/7d/14d window.

**Architecture:** A floating toggle flips the Cesium scene into a flat dark 2D map over the region around the user's placed observers. A grid of virtual single observers is scored by reusing the existing pass-finder math (`observer-pass.js`, `scoring.js`, `ratings.js`); the ISS is propagated once per timestep and fanned out across all cells. Clouds are fetched on a coarse grid (bulk Open-Meteo) and bilinearly interpolated. Results are rendered to a tiny offscreen canvas and draped as a single Cesium imagery layer.

**Tech Stack:** Next.js 15 / React 19, Zustand store, Cesium (global `window.Cesium`), satellite.js (threaded in via `issEcefAt`), Node's built-in test runner (`node --test`, ESM `.mjs`).

**Branching:** Work happens on a feature branch off `main` (e.g. `feat-pass-quality-heatmap`); the deliverable is a PR onto `main`.

---

## File Structure

- **Create** `lib/pass-finder/heatmap.js` — pure compute: `regionForObservers`, `buildGrid`, `computeCellMetrics`, `computeHeatmap`, cloud-grid interpolation. No Cesium, no DOM. Unit-tested.
- **Create** `lib/pass-finder/heatmap-render.js` — pure pixel mapping (`normalizeCount`, `cellColor`, `renderHeatmapImageData`) + browser-only Cesium drape/teardown + 2D dark scene swap. The pure parts are unit-tested.
- **Create** `components/passes/HeatmapControls.tsx` — floating toggle, window selector, metric toggle, legend.
- **Create** `test/heatmap.test.mjs`, `test/heatmap-render.test.mjs` — unit tests.
- **Modify** `lib/pass-finder/weather.js` — add `fetchCloudForecastBulk(points)` (bulk multi-location Open-Meteo).
- **Modify** `lib/pass-finder-store.ts` — add heatmap slice + actions.
- **Modify** `lib/pass-finder-scene.js` — subscribe to heatmap state; run compute + drape; publish stats.
- **Modify** `components/PassFinderApp.tsx` — mount `<HeatmapControls />`.

---

## Task 1: Store slice for heatmap state

**Files:**
- Modify: `lib/pass-finder-store.ts`

- [ ] **Step 1: Add the state fields to the `PassFinderState` interface**

In `lib/pass-finder-store.ts`, inside `interface PassFinderState`, add these fields just after the `firstSearchComplete: boolean;` line:

```ts
  // ---- Heatmap mode ----
  /** When true, the globe shows the regional pass-quality heatmap. */
  heatmapMode: boolean;
  /** Forecast window for the heatmap, in days. */
  heatmapWindowDays: 1 | 7 | 14;
  /** Which value paints each cell. */
  heatmapMetric: "count" | "bestP";
  /** Max good-pass count across the region — published by the scene
   *  after each compute so the legend can normalize/label. */
  heatmapMaxCount: number;
  /** False when no cloud forecast loaded for the region (legend note). */
  heatmapCloudAvailable: boolean;
  /** True while a heatmap compute is in flight (spinner in the legend). */
  heatmapComputing: boolean;
```

- [ ] **Step 2: Add the action signatures to the interface**

In the same interface, after `setFirstSearchComplete: (done: boolean) => void;`, add:

```ts
  setHeatmapMode: (on: boolean) => void;
  setHeatmapWindowDays: (days: 1 | 7 | 14) => void;
  setHeatmapMetric: (metric: "count" | "bestP") => void;
  setHeatmapStats: (maxCount: number, cloudAvailable: boolean) => void;
  setHeatmapComputing: (computing: boolean) => void;
```

- [ ] **Step 3: Add the initial values to the store body**

In the `create<PassFinderState>((set) => ({ ... }))` object, after `firstSearchComplete: false,`, add:

```ts
  heatmapMode: false,
  heatmapWindowDays: 7,
  heatmapMetric: "count",
  heatmapMaxCount: 0,
  heatmapCloudAvailable: false,
  heatmapComputing: false,
```

- [ ] **Step 4: Add the action implementations**

After `setFirstSearchComplete: (firstSearchComplete) => set({ firstSearchComplete }),`, add:

```ts
  setHeatmapMode: (heatmapMode) => set({ heatmapMode }),
  setHeatmapWindowDays: (heatmapWindowDays) => set({ heatmapWindowDays }),
  setHeatmapMetric: (heatmapMetric) => set({ heatmapMetric }),
  setHeatmapStats: (heatmapMaxCount, heatmapCloudAvailable) =>
    set({ heatmapMaxCount, heatmapCloudAvailable }),
  setHeatmapComputing: (heatmapComputing) => set({ heatmapComputing }),
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/pass-finder-store.ts
git commit -m "feat(heatmap): add heatmap state slice to pass-finder store"
```

---

## Task 2: Region + grid builders (pure)

**Files:**
- Create: `lib/pass-finder/heatmap.js`
- Test: `test/heatmap.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/heatmap.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionForObservers, buildGrid } from '../lib/pass-finder/heatmap.js';

test('regionForObservers: no observers → default radius around 0,0', () => {
  const r = regionForObservers([], { defaultRadiusDeg: 2.5 });
  assert.equal(r.centerLat, 0);
  assert.equal(r.centerLon, 0);
  assert.equal(r.halfLatDeg, 2.5);
  assert.equal(r.halfLonDeg, 2.5);
});

test('regionForObservers: single observer → centered, default radius', () => {
  const r = regionForObservers([{ latDeg: 40, lonDeg: -74 }], { defaultRadiusDeg: 2.5 });
  assert.equal(r.centerLat, 40);
  assert.equal(r.centerLon, -74);
  assert.equal(r.halfLatDeg, 2.5);
  assert.equal(r.halfLonDeg, 2.5);
});

test('regionForObservers: spread observers → bounding box + padding, centered', () => {
  const r = regionForObservers(
    [{ latDeg: 30, lonDeg: -80 }, { latDeg: 40, lonDeg: -60 }],
    { defaultRadiusDeg: 2.5, padDeg: 1 },
  );
  assert.equal(r.centerLat, 35);
  assert.equal(r.centerLon, -70);
  assert.equal(r.halfLatDeg, 6);   // (40-30)/2 + 1
  assert.equal(r.halfLonDeg, 11);  // (-60 - -80)/2 + 1
});

test('buildGrid: n×n cell centers inside the region, ids unique', () => {
  const region = { centerLat: 0, centerLon: 0, halfLatDeg: 2, halfLonDeg: 2 };
  const grid = buildGrid(region, 4);
  assert.equal(grid.n, 4);
  assert.equal(grid.cells.length, 16);
  assert.equal(grid.south, -2);
  assert.equal(grid.north, 2);
  assert.equal(grid.west, -2);
  assert.equal(grid.east, 2);
  // first cell center is half a step in from the SW corner
  assert.ok(Math.abs(grid.cells[0].latDeg - (-2 + 0.5)) < 1e-9);
  assert.ok(Math.abs(grid.cells[0].lonDeg - (-2 + 0.5)) < 1e-9);
  const ids = new Set(grid.cells.map((c) => c.id));
  assert.equal(ids.size, 16);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/heatmap.test.mjs`
Expected: FAIL — cannot find module `../lib/pass-finder/heatmap.js`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/pass-finder/heatmap.js`:

```js
// lib/pass-finder/heatmap.js — pure compute for the regional
// pass-quality heatmap. Builds a grid of virtual single observers
// around the user's stations, scores each one's ISS passes over a
// forecast window by reusing the existing pass-finder math, and
// aggregates per cell. No Cesium, no DOM — unit-testable.

// Region (center + half-extents in degrees) covering the user's
// observers. Empty/sparse observer sets fall back to a default radius
// so a single station still gets a sensible "reasonable drive" box.
export function regionForObservers(observers, opts = {}) {
  const defaultRadiusDeg = opts.defaultRadiusDeg ?? 2.5;
  const padDeg = opts.padDeg ?? 0.75;
  if (!observers || observers.length === 0) {
    return { centerLat: 0, centerLon: 0, halfLatDeg: defaultRadiusDeg, halfLonDeg: defaultRadiusDeg };
  }
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const o of observers) {
    if (o.latDeg < minLat) minLat = o.latDeg;
    if (o.latDeg > maxLat) maxLat = o.latDeg;
    if (o.lonDeg < minLon) minLon = o.lonDeg;
    if (o.lonDeg > maxLon) maxLon = o.lonDeg;
  }
  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;
  let halfLatDeg = (maxLat - minLat) / 2 + padDeg;
  let halfLonDeg = (maxLon - minLon) / 2 + padDeg;
  if (halfLatDeg < defaultRadiusDeg) halfLatDeg = defaultRadiusDeg;
  if (halfLonDeg < defaultRadiusDeg) halfLonDeg = defaultRadiusDeg;
  return { centerLat, centerLon, halfLatDeg, halfLonDeg };
}

// Build an n×n grid of cell CENTERS over the region. row 0 / col 0 is
// the south-west corner. Returns the corner bounds too (for the Cesium
// rectangle) and per-cell {id, row, col, latDeg, lonDeg}.
export function buildGrid(region, n) {
  const { centerLat, centerLon, halfLatDeg, halfLonDeg } = region;
  const south = centerLat - halfLatDeg;
  const west = centerLon - halfLonDeg;
  const north = centerLat + halfLatDeg;
  const east = centerLon + halfLonDeg;
  const dLat = (2 * halfLatDeg) / n;
  const dLon = (2 * halfLonDeg) / n;
  const cells = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      cells.push({
        id: `hm-${row}-${col}`,
        row,
        col,
        latDeg: south + (row + 0.5) * dLat,
        lonDeg: west + (col + 0.5) * dLon,
      });
    }
  }
  return { n, dLat, dLon, south, west, north, east, cells };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/heatmap.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pass-finder/heatmap.js test/heatmap.test.mjs
git commit -m "feat(heatmap): region + grid builders"
```

---

## Task 3: Per-cell pass scoring fan-out (pure)

**Files:**
- Modify: `lib/pass-finder/heatmap.js`
- Test: `test/heatmap.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `test/heatmap.test.mjs`:

```js
import { computeCellMetrics, computeHeatmap } from '../lib/pass-finder/heatmap.js';

const EARTH_R = 6378137;
const ISS_ALT_M = 420_000;

// A fake ISS sampler: the ISS sits straight above lon=0 / lat=0 for a
// 4-minute window each "day", and is unreachable (null) otherwise. This
// lets us assert pass COUNTS deterministically without SGP4.
function fakeSamplerOverheadEquator(nowMs) {
  return (jsDate) => {
    const since = jsDate.getTime() - nowMs;
    const dayMs = 86_400_000;
    const intoDay = ((since % dayMs) + dayMs) % dayMs;
    // overhead for the first 4 minutes of each day-window
    if (intoDay <= 4 * 60_000) return [EARTH_R + ISS_ALT_M, 0, 0];
    return null;
  };
}

test('computeCellMetrics: radio mode counts one pass per day window', () => {
  const nowMs = Date.UTC(2025, 5, 1, 0, 0, 0);
  const cell = { id: 'c', latDeg: 0, lonDeg: 0 };
  const m = computeCellMetrics(cell, {
    nowMs,
    windowMs: 2 * 86_400_000, // 2 days → 2 day-windows
    stepMs: 60_000,
    issEcefAtFn: fakeSamplerOverheadEquator(nowMs),
    mode: 'radio',
    minElevDeg: 10,
    goodThreshold: 0,           // count every pass
    cloudForecastForCell: () => null,
  });
  assert.equal(m.passes, 2);
  assert.equal(m.count, 2);
  assert.ok(m.bestP > 0);
});

test('computeCellMetrics: a far-away cell sees nothing', () => {
  const nowMs = Date.UTC(2025, 5, 1, 0, 0, 0);
  const cell = { id: 'c', latDeg: 80, lonDeg: 170 };
  const m = computeCellMetrics(cell, {
    nowMs,
    windowMs: 2 * 86_400_000,
    stepMs: 60_000,
    issEcefAtFn: fakeSamplerOverheadEquator(nowMs),
    mode: 'radio',
    minElevDeg: 10,
    goodThreshold: 0,
    cloudForecastForCell: () => null,
  });
  assert.equal(m.passes, 0);
  assert.equal(m.count, 0);
  assert.equal(m.bestP, 0);
});

test('computeHeatmap: returns aligned metrics + maxCount', () => {
  const nowMs = Date.UTC(2025, 5, 1, 0, 0, 0);
  const region = { centerLat: 0, centerLon: 0, halfLatDeg: 1, halfLonDeg: 1 };
  const grid = buildGrid(region, 3);
  const out = computeHeatmap(grid, {
    nowMs,
    windowMs: 86_400_000,
    stepMs: 60_000,
    issEcefAtFn: fakeSamplerOverheadEquator(nowMs),
    mode: 'radio',
    minElevDeg: 10,
    goodThreshold: 0,
    cloudForecastForCell: () => null,
  });
  assert.equal(out.metrics.length, 9);
  // center cell (near 0,0) should see the overhead pass
  assert.ok(out.maxCount >= 1);
  // every metric carries its grid coordinates
  assert.ok(out.metrics.every((m) => typeof m.row === 'number' && typeof m.col === 'number'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/heatmap.test.mjs`
Expected: FAIL — `computeCellMetrics`/`computeHeatmap` not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/pass-finder/heatmap.js`:

```js
import { findWindowsFromPredicate } from "./search.js";
import { observerSeesIss } from "./observer-pass.js";
import { passSuccessProbability } from "./scoring.js";

// Score one cell's ISS passes over [nowMs, nowMs+windowMs].
//
// deps:
//   nowMs, windowMs        forecast window
//   stepMs                 coarse predicate step (edges bisected to ~0.5s)
//   issEcefAtFn(jsDate)    shared ISS sampler (caller should memoize)
//   mode, minElevDeg       current visual/radio settings
//   goodThreshold          P% at/above which a pass counts as "good"
//   cloudForecastForCell(cell) -> { startMs, hours } | null
//
// Returns { passes, count, bestP }.
export function computeCellMetrics(cell, deps) {
  const {
    nowMs, windowMs, stepMs = 60_000, issEcefAtFn,
    mode, minElevDeg, goodThreshold = 0.5, cloudForecastForCell,
  } = deps;

  const pred = (ms) => {
    const d = new Date(ms);
    const e = issEcefAtFn(d);
    if (!e) return false;
    return observerSeesIss(cell, e, d, mode, minElevDeg);
  };

  const windows = findWindowsFromPredicate(pred, nowMs, nowMs + windowMs, stepMs);
  const cloudForecast = cloudForecastForCell ? cloudForecastForCell(cell) : null;
  const scoreDeps = {
    mode,
    minElevDeg,
    issEcefAtFn,
    // single virtual observer → the same forecast regardless of id
    cloudForecastForObs: () => cloudForecast,
  };

  let count = 0;
  let bestP = 0;
  for (const w of windows) {
    const p = passSuccessProbability(w, [cell], scoreDeps);
    if (p >= goodThreshold) count++;
    if (p > bestP) bestP = p;
  }
  return { passes: windows.length, count, bestP };
}

// Fan out computeCellMetrics across every grid cell. Returns
// { metrics, maxCount } where metrics[i] = { row, col, passes, count,
// bestP } aligned with grid.cells order.
export function computeHeatmap(grid, deps) {
  const metrics = [];
  let maxCount = 0;
  for (const cell of grid.cells) {
    const m = computeCellMetrics(cell, deps);
    if (m.count > maxCount) maxCount = m.count;
    metrics.push({ row: cell.row, col: cell.col, ...m });
  }
  return { metrics, maxCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/heatmap.test.mjs`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add lib/pass-finder/heatmap.js test/heatmap.test.mjs
git commit -m "feat(heatmap): per-cell pass scoring fan-out"
```

---

## Task 4: Coarse cloud grid — bulk fetch + bilinear interpolation

**Files:**
- Modify: `lib/pass-finder/weather.js` (add `fetchCloudForecastBulk`)
- Modify: `lib/pass-finder/heatmap.js` (add `buildCloudInterpolator`)
- Test: `test/heatmap.test.mjs`

- [ ] **Step 1: Write the failing test for the interpolator**

Append to `test/heatmap.test.mjs`:

```js
import { buildCloudInterpolator } from '../lib/pass-finder/heatmap.js';

test('buildCloudInterpolator: bilinear over a coarse grid, nearest-on-null', () => {
  const region = { centerLat: 0, centerLon: 0, halfLatDeg: 2, halfLonDeg: 2 };
  const coarse = buildGrid(region, 2); // 2×2 cell centers at ±1
  // forecasts aligned with coarse.cells order (row-major: SW, SE, NW, NE)
  // all share the same startMs + a single hour bucket for simplicity
  const startMs = Date.UTC(2025, 5, 1, 0, 0, 0);
  const forecasts = [
    { startMs, hours: [0] },    // SW
    { startMs, hours: [100] },  // SE
    { startMs, hours: [0] },    // NW
    { startMs, hours: [100] },  // NE
  ];
  const interp = buildCloudInterpolator(coarse, forecasts);

  // dead center → average of all four = 50 at hour 0
  const mid = interp({ latDeg: 0, lonDeg: 0 });
  assert.ok(Math.abs(mid.hours[0] - 50) < 1e-6);

  // far west cell → ~0, far east → ~100
  assert.ok(interp({ latDeg: 0, lonDeg: -1.5 }).hours[0] < 30);
  assert.ok(interp({ latDeg: 0, lonDeg: 1.5 }).hours[0] > 70);
});

test('buildCloudInterpolator: all-null forecasts → returns null', () => {
  const region = { centerLat: 0, centerLon: 0, halfLatDeg: 2, halfLonDeg: 2 };
  const coarse = buildGrid(region, 2);
  const interp = buildCloudInterpolator(coarse, [null, null, null, null]);
  assert.equal(interp({ latDeg: 0, lonDeg: 0 }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/heatmap.test.mjs`
Expected: FAIL — `buildCloudInterpolator` not exported.

- [ ] **Step 3: Implement the interpolator**

Append to `lib/pass-finder/heatmap.js`:

```js
// Build a bilinear cloud-forecast interpolator over a COARSE grid.
// `forecasts[i]` ({ startMs, hours } | null) aligns with grid.cells.
// Returns a function (cell-like {latDeg, lonDeg}) -> { startMs, hours }
// | null. All non-null coarse forecasts are assumed to share the same
// startMs and hours length (true for Open-Meteo's uniform hourly grid).
//
// At each fine point we find the 4 surrounding coarse centers and
// bilinearly blend per hour, skipping null corners (renormalizing the
// weights over the corners that DID load). Returns null only when no
// surrounding corner has data.
export function buildCloudInterpolator(grid, forecasts) {
  const { n, south, west, dLat, dLon, cells } = grid;
  // index helper into the row-major cells/forecasts arrays
  const at = (r, c) => forecasts[r * n + c];
  // a reference forecast for startMs + hours length
  const ref = forecasts.find((f) => f && Array.isArray(f.hours) && f.hours.length);
  if (!ref) return () => null;
  const startMs = ref.startMs;
  const H = ref.hours.length;

  return (point) => {
    // fractional grid position of the point relative to cell CENTERS
    // (centers sit at south + (r+0.5)*dLat). Clamp into [0, n-1].
    let fi = (point.latDeg - south) / dLat - 0.5;
    let fj = (point.lonDeg - west) / dLon - 0.5;
    fi = Math.max(0, Math.min(n - 1, fi));
    fj = Math.max(0, Math.min(n - 1, fj));
    const r0 = Math.floor(fi), c0 = Math.floor(fj);
    const r1 = Math.min(n - 1, r0 + 1), c1 = Math.min(n - 1, c0 + 1);
    const tr = fi - r0, tc = fj - c0;

    const corners = [
      { f: at(r0, c0), w: (1 - tr) * (1 - tc) },
      { f: at(r0, c1), w: (1 - tr) * tc },
      { f: at(r1, c0), w: tr * (1 - tc) },
      { f: at(r1, c1), w: tr * tc },
    ].filter((k) => k.f && Array.isArray(k.f.hours) && k.f.hours.length);

    const wsum = corners.reduce((s, k) => s + k.w, 0);
    if (wsum <= 0) return null;

    const hours = new Array(H);
    for (let h = 0; h < H; h++) {
      let acc = 0;
      for (const k of corners) acc += k.w * (k.f.hours[h] ?? 0);
      hours[h] = acc / wsum;
    }
    return { startMs, hours };
  };
}
```

Note: the `cells` destructure is unused here but keeps the signature parallel to `buildGrid`'s output — leave it out if your linter complains; replace the destructure line with `const { n, south, west, dLat, dLon } = grid;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/heatmap.test.mjs`
Expected: PASS (9 tests total).

- [ ] **Step 5: Write a smoke test for the bulk fetch URL builder**

The network call itself isn't unit-tested (it hits a live API), but the URL builder is. Append to `test/weather.test.mjs`:

```js
import { buildOpenMeteoBulkUrl } from '../lib/pass-finder/weather.js';

test('buildOpenMeteoBulkUrl: comma-joins coordinates', () => {
  const url = buildOpenMeteoBulkUrl([
    { latDeg: 10, lonDeg: 20 },
    { latDeg: 30, lonDeg: 40 },
  ]);
  assert.ok(url.includes('latitude=10,30'));
  assert.ok(url.includes('longitude=20,40'));
  assert.ok(url.includes('cloud_cover_low'));
  assert.ok(url.includes('forecast_days=16'));
});
```

(If `test/weather.test.mjs` doesn't already import `test`/`assert`, they are imported at the top of that file — reuse them.)

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test test/weather.test.mjs`
Expected: FAIL — `buildOpenMeteoBulkUrl` not exported.

- [ ] **Step 7: Add the bulk fetch to weather.js**

In `lib/pass-finder/weather.js`, add near the Open-Meteo section:

```js
// Build the Open-Meteo bulk multi-location forecast URL. Open-Meteo
// accepts comma-separated latitude/longitude lists and returns a JSON
// ARRAY of per-location hourly forecasts in the same order.
export function buildOpenMeteoBulkUrl(points) {
  const lats = points.map((p) => p.latDeg).join(",");
  const lons = points.map((p) => p.lonDeg).join(",");
  return "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${lats}&longitude=${lons}`
    + "&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high"
    + "&timezone=UTC&forecast_days=16";
}

// Fetch combined cloud forecasts for many locations in one request.
// Returns an array aligned with `points`; entries are { startMs, hours }
// or null on a per-location parse failure (or null-filled on total
// failure). Used by the heatmap's coarse cloud grid — met.no has no
// bulk endpoint, so this is Open-Meteo only (the dual-source averaging
// stays in the normal single-point passes flow).
export function fetchCloudForecastBulk(points) {
  if (!points || !points.length) return Promise.resolve([]);
  const url = buildOpenMeteoBulkUrl(points);
  return fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((data) => {
      // Open-Meteo returns a single object for one location, an array
      // for many. Normalize to an array.
      const arr = Array.isArray(data) ? data : [data];
      return arr.map((d) => {
        const times = d?.hourly?.time;
        const low = d?.hourly?.cloud_cover_low;
        const mid = d?.hourly?.cloud_cover_mid;
        const high = d?.hourly?.cloud_cover_high;
        if (!Array.isArray(times) || !times.length
            || !Array.isArray(low) || !Array.isArray(mid) || !Array.isArray(high)) {
          return null;
        }
        const startMs = new Date(times[0] + "Z").getTime();
        const hours = times.map((_, i) => combineCloudLayers(low[i], mid[i], high[i]));
        return { startMs, hours };
      });
    })
    .catch((err) => {
      console.warn(`Open-Meteo bulk cloud failed: ${err.message}`);
      return points.map(() => null);
    });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test test/weather.test.mjs test/heatmap.test.mjs`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/pass-finder/weather.js lib/pass-finder/heatmap.js test/heatmap.test.mjs test/weather.test.mjs
git commit -m "feat(heatmap): coarse cloud grid bulk fetch + bilinear interpolation"
```

---

## Task 5: Pixel mapping (pure) — normalize + color + ImageData

**Files:**
- Create: `lib/pass-finder/heatmap-render.js`
- Test: `test/heatmap-render.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/heatmap-render.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCount, cellColor, renderHeatmapImageData,
} from '../lib/pass-finder/heatmap-render.js';

test('normalizeCount: clamps to [0,1] against max', () => {
  assert.equal(normalizeCount(0, 5), 0);
  assert.equal(normalizeCount(5, 5), 1);
  assert.equal(normalizeCount(2, 4), 0.5);
  assert.equal(normalizeCount(3, 0), 0); // guard against /0
});

test('cellColor: 0 → red-ish, 1 → green-ish, alpha set', () => {
  const lo = cellColor(0);
  const hi = cellColor(1);
  assert.ok(lo.r > lo.g);       // red dominant at low score
  assert.ok(hi.g > hi.r);       // green dominant at high score
  assert.ok(hi.a > 0 && hi.a <= 255);
});

test('renderHeatmapImageData: count metric, north-up flip, empty=transparent', () => {
  // 2×2 grid: row 0 = south. metrics row-major.
  const grid = { n: 2 };
  const metrics = [
    { row: 0, col: 0, passes: 0, count: 0, bestP: 0 },   // SW: empty → transparent
    { row: 0, col: 1, passes: 2, count: 2, bestP: 0.9 }, // SE
    { row: 1, col: 0, passes: 1, count: 1, bestP: 0.4 }, // NW
    { row: 1, col: 1, passes: 1, count: 1, bestP: 0.5 }, // NE
  ];
  const img = renderHeatmapImageData(grid, metrics, { metric: 'count', maxCount: 2 });
  assert.equal(img.width, 2);
  assert.equal(img.height, 2);
  assert.equal(img.data.length, 16);
  // image row 0 = NORTH = grid row 1. SW empty cell is grid row0/col0 →
  // image row 1, col 0 → pixel index (1*2 + 0)*4 = 8 → alpha at 11 = 0.
  assert.equal(img.data[11], 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/heatmap-render.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure pixel-mapping implementation**

Create `lib/pass-finder/heatmap-render.js`:

```js
// lib/pass-finder/heatmap-render.js — turns heatmap metrics into pixels
// and (in the browser) drapes them onto the Cesium globe.
//
// The pure half (normalizeCount / cellColor / renderHeatmapImageData)
// has no DOM/Cesium dependency and is unit-tested. The browser half
// (createHeatmapLayer / enterHeatmap2D / exitHeatmap2D) reads
// window.Cesium and touches the viewer.

import { interpRatingStop } from "./ratings.js";

const CELL_ALPHA = 0.78 * 255;

// Normalize a good-pass count to [0,1] against the region's max.
export function normalizeCount(count, maxCount) {
  if (!maxCount || maxCount <= 0) return 0;
  return Math.max(0, Math.min(1, count / maxCount));
}

// Map a [0,1] score to an RGBA cell color using the shared rating
// gradient (red → yellow → green), matching the passes-list coloring.
export function cellColor(value) {
  const c = interpRatingStop(value);
  return { r: c.r, g: c.g, b: c.b, a: Math.round(CELL_ALPHA) };
}

// Render metrics to a tiny n×n RGBA buffer (one pixel per cell). Cesium
// bilinearly samples this when draped, so a 1px-per-cell texture reads
// as a smooth heatmap for free.
//
// Grid row 0 is the SOUTH edge; image row 0 is the NORTH (top) edge, so
// we flip vertically. Cells with zero passes render fully transparent.
export function renderHeatmapImageData(grid, metrics, opts) {
  const { metric, maxCount } = opts;
  const n = grid.n;
  const data = new Uint8ClampedArray(n * n * 4);
  for (const m of metrics) {
    const value = metric === "count"
      ? normalizeCount(m.count, maxCount)
      : m.bestP;
    const imgRow = n - 1 - m.row; // flip south→north
    const idx = (imgRow * n + m.col) * 4;
    if (m.passes === 0) {
      data[idx + 3] = 0; // transparent
      continue;
    }
    const c = cellColor(value);
    data[idx] = c.r;
    data[idx + 1] = c.g;
    data[idx + 2] = c.b;
    data[idx + 3] = c.a;
  }
  return { data, width: n, height: n };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/heatmap-render.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pass-finder/heatmap-render.js test/heatmap-render.test.mjs
git commit -m "feat(heatmap): pure pixel mapping (normalize, color, ImageData)"
```

---

## Task 6: Cesium drape + dark 2D scene swap (browser)

**Files:**
- Modify: `lib/pass-finder/heatmap-render.js` (append browser-only functions)

This task is browser-only Cesium glue; it's verified manually in Task 8, not unit-tested.

- [ ] **Step 1: Append the Cesium drape + scene-swap helpers**

Append to `lib/pass-finder/heatmap-render.js`:

```js
// ---- Browser-only Cesium glue --------------------------------------------

const DARK_BASEMAP_URL =
  "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png";

// Build an imagery layer from a metrics buffer, draped over the grid's
// lat/lon rectangle. Returns the Cesium ImageryLayer (caller removes it
// on teardown / before repaint).
export function createHeatmapLayer(viewer, grid, imageData) {
  const Cesium = window.Cesium;
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(imageData.width, imageData.height);
  img.data.set(imageData.data);
  ctx.putImageData(img, 0, 0);

  const layer = viewer.imageryLayers.addImageryProvider(
    new Cesium.SingleTileImageryProvider({
      url: canvas.toDataURL("image/png"),
      rectangle: Cesium.Rectangle.fromDegrees(
        grid.west, grid.south, grid.east, grid.north,
      ),
      tileWidth: imageData.width,
      tileHeight: imageData.height,
    }),
  );
  layer.alpha = 1.0; // alpha already baked into the pixels
  return layer;
}

// Enter the flat dark map: morph to 2D, hide the existing imagery
// layers, add a dark basemap UNDER where the heatmap will go, and fly
// the camera to the region. Returns a restore token for exitHeatmap2D.
export function enterHeatmap2D(viewer, grid) {
  const Cesium = window.Cesium;
  const prevLayers = [];
  for (let i = 0; i < viewer.imageryLayers.length; i++) {
    const l = viewer.imageryLayers.get(i);
    prevLayers.push({ layer: l, show: l.show });
    l.show = false;
  }
  const darkLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: DARK_BASEMAP_URL,
      subdomains: ["a", "b", "c", "d"],
      credit: "© OpenStreetMap, © CARTO",
      maximumLevel: 18,
    }),
  );
  viewer.scene.morphTo2D(0.6);
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(
      grid.west, grid.south, grid.east, grid.north,
    ),
    duration: 0.8,
  });
  return { prevLayers, darkLayer };
}

// Restore the 3D globe + original imagery. Pass the token from
// enterHeatmap2D plus the current heatmap layer (if any) to remove.
export function exitHeatmap2D(viewer, token, heatmapLayer) {
  if (heatmapLayer) viewer.imageryLayers.remove(heatmapLayer, true);
  if (token && token.darkLayer) viewer.imageryLayers.remove(token.darkLayer, true);
  if (token && token.prevLayers) {
    for (const { layer, show } of token.prevLayers) layer.show = show;
  }
  viewer.scene.morphTo3D(0.6);
}
```

- [ ] **Step 2: Typecheck / lint sanity (no test — browser glue)**

Run: `npm run typecheck`
Expected: no errors (the file is `.js`, so this mainly confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add lib/pass-finder/heatmap-render.js
git commit -m "feat(heatmap): Cesium drape + dark 2D scene swap"
```

---

## Task 7: Wire compute + render into the scene

**Files:**
- Modify: `lib/pass-finder-scene.js`

The scene already owns `viewer`, `issEcefAt`, `state.observers`, `state.mode`, `state.minElevDeg`, and `state.cloudForecasts`. This task adds a heatmap controller that subscribes to the store's heatmap slice.

- [ ] **Step 1: Add imports at the top of `lib/pass-finder-scene.js`**

Find the existing `import` block for pass-finder modules and add:

```js
import {
  regionForObservers, buildGrid, computeHeatmap, buildCloudInterpolator,
} from "./pass-finder/heatmap.js";
import {
  renderHeatmapImageData, createHeatmapLayer, enterHeatmap2D, exitHeatmap2D,
} from "./pass-finder/heatmap-render.js";
import { fetchCloudForecastBulk } from "./pass-finder/weather.js";
```

- [ ] **Step 2: Add the heatmap controller inside `initPassFinderScene`**

Inside `initPassFinderScene(viewer)`, AFTER `issEcefAt` is defined (it's defined around line 850; place this near the other store-subscription wiring, e.g. just before the function's teardown `return`), insert:

```js
  // ---- Heatmap mode ---------------------------------------------------------
  const HEATMAP_FINE_N = 24;
  const HEATMAP_CLOUD_N = 6;
  const HEATMAP_STEP_MS = 60_000;
  const HEATMAP_GOOD_THRESHOLD = 0.5;

  let heatmapToken = null;   // enterHeatmap2D restore token
  let heatmapLayer = null;   // current draped imagery layer
  let heatmapRunId = 0;      // guards against overlapping async runs

  // Memoize issEcefAt by integer ms for the duration of one compute —
  // all 576 cells query the SAME predicate timestamps, so this collapses
  // a huge amount of repeated SGP4 work. Cleared each run.
  function makeMemoSampler() {
    const cache = new Map();
    return (jsDate) => {
      const ms = jsDate.getTime();
      if (cache.has(ms)) return cache.get(ms);
      const v = issEcefAt(jsDate);
      cache.set(ms, v);
      return v;
    };
  }

  async function runHeatmap() {
    const store = usePassFinderStore.getState();
    const runId = ++heatmapRunId;
    store.setHeatmapComputing(true);

    const region = regionForObservers(state.observers, { defaultRadiusDeg: 2.5 });
    const grid = buildGrid(region, HEATMAP_FINE_N);
    const cloudGrid = buildGrid(region, HEATMAP_CLOUD_N);

    // Fetch the coarse cloud grid (Open-Meteo bulk). If it fails we fall
    // back to neutral clouds (interpolator returns null → effectivePClear
    // uses 0.5), same as the normal flow with no forecast.
    let cloudInterp = () => null;
    let cloudAvailable = false;
    try {
      const forecasts = await fetchCloudForecastBulk(
        cloudGrid.cells.map((c) => ({ latDeg: c.latDeg, lonDeg: c.lonDeg })),
      );
      if (runId !== heatmapRunId) return; // superseded
      cloudInterp = buildCloudInterpolator(cloudGrid, forecasts);
      cloudAvailable = forecasts.some((f) => f && f.hours && f.hours.length);
    } catch {
      /* keep neutral fallback */
    }

    const sampler = makeMemoSampler();
    const windowMs = store.heatmapWindowDays * 86_400_000;
    const { metrics, maxCount } = computeHeatmap(grid, {
      nowMs: Date.now(),
      windowMs,
      stepMs: HEATMAP_STEP_MS,
      issEcefAtFn: sampler,
      mode: state.mode,
      minElevDeg: state.minElevDeg,
      goodThreshold: HEATMAP_GOOD_THRESHOLD,
      cloudForecastForCell: (cell) => cloudInterp(cell),
    });
    if (runId !== heatmapRunId) return; // superseded mid-compute

    const imageData = renderHeatmapImageData(grid, metrics, {
      metric: store.heatmapMetric,
      maxCount,
    });
    if (heatmapLayer) {
      viewer.imageryLayers.remove(heatmapLayer, true);
      heatmapLayer = null;
    }
    heatmapLayer = createHeatmapLayer(viewer, grid, imageData);

    store.setHeatmapStats(maxCount, cloudAvailable);
    store.setHeatmapComputing(false);
  }

  function enableHeatmap() {
    if (heatmapToken) return;
    const region = regionForObservers(state.observers, { defaultRadiusDeg: 2.5 });
    const grid = buildGrid(region, HEATMAP_FINE_N);
    heatmapToken = enterHeatmap2D(viewer, grid);
    runHeatmap();
  }

  function disableHeatmap() {
    heatmapRunId++; // cancel any in-flight run
    if (heatmapToken) {
      exitHeatmap2D(viewer, heatmapToken, heatmapLayer);
      heatmapToken = null;
      heatmapLayer = null;
    }
    usePassFinderStore.getState().setHeatmapComputing(false);
  }

  const _unsubHeatmap = usePassFinderStore.subscribe((s, prev) => {
    if (s.heatmapMode !== prev.heatmapMode) {
      if (s.heatmapMode) enableHeatmap();
      else disableHeatmap();
      return;
    }
    // window/metric changes while active → recompute/repaint
    if (s.heatmapMode
        && (s.heatmapWindowDays !== prev.heatmapWindowDays
            || s.heatmapMetric !== prev.heatmapMetric)) {
      runHeatmap();
    }
  });
```

- [ ] **Step 3: Add teardown for the subscription**

Find where `initPassFinderScene` returns its teardown function (it returns a cleanup callback). Inside that teardown (alongside the other `_unsub*()` calls), add:

```js
    _unsubHeatmap();
    disableHeatmap();
```

If the teardown is a `return () => { ... }`, place those two lines inside it. If existing unsub handles are collected differently, follow that file's established pattern.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Run the full unit suite (nothing should regress)**

Run: `npm test`
Expected: PASS for all existing + new tests.

- [ ] **Step 6: Commit**

```bash
git add lib/pass-finder-scene.js
git commit -m "feat(heatmap): wire compute + render into the pass-finder scene"
```

---

## Task 8: HeatmapControls component + mount

**Files:**
- Create: `components/passes/HeatmapControls.tsx`
- Modify: `components/PassFinderApp.tsx`

- [ ] **Step 1: Create the component**

Create `components/passes/HeatmapControls.tsx`:

```tsx
"use client";

import { usePassFinderStore } from "@/lib/pass-finder-store";

// Floating heatmap controls. The toggle is always visible; the window
// selector, metric toggle, and legend appear only while heatmap mode is
// on. Inconspicuous overlay style, matching the app's other floating
// controls (no reserved header chrome).
export default function HeatmapControls() {
  const on = usePassFinderStore((s) => s.heatmapMode);
  const windowDays = usePassFinderStore((s) => s.heatmapWindowDays);
  const metric = usePassFinderStore((s) => s.heatmapMetric);
  const maxCount = usePassFinderStore((s) => s.heatmapMaxCount);
  const cloudAvailable = usePassFinderStore((s) => s.heatmapCloudAvailable);
  const computing = usePassFinderStore((s) => s.heatmapComputing);

  const setMode = usePassFinderStore((s) => s.setHeatmapMode);
  const setWindowDays = usePassFinderStore((s) => s.setHeatmapWindowDays);
  const setMetric = usePassFinderStore((s) => s.setHeatmapMetric);

  return (
    <div id="heatmap-controls" className="ctl-group" data-active={on}>
      <button
        type="button"
        className="heatmap-toggle"
        aria-pressed={on}
        onClick={() => setMode(!on)}
        title="Toggle the regional pass-quality heatmap"
      >
        Heatmap
      </button>

      {on && (
        <>
          <div className="heatmap-windows" role="group" aria-label="Heatmap window">
            {([1, 7, 14] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={windowDays === d}
                onClick={() => setWindowDays(d)}
              >
                {d}d
              </button>
            ))}
          </div>

          <div className="heatmap-metric" role="group" aria-label="Heatmap metric">
            <button
              type="button"
              aria-pressed={metric === "count"}
              onClick={() => setMetric("count")}
              title="Number of good passes (P% ≥ 50%) per location"
            >
              Good passes
            </button>
            <button
              type="button"
              aria-pressed={metric === "bestP"}
              onClick={() => setMetric("bestP")}
              title="Best single-pass probability per location"
            >
              Best P%
            </button>
          </div>

          <div className="heatmap-legend" aria-live="polite">
            {computing
              ? "Computing…"
              : metric === "count"
                ? `0–${maxCount} good passes`
                : "0–100% best pass"}
            {!cloudAvailable && !computing ? " · clouds: N/A" : ""}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `PassFinderApp.tsx`**

In `components/PassFinderApp.tsx`, add the import near the other passes imports:

```tsx
import HeatmapControls from "@/components/passes/HeatmapControls";
```

Then mount it inside the `<nav id="bottom-controls">` block, after the `<div id="camera-controls" …>` group and before the closing `</nav>`:

```tsx
        <HeatmapControls />
```

- [ ] **Step 3: Add minimal styles**

Append to `app/pass-finder.css` (match the existing floating-control look — keep it inconspicuous):

```css
/* Heatmap controls — floating, inconspicuous, lives in #bottom-controls. */
#heatmap-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
#heatmap-controls button {
  font: 11px / 1 -apple-system, BlinkMacSystemFont, sans-serif;
  letter-spacing: 0.06em;
  padding: 5px 9px;
  color: #cfe0ff;
  background: rgba(12, 18, 32, 0.55);
  border: 1px solid rgba(120, 150, 200, 0.25);
  border-radius: 6px;
  cursor: pointer;
}
#heatmap-controls button[aria-pressed="true"] {
  background: rgba(52, 211, 153, 0.22);
  border-color: rgba(52, 211, 153, 0.55);
}
#heatmap-controls .heatmap-windows,
#heatmap-controls .heatmap-metric {
  display: flex;
  gap: 4px;
}
#heatmap-controls .heatmap-legend {
  font: 10px / 1.2 -apple-system, BlinkMacSystemFont, sans-serif;
  color: #9fb3d6;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/passes/HeatmapControls.tsx components/PassFinderApp.tsx app/pass-finder.css
git commit -m "feat(heatmap): floating controls + legend, mounted in pass-finder"
```

---

## Task 9: Manual verification

**Files:** none (manual)

- [ ] **Step 1: Run the dev server**

Run: `npm run dev`
Open the pass-finder page in a browser.

- [ ] **Step 2: Verify the toggle + dark 2D map**

- Place at least one observer (click-to-place).
- Click **Heatmap**. Expect: the globe morphs to a flat dark (CARTO dark) map centered on the observer's region, with a translucent colored grid painted over it. The window selector, metric toggle, and legend appear.

- [ ] **Step 3: Verify metrics + window switching**

- Switch window **1d / 7d / 14d** — expect the heatmap to recompute (legend shows "Computing…" briefly) and the painted pattern/legend max to change.
- Switch **Good passes / Best P%** — expect the coloring to repaint.
- Confirm the legend shows "clouds: N/A" only when the cloud fetch fails (e.g. offline).

- [ ] **Step 4: Verify toggle-off restores the globe**

- Click **Heatmap** again. Expect: the dark map + paint disappear, the 3D Esri globe returns, overlays hide.

- [ ] **Step 5: Verify mode coupling**

- With heatmap off, switch the app's visual/radio mode and min-elevation, then toggle heatmap on. Expect the heatmap to reflect the active mode (radio shows many more "good passes" than visual).

- [ ] **Step 6: Final full test run**

Run: `npm test`
Expected: all PASS.

---

## Self-Review Notes

- **Spec coverage:** region/grid (Task 2), per-cell P% reuse of existing scorers (Task 3), aggregate good-pass count + best-P% metrics (Tasks 3/5), coarse cloud bulk + interpolation (Task 4), offscreen-canvas single-layer drape (Tasks 5/6), dark 2D basemap swap (Task 6), 1/7/14d window + metric toggle + legend (Tasks 1/8), in-place toggle on the globe (Tasks 7/8), respects visual/radio + minElev (Task 3 via `observerSeesIss`/`passSuccessProbability`). All spec sections map to a task.
- **Type consistency:** metric values `"count"`/`"bestP"`; window `1|7|14`; cell shape `{id,row,col,latDeg,lonDeg}`; grid shape `{n,dLat,dLon,south,west,north,east,cells}`; metrics entries `{row,col,passes,count,bestP}`; render opts `{metric,maxCount}` — consistent across Tasks 2–8.
- **Out of scope (per spec):** no global view, no per-pass mode, no animation, no save/share.
- **Performance note:** `computeHeatmap` runs synchronously (~576 cells). The memoized sampler makes this fast enough for a one-shot compute; if it ever blocks too long, chunking it across `requestIdleCallback` is a follow-up (YAGNI for v1).
