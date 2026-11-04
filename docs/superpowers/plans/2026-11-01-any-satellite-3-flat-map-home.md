# Flat Map and Home Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new, light, phone-friendly home screen at `/`: search bar on top, a flat map with five switchable projections in the top half, and "Next up" pass cards from your location below. The Cesium app moves to `/classic`, and old `/?s=` links keep working.

**Architecture:**
- **Pure layers:** map geometry and projections are pure modules in `lib/map/`, built on `d3-geo` and `d3-geo-projection`. The home screen's preferences, data fetching and card logic are pure modules in `lib/home/`.
- **React shell:** client components in `components/home/` draw the map on a canvas, compute positions in the browser each second, and run the Plan 2 pass engine (`lib/passes/engine.mjs`) for each followed satellite.
- **Charts:** the sky and radio charts reuse `lib/passes/charts.js`. Their modals become controlled components that both the new home and the classic app use.
- **Cesium:** loads only on `/classic`.

**Tech Stack:** Next.js 15 App Router, React 19, Zustand 5, satellite.js 6.0.2, d3-geo 3.1.1, d3-geo-projection 4.0.0, topojson-client 3.1.0, world-atlas 2.0.2 (land-110m, 55 KB), `node --test` with linkedom (`lib/og/dom.mjs`) for SVG painter tests.

**Spec:** `docs/superpowers/specs/2026-10-30-any-satellite-tracker-design.md`, sections 6.2, 6.2a, 6.5, 6.6 and 9. Plans 1 and 2 are done and live in `docs/superpowers/plans/`.

## Global Constraints

- **CelesTrak:** never call it from a developer machine. Tests use fixtures (`test/fixtures/orbits.mjs`, `test/fixtures/omm-iss.mjs`) and make no network calls. The browser reads satellites only from `/api/sats` and `/api/search`.
- **Weight:** no heavy page (anti-goal). The home page must not load Cesium. The map uses a bundled land file and no tile service. No new external origins, so the CSP is unchanged.
- **Phone-friendly:** the layout works at 360 px wide and has no horizontal page scroll.
- **Look:** dark theme and Exo 2, as today. The sky chart and radio chart keep their exact look.
- **Share links:** existing `/?s=...` links keep working (anti-goal) by redirecting to `/classic` with the query intact. The MCP server is untouched.
- **Honesty:** no number shown with false confidence. Every value says what it is.
- **Copy:** plain language, no em dashes.
- **Device-only storage:** following, location, mode and projection live in localStorage. There are no accounts. Every storage access is wrapped in try/catch and falls back to defaults.
- **Popular set** (first visit, spec 6.2): ISS 25544, Tiangong 48274, Meteor-M2 3 57166, NOAA 19 33591. It is also the initial following list.
- **Pass defaults:** radio minimum elevation 10°. Mode radio or visual, as in spec 6.5. "Next up" looks 48 hours ahead.
- **Tests and commits:** `npm test`, `npx tsc --noEmit`. Conventional commit prefixes, no AI attribution lines.

## Review Focus

1. **The antimeridian and the poles on every projection.** A ground track crossing 180° must not draw a line across the whole map, and a polar-orbit track near a pole must not explode. Pinned in Task 1, where tracks are MultiLineStrings cut at ±180, and in Task 2's clip tests.
2. **localStorage that is unavailable, full or holding garbage** (private mode, an old format, hand-edited data). The page must still load, with defaults. Pinned in Task 4.
3. **A followed satellite the mirror doesn't have** (decayed or bad ID), or one whose elements won't propagate. Its card says so in plain words, and the rest of the page works. Pinned in Task 5.
4. **No location yet, or the location was denied.** The page is never empty: it shows the location prompt plus the popular satellites on the map. Pinned in Task 8.
5. **A tiny or rotating phone screen.** The map resizes without a blurry canvas (devicePixelRatio) or a stale projection. Task 3 refits the canvas and projection on every resize and orientation change. A browser is needed to see it, so Task 9's manual check covers it (item 1 at phone width, plus a rotation).

---

### Task 1: Map geometry

**Files:**
- Create: `lib/map/geometry.mjs`, `test/map-geometry.test.mjs`
- Modify: `package.json`. Add exact versions `d3-geo@3.1.1`, `d3-geo-projection@4.0.0`, `topojson-client@3.1.0` and `world-atlas@2.0.2` to dependencies.

**Interfaces:**
- Consumes: `Track` (`lib/sat/track.mjs`: `ecefAt`, `periodMs`, `orbitClass`); `ecefToGeodetic(x, y, z)` from `lib/coords.js` (returns `{ latDeg, lonDeg, elevM }`); `sunPositionEcef(date)` from `lib/pass-finder/sun.js`.
- Produces:
  - `EARTH_RADIUS_KM = 6371.0088`
  - `subpoint(ecef) -> { latDeg, lonDeg, altKm }`
  - `footprintRadiusDeg(altKm, minElevDeg = 0) -> number`, the Earth-central angle `acos(R / (R + h) · cos ε) − ε`, in degrees.
  - `subsolarPoint(date) -> { latDeg, lonDeg }`
  - `nightBands(date) -> Array<{ sunBelowDeg, feature }>` for sun altitudes 0, -6, -12 and -18. Each `feature` is a GeoJSON Polygon: a circle centred on the antisolar point with radius `90 − sunBelowDeg` degrees, built with `d3.geoCircle()`.
  - `footprintFeature(sub, altKm, minElevDeg = 0) -> GeoJSON Polygon` (`geoCircle` centred on the subpoint).
  - `groundTrack(track, nowMs, { steps = 240 } = {}) -> GeoJSON MultiLineString`
    - Span: from `nowMs − 0.25 · periodMs` to `nowMs + periodMs`, except for `orbitClass === 'geo'`, which uses `nowMs ± 12 h`.
    - Coordinates are `[lonDeg, latDeg]`.
    - A new line starts wherever consecutive longitudes differ by more than 180°, so no segment crosses the antimeridian.
    - Samples where `ecefAt` returns null are dropped.
  - `loadLand() -> GeoJSON` from `world-atlas/land-110m.json` via `topojson-client`'s `feature(topo, topo.objects.land)`, cached after the first call.

- [ ] **Step 1: Write the failing tests**

```js
test('footprintRadiusDeg', () => {
  assert.ok(Math.abs(footprintRadiusDeg(420) - 20.256) < 0.01);
  assert.ok(Math.abs(footprintRadiusDeg(420, 10) - 12.497) < 0.01);
  assert.ok(Math.abs(footprintRadiusDeg(35786) - 81.308) < 0.01);
});
test('subsolarPoint at the June solstice, noon UTC', () => {
  const s = subsolarPoint(new Date('2026-06-21T12:00:00Z'));
  assert.ok(Math.abs(s.latDeg - 23.44) < 0.1 && Math.abs(s.lonDeg - 0.46) < 0.5);
});
test('nightBands are four nested circles around the antisolar point', () => {
  const bands = nightBands(new Date('2026-06-21T12:00:00Z'));
  assert.deepEqual(bands.map((b) => b.sunBelowDeg), [0, -6, -12, -18]);
  for (const b of bands) assert.equal(b.feature.type, 'Polygon');
});
test('ISS ground track: never crosses the antimeridian inside a line', () => {
  const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
  const g = groundTrack(iss, Date.parse('2026-03-01T12:00:00Z'));
  assert.equal(g.type, 'MultiLineString');
  for (const line of g.coordinates) for (let i = 1; i < line.length; i++) {
    assert.ok(Math.abs(line[i][0] - line[i - 1][0]) <= 180);
  }
  const lats = g.coordinates.flat().map((p) => p[1]);
  assert.ok(Math.max(...lats) <= 52 && Math.min(...lats) >= -52, 'bounded by inclination 51.6°');
});
test('GEO ground track stays near its longitude', () => {
  const g = makeTrack(recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'));
  const lons = groundTrack(g, Date.parse('2026-10-31T15:00:00Z')).coordinates.flat().map((p) => p[0]);
  assert.ok(Math.max(...lons) - Math.min(...lons) < 2);
});
test('subpoint of the ISS is about 400 km up', () => {
  const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
  const s = subpoint(iss.ecefAt(new Date('2026-03-01T12:00:00Z')));
  assert.ok(s.altKm > 380 && s.altKm < 450 && Math.abs(s.latDeg) <= 52);
});
test('loadLand returns land polygons', () => {
  const land = loadLand();
  assert.ok(['Feature', 'FeatureCollection'].includes(land.type));
});
```

- [ ] **Step 2: Run** `npm install`, then `node --test test/map-geometry.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `lib/map/geometry.mjs`. JSON import: use `import land from 'world-atlas/land-110m.json' with { type: 'json' }` if node and Next both accept it. Otherwise load it with `createRequire`, and say which in the report.
- [ ] **Step 4: Run** the tests, then `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add flat map geometry: subpoints, footprints, night and ground tracks"`.

---

### Task 2: Map projections

**Files:**
- Create: `lib/map/projections.mjs`, `test/map-projections.test.mjs`

**Interfaces:**
- Consumes: `d3-geo` (`geoEquirectangular`, `geoAzimuthalEquidistant`, `geoPath`), `d3-geo-projection` (`geoWinkel3`, `geoSatellite`), and `EARTH_RADIUS_KM` (Task 1).
- Produces:
  - `PROJECTIONS`: ids in menu order, with labels as exact copy.

    | id | label |
    |---|---|
    | `equirectangular` | Lat/lon grid |
    | `azimuthal` | Centered on you |
    | `polar-north` | North pole |
    | `polar-south` | South pole |
    | `winkel3` | Winkel tripel |
    | `satellite` | From the satellite |

  - `DEFAULT_PROJECTION = 'equirectangular'`
  - `projectionAvailable(id, { observer, sat }) -> boolean`: `azimuthal` needs an observer, `satellite` needs a satellite, and the rest are always available.
  - `makeProjection(id, { width, height, observer = null, sat = null, zoom = 1, pan = [0, 0] }) -> d3 projection`. It falls back to `equirectangular` when `id` is unknown or unavailable.
    - **World projections** (`equirectangular`, `winkel3`): `fitExtent([[0, 0], [width, height]], { type: 'Sphere' })`.
    - **`azimuthal`:** `rotate([-observer.lonDeg, -observer.latDeg])`, fitted to the sphere.
    - **`polar-north` / `polar-south`:** azimuthal equidistant with `rotate([0, -90])` / `rotate([0, 90])` and `clipAngle(110)`, fitted to that clip circle. The view reaches 20° past the equator.
    - **`satellite`:** `geoSatellite().distance(1 + sat.altKm / EARTH_RADIUS_KM).rotate([-sat.lonDeg, -sat.latDeg]).clipAngle(acos(1 / distance) in degrees, minus 1e-6)`, fitted to the visible disk.
    - **Zoom and pan:** after fitting, `zoom` multiplies the scale, and `pan` adds to the translate, in CSS pixels.
  - `clampZoom(z) -> number` in [1, 8].

- [ ] **Step 1: Write the failing tests** (`P = (proj, lonLat) => proj(lonLat)`; `W = 800`, `H = 400`):

```js
test('equirectangular: [0,0] at the centre', () => {
  const p = makeProjection('equirectangular', { width: 800, height: 400 });
  const [x, y] = p([0, 0]);
  assert.ok(Math.abs(x - 400) < 1 && Math.abs(y - 200) < 1);
});
test('azimuthal: the observer is the centre, due north is straight up', () => {
  const p = makeProjection('azimuthal', { width: 600, height: 600, observer: EN52VE });
  const [x, y] = p([EN52VE.lonDeg, EN52VE.latDeg]);
  assert.ok(Math.abs(x - 300) < 1 && Math.abs(y - 300) < 1);
  const [xn, yn] = p([EN52VE.lonDeg, EN52VE.latDeg + 10]);
  assert.ok(Math.abs(xn - 300) < 1 && yn < 300);
});
test('polar-north centres the pole and clips the far south', () => {
  const p = makeProjection('polar-north', { width: 600, height: 600 });
  const [x, y] = p([0, 90]);
  assert.ok(Math.abs(x - 300) < 1 && Math.abs(y - 300) < 1);
  assert.equal(geoPath(p)({ type: 'Point', coordinates: [0, -60] }), null);
});
test('satellite view centres the subpoint and hides the far side', () => {
  const sat = { latDeg: 0, lonDeg: -75, altKm: 35786 };
  const p = makeProjection('satellite', { width: 600, height: 600, sat });
  const [x, y] = p([-75, 0]);
  assert.ok(Math.abs(x - 300) < 1 && Math.abs(y - 300) < 1);
  assert.equal(geoPath(p)({ type: 'Point', coordinates: [105, 0] }), null);
});
test('unavailable projections fall back to equirectangular', () => {
  assert.equal(projectionAvailable('satellite', { observer: EN52VE, sat: null }), false);
  assert.equal(projectionAvailable('azimuthal', { observer: null, sat: null }), false);
  const p = makeProjection('satellite', { width: 800, height: 400 });
  const [x, y] = p([0, 0]);
  assert.ok(Math.abs(x - 400) < 1 && Math.abs(y - 200) < 1);
});
test('winkel3 centres [0,0], zoom scales, clampZoom bounds', () => {
  const a = makeProjection('winkel3', { width: 800, height: 400 });
  const b = makeProjection('winkel3', { width: 800, height: 400, zoom: 2 });
  assert.ok(Math.abs(a([0, 0])[0] - 400) < 1);
  assert.ok(Math.abs(b.scale() / a.scale() - 2) < 1e-9);
  assert.equal(clampZoom(0.2), 1); assert.equal(clampZoom(20), 8); assert.equal(clampZoom(3), 3);
});
```

- [ ] **Step 2: Run** `node --test test/map-projections.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/map/projections.mjs`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add the five flat map projections"`.

---

### Task 3: Flat map component

**Files:**
- Create: `lib/map/draw.mjs`, `components/home/FlatMap.tsx`, `test/map-draw.test.mjs`
- Modify: `app/globals.css` or a new `app/home.css` imported by the home page (map tokens only).

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:
  - `MAP_COLORS`: tokens `{ ocean, land, landStroke, graticule, night, observer, footprint }`. The dark theme matches `app/pass-finder.css`. `night` is a fill with alpha, drawn once per band, so the bands stack darker with depth.
  - `SAT_PALETTE`: the scene's 8 colours, `["#ff9b54", "#7fe5d1", "#c084fc", "#facc15", "#f87171", "#34d399", "#a78bfa", "#fb923c"]`, assigned to followed satellites in following order. Colour follows the satellite, never its rank.
  - `drawMap(ctx, { projection, width, height, land, nightBands, sats, observer })`, where `sats = [{ noradId, name, color, track, position, footprint, selected }]`. Draw order:
    1. sphere (ocean)
    2. graticule every 30°
    3. land
    4. night bands
    5. the selected satellite's footprint
    6. ground tracks (2 px)
    7. observer marker
    8. satellite dots (8 px, with a 2 px ocean ring) and their labels
    It draws through `geoPath(projection, ctx)`.
  - `hitTest(sats, projection, x, y, radiusPx = 12) -> noradId | null`
  - `<FlatMap sats observer projectionId onProjectionChange selectedId onSelect />`. This is a client component.
    - **Canvas size:** the container width × 50% of the viewport height, minimum 220 px, scaled by `devicePixelRatio`. It re-fits on `ResizeObserver` callbacks and orientation change.
    - **Redraw:** once a second, from props the parent updates.
    - **Projection menu:** a `<select>` over `PROJECTIONS`, with unavailable options disabled.
    - **Zoom and pan:** wheel or pinch zooms (`clampZoom`), drag pans, double-click or double-tap resets. The pan and zoom state is local.
    - **Selecting:** a tap on a dot calls `onSelect(noradId)`.
    - **Accessibility:** `aria-label="Map of followed satellites"`, and a visually hidden list naming each satellite's current latitude and longitude, as a table view of the map.

- [ ] **Step 1: Write the failing tests** for `drawMap` and `hitTest`, using a recording 2D context stub that records method names (`beginPath`, `fill`, `stroke`, `arc`, `fillText`, ...):
  - one `drawMap` call on equirectangular with ISS and GOES-16 runs without throwing;
  - the first fill is the sphere;
  - `fillText` is called once per satellite label;
  - `hitTest` returns the ISS id at its projected point and null 50 px away.
- [ ] **Step 2: Run** `node --test test/map-draw.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/map/draw.mjs`, then `FlatMap.tsx`.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `git commit -m "feat: Draw the flat map on a canvas with switchable projections"`.

---

### Task 4: Home preferences, data and store

**Files:**
- Create: `lib/home/prefs.mjs`, `lib/home/records.mjs`, `lib/home/store.ts`, `test/home-prefs.test.mjs`, `test/home-records.test.mjs`

**Interfaces:**
- Consumes: `parseElements` (`lib/sat/elements.mjs`), `makeTrack` (`lib/sat/track.mjs`), `CATALOG` (`lib/catalog.mjs`), `DEFAULT_PROJECTION` (Task 2).
- Produces:
  - `POPULAR_IDS = [25544, 48274, 57166, 33591]`
  - `PREFS_KEY = 'seeksat.home.v1'`
  - `defaultPrefs() -> Prefs`, where `Prefs = { location: null | { name, latDeg, lonDeg, source: 'gps' | 'place' | 'grid' | 'coords' }, following: number[], custom: Array<{ noradId, name, line1, line2 }>, mode: 'radio' | 'visual', minElevDeg: number, projection: string }`. Defaults: `location` null, `following` is `POPULAR_IDS`, `custom` empty, mode `'radio'`, `minElevDeg` 10, `projection` `DEFAULT_PROJECTION`.
  - `parsePrefs(raw) -> Prefs`. It never throws. A garbage or partial value falls back field by field to the defaults.
    - Latitude must lie in [-90, 90] and longitude in [-180, 180].
    - `following` keeps unique integers from 1 to 999999999, at most 20.
    - `custom` entries must pass `parseElements`, at most 10.
    - `minElevDeg` lies in [0, 45].
    - `projection` must be a known id.
  - `loadPrefs(storage = globalThis.localStorage) -> Prefs` and `savePrefs(prefs, storage) -> boolean`. Both use try/catch. On any failure they return `defaultPrefs()` and `false` respectively.
  - `fetchRecords(ids, { fetchImpl = fetch } = {}) -> Promise<{ records: Map<number, record>, missing: number[] }>`. It calls `/api/sats?ids=` in chunks of 50. A non-200 response or a network error throws an `Error` whose message is `The satellite catalog is not available right now.`
  - `tracksFor(records, custom) -> Map<noradId, Track>`. Custom pasted elements become tracks with source `'pasted'` and override the mirror record for the same id. The `CATALOG` entry, when one exists, is passed to `makeTrack`.
  - `useHomeStore` (Zustand) holds:
    - `prefs` and `setPrefs(patch)`, which merges and saves;
    - `records` and `missing`;
    - `status: 'idle' | 'loading' | 'ready' | 'error'` and `error`;
    - `loadRecords()`;
    - `selectedId` and `setSelectedId`;
    - `follow(id)`, `unfollow(id)` and `addCustom(text)`. `addCustom` parses with `parseElements`, adds the result to `custom` and `following`, and returns `{ ok: true }` or `{ ok: false, message }` with the `ElementsError` message.

    It reloads records when the tab becomes visible and they are more than 60 min old. It does not touch localStorage during SSR: it reads in a `useEffect` and hydrates there.

- [ ] **Step 1: Write the failing tests:**
  - `parsePrefs`: `null`, `'{'`, `42`, `{ following: 'x' }` and `{ location: { latDeg: 200 } }` each yield the defaults for the bad fields. A valid object round-trips.
  - `loadPrefs` with a storage stub whose `getItem` throws returns the defaults.
  - `savePrefs` with a `setItem` that throws (quota) returns false.
  - `fetchRecords` with 120 ids makes 3 calls, merges the records and missing ids, and surfaces the error copy on a 503.
  - `tracksFor` lets a pasted ISS override the mirror ISS.
- [ ] **Step 2: Run** `node --test test/home-prefs.test.mjs test/home-records.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules and `store.ts`.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add home screen preferences, satellite fetching and store"`.

---

### Task 5: Next-up cards logic

**Files:**
- Create: `lib/home/next-up.mjs`, `test/home-next-up.test.mjs`

**Interfaces:**
- Consumes: `findPasses` (Plan 2, `lib/passes/engine.mjs`).
- Produces:
  - `NEXT_UP_HOURS = 48`
  - `nextUp({ tracks, missing, observer, mode, minElevDeg, nowMs }) -> Card[]`. There is one card per followed id, in this order:
    1. in-progress passes
    2. upcoming passes by start
    3. stationary-visible
    4. none
    5. stationary-not-visible
    6. unavailable
    7. missing
  - Card kinds:
    - `{ kind: 'pass', noradId, name, pass }`, where `pass` is the first pass from `findPasses` over 48 h.
    - `{ kind: 'stationary', noradId, name, pointing, visible }`
    - `{ kind: 'none', noradId, name }`
    - `{ kind: 'unavailable', noradId, name }`
    - `{ kind: 'missing', noradId, name: String(noradId) }`
  - `countdown(ms) -> string`:
    - `ms < 60_000` gives `under a minute`.
    - under an hour gives `42 min`.
    - under a day gives `2 h 5 min`.
    - otherwise `1 day 3 h`, or `2 days 3 h` for more than one day.
  - `cardHeadline(card, nowMs) -> string`, exact copy, using the track's `shortName`:
    - pass upcoming: `` `${name} in ${countdown(start - now)}, max ${Math.round(maxElevDeg)}°` ``
    - pass in progress: `` `${name} now, max ${E}°` ``
    - stationary visible: `` `${name} fixed at azimuth ${Math.round(az)}°, ${Math.round(el)}° up` ``
    - stationary not visible: `` `${name} never rises here` ``
    - none: `` `${name}: no passes in the next 2 days` ``
    - unavailable: `` `${name}: these elements can't be used to compute passes` ``
    - missing: `` `Satellite ${noradId} isn't in the catalog right now` ``

- [ ] **Step 1: Write the failing tests**, with `T0` from Plan 2's fixtures:
  - ISS from EN52VE at `T0` gives a `pass` card whose headline matches `/^ISS in (\d+ min|\d+ h \d+ min), max \d+°$/`.
  - GOES-16 at 2026-10-31T15:00Z gives a headline matching `/^GOES 16 fixed at azimuth 20[34]°, 3[89]° up$/`.
  - A missing id renders its line.
  - A dead track (`ecefAt: () => null`) gives `unavailable`.
  - The ordering puts an in-progress pass first.
  - `countdown` checks: `0` gives `under a minute`, `42 * 60_000` gives `42 min`, `(2 * 60 + 5) * 60_000` gives `2 h 5 min`, `27 * 3_600_000` gives `1 day 3 h`, and `51 * 3_600_000` gives `2 days 3 h`.
- [ ] **Step 2: Run** `node --test test/home-next-up.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/home/next-up.mjs`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add next-up pass card logic"`.

---

### Task 6: Pass card plot and controlled chart modals

**Files:**
- Modify:
  - `lib/passes/charts.js` (add `paintPassCard`)
  - `components/passes/PolarPlot.tsx` (split out the skeleton)
  - `components/passes/PolarModal.tsx`, `components/passes/RadioModal.tsx` (split view from store wiring)
  - `test/passes-charts.test.mjs`
- Create: `components/passes/PolarPlotSvg.tsx`, `components/passes/SkyChartModalView.tsx`, `components/passes/RadioChartModalView.tsx`

**Interfaces:**
- Consumes: the painters in `lib/pass-finder/polar-arc.js` (`computeArcSamples`, `renderArcSegments`), `polar-icon.js` (`paintIconEvents`, `paintIconSunMoon`), `sky-helpers.js` (`chartPalette`, `skyShadeForSunAlt`), `visibility.js` (`satAltAzDeg`, `sunAltitudeDeg`), `lib/refraction.js` (`apparentAltDeg`), and `altAzToSvg` from wherever the scene imports it.
- Produces:
  - `paintPassCard(svgEl, { track, obs, win, nowMs })`. It fills the skeleton's `.horizon`, `.arc`, `.events`, `.bodies` and `.iss-dot`, matching today's observer-card painting (the scene's `updatePolarPlotHorizon/Arc/Events/Bodies/Dot`, which stay in the scene):
    - **Geometry:** `cx = cy = 50`, `R = 45`.
    - **Arc:** 30 samples, stroke `chartPalette(sunAlt).arc`, dash `"4 6"`.
    - **Events:** marker radius 2.8, with the peak at `bestMomentMs(win, [obs], track.ecefAt)`.
    - **Bodies:** radius 2.4.
    - **Sun altitude** is the apparent value at the pass peak. The sky is shown at the pass, which is what the modal does.
    - **Dot:** shown only when the satellite is above the horizon at `nowMs`.
  - `PolarPlotSvg`: a forwardRef skeleton, exactly today's `PolarPlot` markup. `PolarPlot` becomes a thin wrapper that paints through the bridge, so the classic app renders identically.
  - `SkyChartModalView({ open, title, render, onClose })`, with `render(svgEl) => Promise<{ blobUrl, filename } | null>`, and `RadioChartModalView({ open, title, render, csv, freqHz, onFreqChange, onClose })`. Both are today's modal chrome and behaviour: Escape and backdrop close, Save, Copy, CSV and the frequency input, extracted unchanged.
  - `PolarModal` and `RadioModal` keep their current names and behaviour by wrapping the views with the store and the bridge.

- [ ] **Step 1: Write the failing test** in `test/passes-charts.test.mjs`, using `newSvgRoot` from `lib/og/dom.mjs`. Build a skeleton with the classes `.horizon .arc .events .bodies .iss-dot`, then call `paintPassCard` for the first ISS pass from EN52VE.
  - The `.arc` gains path children.
  - `.events` gains the 3 markers.
  - The horizon gets a `fill` style.
  - With `nowMs` outside the pass, the dot is hidden (`style.display === 'none'`).
- [ ] **Step 2: Run** `node --test test/passes-charts.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `paintPassCard`, then the component splits.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `git commit -m "refactor: Make pass card plots and chart modals usable outside the 3D scene"`.

---

### Task 7: Search bar and pasted elements

**Files:**
- Create: `components/home/SearchBar.tsx`, `lib/home/search.mjs`, `test/home-search.test.mjs`

**Interfaces:**
- Consumes: `useHomeStore` (`follow`, `addCustom`, `prefs.following`) from Task 4, and `/api/search?q=` (returns `{ results: [{ noradId, name }] }`).
- Produces:
  - `searchQuery(text) -> string | null`: the trimmed text, or null when it is shorter than 2 characters. A run of 1 to 9 digits is always valid. Text is capped at 64 characters.
  - `searchUrl(q) -> string` (`/api/search?q=<encoded>`).
  - `<SearchBar />`, pinned on top.
    - Input `placeholder="Search by name or NORAD ID"`.
    - It searches after 250 ms of no typing, cancelling any older request (AbortController).
    - Results are a listbox with arrow-key navigation, and Enter or a click follows the satellite and selects it on the map.
    - Followed results show `Following`.
    - A `Paste elements` button opens a textarea labelled `Paste a 2LE or 3LE element set`, with an `Add` button. Errors show the `ElementsError` message inline.
    - The empty-result copy is `No satellites match "<q>".`. A failed request shows `Search isn't available right now.`

- [ ] **Step 1: Write the failing tests** for `searchQuery`:
  - `'i'` gives null; `'5'` gives `'5'`; `'  iss '` gives `'iss'`;
  - a 70-character string gives a 64-character string;
  - `searchUrl('a b&c')` gives `/api/search?q=a%20b%26c`.
- [ ] **Step 2: Run** `node --test test/home-search.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/home/search.mjs` and `SearchBar.tsx`.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add satellite search and pasted elements to the home screen"`.

---

### Task 8: Home screen assembly and location prompt

**Files:**
- Create: `components/home/HomeApp.tsx`, `components/home/NextUpList.tsx`, `components/home/LocationPrompt.tsx`, `components/home/HomeControls.tsx`, `app/home.css`

**Interfaces:**
- Consumes:
  - Tasks 3 to 7
  - `parseLocationInput` (`lib/location/maidenhead.mjs`) and `geocodeOne` (`lib/pass-finder/geocode.js`)
  - `passToIcs` and `icsFileName` (`lib/passes/ics.mjs`)
  - `paintSkyChart`, `radioSeries`, `radioChartOptions` and `radioCsvText` (`lib/passes/charts.js`), with `svgToPngBlob` (`lib/pass-finder/polar-png.js`) and `paintRadioChart` (`lib/pass-finder/radio-chart.js`)
- Produces `<HomeApp initialRecords />`, laid out top to bottom:
  1. `SearchBar`
  2. `FlatMap`
  3. `HomeControls`: a mode toggle `Radio` / `Visual` and a minimum elevation stepper, 0 to 45° in steps of 5°, both saved in prefs. It also shows the location's name, with a `Change` link that opens `LocationPrompt`.
  4. `NextUpList`, or `LocationPrompt` plus a popular list when `prefs.location` is null.
- Behaviour:
  - **Positions:** recomputed every 1 s from tracks (`subpoint`). Cards recompute when tracks, location, mode or minimum elevation change, and every 10 min.
  - **No location** (Review Focus 4): the map still shows the followed satellites. `LocationPrompt` offers the following:
    - A `Use my location` button using `navigator.geolocation`. On a denial it shows `Location access was denied. Type a place or grid square instead.`
    - A text field with `placeholder='Place, "lat, lon" or grid square (EN52ve)'`. A grid or coordinates are used directly. A place goes through `geocodeOne`, and `No place found for "<text>".` shows when nothing matches.
    - Once set, the location is saved with the right `source`.
    - Below it, `Popular satellites` lists the `POPULAR_IDS` names with a follow toggle.
  - **Each pass card shows:**
    - a `PolarPlotSvg` painted by `paintPassCard`;
    - `cardHeadline`;
    - a second line with the local start–end times in the browser's timezone, the duration (`formatPassDuration`), and a `visible` tag when `pass.visible`;
    - the buttons `Sky chart`, `Radio chart`, `📅` (`aria-label="Add to calendar"`, an `.ics` via `passToIcs` with `url: null`) and `Unfollow`.
  - **Other cards** show their headline plus `Unfollow`.
  - **Modals:** `Sky chart` opens `SkyChartModalView`, whose `render` calls `paintSkyChart(svgEl, { track, obs, win })`, then `svgToPngBlob` and an object URL. The file name comes from `passFileName(track, obs, peakMs, 'sky')`. `Radio chart` opens `RadioChartModalView`, built from `radioSeries` / `radioChartOptions` / `paintRadioChart`, with the CSV from `radioCsvText`. The frequency defaults to the track's first downlink and otherwise is blank; for no frequency, the chart behaves as the classic app does.
  - **Errors:** a store `status` of `error` shows a banner with the error message and a `Try again` button calling `loadRecords()`.
  - **Missing satellites:** a missing id shows its card line (Task 5).
  - **Accessibility:** cards are a `<ul>` and modals trap focus as the extracted views already do.

- [ ] **Step 1: Build the components as specified.** There are no new pure modules, so the tests are the Tasks 1 to 7 suites plus `npx tsc --noEmit`.
- [ ] **Step 2: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 3: Commit** with `git commit -m "feat: Assemble the home screen with map, next-up cards and location prompt"`.

---

### Task 9: Routes: new home at `/`, Cesium app at `/classic`

**Files:**
- Create: `app/classic/page.tsx` (today's `app/page.tsx` body), `app/classic/layout.tsx` (loads `CesiumLoader` and `pass-finder.css`)
- Modify:
  - `app/page.tsx` (render `HomeApp`)
  - `app/layout.tsx` (remove `CesiumLoader` and any Cesium preload from the root)
  - `next.config.ts` (redirect)
  - `app/sitemap.ts` (keep `/`, do not list `/classic`)

**Interfaces:**
- `/classic` keeps everything today's home has: `generateMetadata` with `ogImageMetadata(s)`, the satellite seed via `readInitialSatelliteTles`, and the full `PassFinderApp`. It adds `robots: { index: false }`.
- `next.config.ts` `redirects()`: `{ source: '/', has: [{ type: 'query', key: 's' }], destination: '/classic', permanent: false }`. Next keeps the query string on the redirect.
- `/` is a server component.
  - It reads `initialRecords` for `POPULAR_IDS` from the snapshot only (`getCatalogReader().getSnapshotRecord`), raced against 1.5 s with an empty fallback, the same pattern as `lib/mirror/seed.mjs`.
  - It renders `<HomeApp initialRecords={...} />`.
  - Its metadata is the site default (the static og.png).
- `buildShareUrl` in the scene still produces `/?s=...`, which now redirects to `/classic`, so classic share links keep working. Do not change the scene.
- The CSP and headers are unchanged.

- [ ] **Step 1: Move and rewire as specified.** Run `grep -rn "CesiumLoader\|cesium.com" app components`. Expected: hits only under `app/classic/` and in the CSP comment and values in `next.config.ts`.
- [ ] **Step 2: Run** `npm test` and `npx tsc --noEmit`, then `npm run build`. Expected: PASS, clean, and the build succeeds. Also confirm from the build output that `/` does not include Cesium. The build reads no CelesTrak.
- [ ] **Step 3: Manual check for Aaron** (`npm run dev`; the local server reads the shared Blob snapshot):
  1. `/` loads fast on a phone-sized window (360 px wide, then rotated) with no globe and a sharp map. The map shows ISS, Tiangong, Meteor-M2 3 and NOAA 19, with tracks, day and night shading, and no lines across the map at ±180°.
  2. The projection menu switches between all six options. `Centered on you` and `From the satellite` are disabled until a location or selected satellite exists, and the choice persists on reload.
  3. With no location, the prompt and popular list appear. `EN52ve` sets the location, and the cards fill with headlines like `ISS in 42 min, max 67°`.
  4. `Sky chart` and `Radio chart` on a card look exactly like the classic app's, and Save, Copy and CSV work. `📅` downloads an `.ics`.
  5. Searching `goes 16` and following it gives a `fixed at azimuth …` card. Pasting a 3LE adds a satellite, and a bad paste shows the line-specific error.
  6. An old `/?s=...` link opens the classic app on the same pass. `/classic` works as before, and the browser console shows no CSP errors on either page.
  7. Private browsing (no localStorage) still loads `/` with the defaults.
- [ ] **Step 4: Commit** with `git commit -m "feat: Make the new home screen the front page and move the 3D app to /classic"`.
