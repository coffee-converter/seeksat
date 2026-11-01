# Satellite Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A crawlable, shareable page per satellite at `/sat/<noradId>` with honest live numbers, an orbit diagram, a small map, passes from your location (with joint observers), downlinks and raw elements. Pass search moves off the main thread, the MCP server runs on the one pass engine, and the leftovers from Plan 3 are done.

**Architecture:**
- **Pure layers:** honest numbers, the orbit diagram geometry, page data and pass-row formatting are pure modules in `lib/sat/`. Pass jobs run in a Web Worker through `lib/passes/pass-client.mjs`, which falls back to the main thread.
- **Server:** `app/sat/[id]/page.tsx` is built on first request and cached for an hour (ISR). It renders real numbers for crawlers and link previews, and the client takes them live.
- **Client:** `components/sat/` reuses the home store (location, mode, minimum elevation, following, projection), `FlatMap`, `LocationPrompt`, `HomeControls` and the chart modals. The modals load lazily on both pages.

**Tech Stack:** Next.js 15 App Router (ISR, `generateMetadata`, `notFound`, `permanentRedirect`, `next/dynamic`), React 19, Zustand 5, satellite.js 6.0.2, d3-geo, resvg-wasm (existing OG pipeline), `node --test` with linkedom.

**Spec:** `docs/superpowers/specs/2026-10-30-any-satellite-tracker-design.md`, sections 6.3, 6.4, 6.5, 6.5a, 6.7 (serving, sitemap) and 9 (MCP, link previews). Plans 1 to 3 are done and live in `docs/superpowers/plans/`.

## Global Constraints

- **CelesTrak:** never call it from a developer machine. Tests use `test/fixtures/` and make no network calls. Pages and routes read through `getCatalogReader()`, whose on-demand CATNR path runs only in production (`onDemandFor`). The sitemap and preview images read the snapshot only (`getSnapshotRecord`, or the snapshot id list), so crawlers never spend the on-demand budget.
- **Honesty:** every number says what it is (inertial vs ground speed, altitude vs distance from center, mean vs live) and where it came from. "How we compute this" lines are visible text, never tooltips.
- **Weight:** no Cesium off `/classic`. No new external origins, so the CSP is unchanged. Chart painters load only when a chart opens.
- **Phone-friendly:** works at 360 px wide with no horizontal page scroll. Inputs are at least 16 px on touch screens so iOS does not zoom.
- **Look:** dark theme and Exo 2 as today. The sky chart and radio chart keep their exact look.
- **Anti-goals still binding:** `/?s=` links keep working (unchanged here), and the MCP tools keep their output shape (fields are only added).
- **Copy:** plain language, no em dashes. All copy in quotes in this plan is exact.
- **Device-only storage:** prefs stay in `seeksat.home.v1`; every storage access is wrapped and falls back to defaults.
- **Classic app:** untouched except where a task names it. Its accuracy note stays a tooltip until Cesium removal (Plan 5); the new pages show it as text.
- **Pass defaults:** search horizon `DEFAULT_SEARCH_DAYS = 10`, radio minimum elevation 10°, accuracy note past `ACCURACY_WARNING_DAYS = 3` of element age at the pass.
- **Tests and commits:** `npm test`, `npx tsc --noEmit`. Conventional commit prefixes, no AI attribution lines.

## Review Focus

1. **A NORAD ID above 99999.** It has no TLE form. The page shows the OMM and says why the 2LE and 3LE are missing, and nothing throws. Pinned in Task 6 (`rawElements`).
2. **Elements that won't propagate** (a decayed object, or a bad set). The page still renders its name and raw elements, says the numbers and passes can't be computed, and never crashes the server render. Pinned in Tasks 4, 6 and 10.
3. **Odd URLs:** `/sat/025544`, `/sat/25544-iss-zarya`, `/sat/abc`, `/sat/0`, `/sat/1234567890`. The first two redirect to `/sat/25544`, the rest are 404. Pinned in Task 6 (`parseSatParam`).
4. **A geostationary satellite's page.** The pass section shows a fixed pointing with rounded values, the orbit diagram fits its box, and the map does not break on a ground track that is nearly a dot. Pinned in Tasks 1, 5 and 10.
5. **Server and browser formatting numbers differently** (locale, time). That is a hydration error and a flicker. Numbers use a fixed `en-US` formatter, and the first client render uses the server's render time. Pinned in Task 4 (`formatNumber`) and Task 9 (first render at `data.renderedAtMs`).

---

### Task 1: Engine: rounded GEO pointing, null samples, missing tests

**Files:**
- Modify: `lib/passes/engine.mjs` (`stationaryPointing`), `test/passes-engine.test.mjs`, `test/fixtures/orbits.mjs`

**Interfaces:**
- Consumes: `makeTrack`, `recordFrom`, `EN52VE`, `GOES16_LINE1/2`; `satAltitudeDeg` (`lib/pass-finder/visibility.js`); `subpoint` (`lib/map/geometry.mjs`).
- Produces:
  - `stationaryPointing` returns `azDeg`, `elDeg`, `elMinDeg`, `elMaxDeg` rounded to 0.1°. It skips samples where `ecefAt` is null. `azDeg`/`elDeg` come from the first non-null sample. When no sample propagates for an observer, all four are `null`, and `findPasses` returns `{ kind: 'unavailable', reason: 'propagation' }`.
  - `test/fixtures/orbits.mjs` gains `withChecksum(line68) -> string` (recomputes the last digit: digits sum, `-` counts 1, mod 10) and `INCLINED_GEO_LINE1/2`: the GOES 16 lines with the inclination field (columns 9 to 16 of line 2) set to ` 12.0000`, checksummed.

- [ ] **Step 1: Write the failing tests**

```js
const round1 = (x) => Math.round(x * 10) / 10;
test('GEO pointing values are rounded to 0.1°', () => {
  const r = findPasses({ track: goes, observers: [EN52VE], startMs: GOES_T0 });
  for (const k of ['azDeg', 'elDeg', 'elMinDeg', 'elMaxDeg']) assert.equal(r.pointing[0][k], round1(r.pointing[0][k]));
});
test('GEO pointing skips samples that do not propagate', () => {
  const holey = { ...goes, ecefAt: (d) => ((d.getTime() - GOES_T0) % 1_200_000 === 600_000 ? null : goes.ecefAt(d)) };
  const p = findPasses({ track: holey, observers: [EN52VE], startMs: GOES_T0 }).pointing[0];
  for (const k of ['azDeg', 'elDeg', 'elMinDeg', 'elMaxDeg']) assert.ok(Number.isFinite(p[k]));
});
test('the last pass runs past a search end that cuts it', () => {
  const first = findPasses({ track: iss, observers: [EN52VE], startMs: ISS_T0 }).passes[0];
  const cut = findPasses({ track: iss, observers: [EN52VE], startMs: ISS_T0, endMs: first.peakMs }).passes;
  assert.equal(cut.at(-1).runsPastEnd, true);
  assert.equal(cut.at(-1).endMs, first.peakMs);
  assert.ok(cut.slice(0, -1).every((p) => !p.runsPastEnd));
});
test('an inclined geosynchronous orbit near the visibility edge has daily passes', () => {
  const t = makeTrack(recordFrom(INCLINED_GEO_LINE1, INCLINED_GEO_LINE2, 'INCLINED GEO'));
  assert.equal(t.orbitClass, 'geo');
  const lonDeg = subpoint(t.ecefAt(new Date(GOES_T0))).lonDeg;
  const r = findPasses({ track: t, observers: [{ id: 'far-north', latDeg: 70, lonDeg }], startMs: GOES_T0 });
  assert.equal(r.kind, 'passes');
  assert.ok(r.passes.length >= 5);
  assert.ok(r.passes.every((p) => p.durationMs < 24 * 3_600_000));
});
test('a joint pass reports the lower of the observers\' elevations at its peak', () => {
  const other = { id: 'b', latDeg: 41.0, lonDeg: -84.0 };
  for (const p of findPasses({ track: iss, observers: [EN52VE, other], startMs: ISS_T0 }).passes) {
    const e = iss.ecefAt(new Date(p.peakMs));
    assert.equal(p.maxElevDeg, round1(Math.min(satAltitudeDeg(EN52VE, e), satAltitudeDeg(other, e))));
  }
});
```

Use the file's existing ISS and GOES tracks and start times; name them `iss`, `ISS_T0`, `goes`, `GOES_T0` if they are not already.

- [ ] **Step 2: Run** `node --test test/passes-engine.test.mjs`. Expected: the rounding and fixture tests FAIL.
- [ ] **Step 3: Implement** the `stationaryPointing` changes and the fixture helpers.
- [ ] **Step 4: Run** the file, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "fix: Round GEO pointing, skip unpropagated samples and pin pass edge cases"`.

---

### Task 2: MCP on the pass engine

**Files:**
- Modify: `lib/mcp/passes.mjs`, `lib/mcp/tools.mjs`, `lib/mcp/pass-chart.mjs` (if it uses `nextPassWindow`), `test/mcp-passes.test.mjs`, `test/mcp-tools.test.mjs`

**Interfaces:**
- Consumes: `makeTrack(record, entry)`, `findPasses` (engine, Task 1).
- Produces:
  - `findPasses({ record, entry = null, observer, startMs, windowHours = 48, minElevationDeg = 10, mode = 'visual', standardMag = -1.8 }) -> { passes: PassRow[], stationary: Stationary | null, unavailable: boolean }`. It builds a Track and calls the engine with `endMs = startMs + windowHours h`.
    - `PassRow` keeps today's shape exactly (`rise`, `peak`, `set`, `peakElevationDeg`, `azimuthDeg: { rise, peak, set }`, `durationSec`, `peakMagnitude`, `sunlit`, `quality`) and adds `inProgress` (boolean). `peak` and `peakElevationDeg` come from the engine (`peakMs`, `maxElevDeg`). `sunlit` is `satIlluminated` at the peak. `peakMagnitude` and `quality` are computed as today from the window.
    - `Stationary = { azimuthDeg, elevationDeg, visible, note }` from the engine's pointing, with `note` exact: visible `"Geostationary: it stays at this point in your sky."`, not visible `"Geostationary: it never rises above the minimum elevation here."`.
  - `nextPassWindow(...)` keeps its signature and return (`{ win, peakMs } | null`), built from the engine's first pass.
  - Tools:
    - `find_passes` adds `stationary` (null for ordinary orbits).
    - `next_visible_pass` adds `stationary`, with `pass: null` for GEO.
    - `best_pass` skips GEO with reason `"geostationary: fixed in the sky, no passes"` and skips unavailable elements with `"elements can't be propagated"`.
  - The private `peakOf` and the module's own window search are deleted.

- [ ] **Step 1: Write the failing tests**

```js
test('GOES 16 from EN52ve: no passes, a fixed pointing', () => {
  const r = findPasses({ record: recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'), observer: EN52VE, startMs: GOES_T0 });
  assert.equal(r.passes.length, 0);
  assert.equal(r.stationary.visible, true);
  assert.ok(r.stationary.elevationDeg > 30 && r.stationary.elevationDeg < 45);
});
test('Molniya passes come back from the MCP search, several hours long', () => {
  const r = findPasses({ record: recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'MOLNIYA 1-91'), observer: EN52VE,
    startMs: MOLNIYA_T0, windowHours: 72, mode: 'radio' });
  assert.ok(r.passes.some((p) => p.durationSec > 4 * 3600));
});
test('MCP pass rows keep their shape', () => {
  const [p] = findPasses({ record: ISS_RECORD, observer: EN52VE, startMs: ISS_T0, mode: 'radio' }).passes;
  assert.deepEqual(Object.keys(p).sort(), ['azimuthDeg', 'durationSec', 'inProgress', 'peak', 'peakElevationDeg',
    'peakMagnitude', 'quality', 'rise', 'set', 'sunlit']);
});
test('best_pass skips a geostationary satellite with a reason', async () => {
  // deps.getRecord returns the GOES 16 record for 41866; input { satellite: 41866, lat, lon }
  assert.deepEqual(out.skipped, [{ satellite: 'GOES 16', reason: 'geostationary: fixed in the sky, no passes' }]);
});
```

Adapt the existing `test/mcp-passes.test.mjs` cases to the new return shape (`.passes`). `MOLNIYA_T0` is the fixture epoch plus one day.

- [ ] **Step 2: Run** `node --test test/mcp-passes.test.mjs test/mcp-tools.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** as specified. Pass `entry` from `requireRecord` so Tracks carry curated names.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, with `test/mcp-pass-chart.test.mjs` unchanged.
- [ ] **Step 5: Commit** with `git commit -m "refactor: Run MCP pass tools on the shared pass engine, with GEO pointing"`.

---

### Task 3: Curated downlinks for Meteor and SO-50

**Files:**
- Modify: `lib/catalog.mjs`, `test/catalog.test.mjs`

**Interfaces:**
- Produces three new `CATALOG` entries with every field the existing entries have (`tier: 'free'`, `standardMag: null`, `viewingHint: null`, `defaultMode: 'radio'`):

| noradId | name | shortName | aliases | inclinationDeg | downlinks |
|---|---|---|---|---|---|
| 57166 | `METEOR-M2 3` | `Meteor-M2 3` | `meteor-m2 3`, `meteor m2-3`, `meteor-m2-3` | 98.7 | 137.900 MHz `LRPT` mode `lrpt` duty `continuous` default; 137.100 MHz `LRPT alternate channel` mode `lrpt` duty `occasional` |
| 59051 | `METEOR-M2 4` | `Meteor-M2 4` | `meteor-m2 4`, `meteor m2-4`, `meteor-m2-4` | 98.7 | same two downlinks |
| 27607 | `SAUDISAT 1C (SO-50)` | `SO-50` | `so-50`, `so50`, `saudisat 1c` | 64.6 | 436.795 MHz `FM repeater` mode `fm` duty `on-demand` default |

- Source comments, in the existing style:
  - Meteor: `// Verified 2026-11-01 against WMO OSCAR (137.1 / 137.9 MHz LRPT) and SatNOGS DB (137.9 MHz). 137.9 is the usual channel; operators switch to 137.1 at times.`
  - SO-50: `// Verified 2026-11-01 against the AMSAT FM satellites page (uplink 145.850 MHz, 67.0 Hz tone; arm the 10-minute timer with a 74.4 Hz tone).`
- PO-101 is left out (AMSAT lists it as dying, and sources disagree on its frequencies).

- [ ] **Step 1: Update the catalog test.** Count 8. The new ids resolve by alias. `defaultDownlink` of 57166 is 137,900,000 Hz.
- [ ] **Step 2: Run** `node --test test/catalog.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Add the entries.** Run `grep -rn "CATALOG" lib components app test` and confirm no other test pins the count or the order. Update any that does.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add verified downlinks for Meteor-M2 3, Meteor-M2 4 and SO-50"`.

---

### Task 4: Honest numbers

**Files:**
- Create: `lib/sat/numbers.mjs`, `test/sat-numbers.test.mjs`
- Modify: `lib/home/view.mjs` (`elementTags` imports `OLD_AFTER_DAYS` instead of its own 168 h)

**Interfaces:**
- Consumes: `Track` (`stateAt(date) -> { rTeme, vTeme, rEcef } | null`, metres; `satrec.a` in Earth radii of 6378.135 km; `eccentricity`, `inclinationDeg`, `periodMs`); `OMEGA_EARTH` (`lib/pass-finder/sat-state.js`); `ecefToGeodetic` (`lib/coords.js`).
- Produces:
  - `GM_KM3_S2 = 398600.4418`, `EQUATORIAL_RADIUS_KM = 6378.137`, `OLD_AFTER_DAYS = 7`, `STALE_AFTER_DAYS = 14`
  - `liveNumbers(track, date) -> LiveNumbers | null` (null when `stateAt` is null). Fields:
    - `speedKmS`: |vTeme|.
    - `radiusKm`: |rTeme|.
    - `altitudeKm`: geodetic height of rEcef.
    - `latDeg`, `lonDeg`.
    - `groundSpeedKmS`: let v_rel = vTeme − ω×rTeme with ω = (0, 0, OMEGA_EARTH). Take its component perpendicular to rTeme, and scale by (radiusKm − altitudeKm) / radiusKm.
    - `v2rOverGM` = speed² · radius / GM.
    - `visViva` = 2 − radius / a, with a = `semiMajorAxisKm`.
    - `visVivaSpeedKmS` = sqrt(GM (2 / r − 1 / a)).
  - `orbitElements(track) -> { semiMajorAxisKm, eccentricity, inclinationDeg, periodMin, perigeeAltKm, apogeeAltKm }`. `semiMajorAxisKm = satrec.a × 6378.135`. Perigee and apogee are a(1 ∓ e) − EQUATORIAL_RADIUS_KM.
  - `elementAge(epochMs, nowMs) -> { ageDays, level: 'fresh' | 'old' | 'stale', text }`. `ageDays` has one decimal and is clamped at 0. The level is `old` over 7 days and `stale` over 14. Text:
    - under 1 h: `"Elements are less than an hour old"`
    - under 24 h: `"Elements are N hours old"` (`"1 hour"` singular)
    - otherwise: `"Elements are N days old"` with one decimal
  - `formatNumber(x, digits) -> string` via `Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })`. It returns `'n/a'` for a non-finite x.
  - `HOW_WE_COMPUTE`: exact copy, one line each.
    - `speed`: `"Inertial speed: the length of SGP4's velocity vector in the TEME frame. It is not the speed over the ground."`
    - `groundSpeed`: `"Ground speed: how fast the point below the satellite moves across Earth's surface, with Earth's rotation taken out."`
    - `altitude`: `"Height above the WGS84 ellipsoid, the standard model of Earth's shape, straight below the satellite."`
    - `radius`: `"Distance from Earth's center, from SGP4's position."`
    - `visViva`: `"v²r/GM uses the live speed and distance above, with GM = 398,600.4418 km³/s². Vis-viva says it equals 2 − r/a, where a is the mean semi-major axis. They agree as closely as SGP4's mean elements allow, usually within 1%."`
    - `elements`: `"Perigee, apogee, period, eccentricity, inclination and semi-major axis are mean elements from the published set, not instantaneous values. Perigee and apogee heights are above Earth's equatorial radius (6,378 km)."`
    - `epoch`: `"The epoch is the moment the element set describes. Positions get less accurate the further you are from it."`

- [ ] **Step 1: Write the failing tests**

```js
test('Molniya speed agrees with vis-viva to better than 1% around the orbit (spec success test)', () => {
  const m = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'MOLNIYA 1-91'));
  for (let i = 0; i < 24; i++) {
    const n = liveNumbers(m, new Date(MOLNIYA_T0 + (i * m.periodMs) / 24));
    assert.ok(Math.abs(n.speedKmS - n.visVivaSpeedKmS) / n.visVivaSpeedKmS < 0.01);
    assert.ok(Math.abs(n.v2rOverGM - n.visViva) < 0.02);
  }
});
test('Molniya mean elements', () => {
  const e = orbitElements(makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M')));
  assert.ok(e.perigeeAltKm > 1150 && e.perigeeAltKm < 1350);
  assert.ok(e.apogeeAltKm > 33400 && e.apogeeAltKm < 33800);
});
test('ISS: altitude, inertial speed and a lower ground speed', () => {
  const n = liveNumbers(iss, new Date(ISS_T0));
  assert.ok(n.altitudeKm > 380 && n.altitudeKm < 450);
  assert.ok(n.speedKmS > 7.6 && n.speedKmS < 7.7);
  assert.ok(n.groundSpeedKmS > 6.7 && n.groundSpeedKmS < 7.5);
});
test('GEO barely moves over the ground', () => {
  const n = liveNumbers(goes, new Date(GOES_T0));
  assert.ok(n.groundSpeedKmS < 0.05 && Math.abs(n.speedKmS - 3.07) < 0.02);
});
test('elements that do not propagate give no live numbers', () => {
  assert.equal(liveNumbers({ stateAt: () => null }, new Date()), null);
});
test('elementAge', () => {
  const E = Date.parse('2026-11-01T00:00:00Z'), H = 3_600_000;
  assert.deepEqual(elementAge(E, E + 2.3 * 24 * H), { ageDays: 2.3, level: 'fresh', text: 'Elements are 2.3 days old' });
  assert.equal(elementAge(E, E + 8 * 24 * H).level, 'old');
  assert.equal(elementAge(E, E + 15 * 24 * H).level, 'stale');
  assert.equal(elementAge(E, E + 5 * H).text, 'Elements are 5 hours old');
  assert.equal(elementAge(E, E - H).text, 'Elements are less than an hour old');
});
test('formatNumber is en-US whatever the process locale', () => {
  assert.equal(formatNumber(12345.678, 1), '12,345.7');
  assert.equal(formatNumber(NaN, 2), 'n/a');
});
```

- [ ] **Step 2: Run** `node --test test/sat-numbers.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/sat/numbers.mjs`, and point `elementTags` at `OLD_AFTER_DAYS * 24`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add honest live numbers, mean elements and element age"`.

---

### Task 5: Orbit diagram geometry

**Files:**
- Create: `lib/sat/orbit-diagram.mjs`, `test/sat-orbit-diagram.test.mjs`

**Interfaces:**
- Consumes: `Track` (`satrec.mo` rad, `satrec.no` rad/min, `satrec.a`, `epochMs`), `orbitElements` (Task 4).
- Produces `orbitDiagram(track, nowMs, { size = 240, pad = 16 } = {}) -> Diagram`:
  - `Diagram = { size, scale, earth: { cx, cy, r }, ellipse: { cx, cy, rx, ry }, perigee: { x, y }, apogee: { x, y }, dot: { x, y } | null }`, in SVG user units in a `size × size` box.
  - The orbit lies in its own plane, with Earth's center at the focus and perigee along +x. Motion is counterclockwise on screen, so y is flipped.
  - `scale` fits the union of the ellipse and Earth's disk (radius `EQUATORIAL_RADIUS_KM`) into `size − 2·pad`, centred in the box.
  - `dot` is the mean-element position at `nowMs`:
    1. Mean anomaly M = `mo + no · (nowMs − epochMs) / 60000`.
    2. Solve Kepler's equation for E by Newton's method, at most 20 iterations, to 1e-10.
    3. Get ν from E.
    4. r = a(1 − e cos E), at (r cos ν, r sin ν).
    5. The dot is null only when the elements are invalid (a ≤ 0).

- [ ] **Step 1: Write the failing tests**

```js
test('Molniya: the dot sits at perigee when the mean anomaly is zero, at apogee half a period later', () => {
  const m = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M'));
  const atPerigee = m.epochMs + ((2 * Math.PI - m.satrec.mo) / m.satrec.no) * 60_000;
  const d0 = orbitDiagram(m, atPerigee);
  assert.ok(Math.hypot(d0.dot.x - d0.perigee.x, d0.dot.y - d0.perigee.y) < 1);
  const d1 = orbitDiagram(m, atPerigee + m.periodMs / 2);
  assert.ok(Math.hypot(d1.dot.x - d1.apogee.x, d1.dot.y - d1.apogee.y) < 1);
});
test('ISS: a near circle hugging Earth', () => {
  const d = orbitDiagram(iss, ISS_T0);
  assert.ok(Math.abs(d.ellipse.rx - d.ellipse.ry) / d.ellipse.rx < 0.001);
  assert.ok(d.earth.r / d.ellipse.rx > 0.9);
});
test('every orbit class fits its box', () => {
  for (const t of [iss, goes, molniya]) {
    const d = orbitDiagram(t, Date.now(), { size: 240, pad: 16 });
    const { cx, cy, rx, ry } = d.ellipse;
    assert.ok(cx - rx >= 15.9 && cx + rx <= 224.1 && cy - ry >= 15.9 && cy + ry <= 224.1);
    assert.ok(d.earth.cx - d.earth.r >= 15.9 && d.earth.cx + d.earth.r <= 224.1);
  }
});
```

- [ ] **Step 2: Run** `node --test test/sat-orbit-diagram.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the module.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add orbit diagram geometry from mean elements"`.

---

### Task 6: Satellite page route, data and sitemap

**Files:**
- Create: `lib/sat/page-data.mjs`, `test/sat-page-data.test.mjs`, `app/sat/[id]/page.tsx`, `app/sat/[id]/not-found.tsx`, `components/sat/SatApp.tsx` (first, static version)
- Modify: `lib/mirror/reader.mjs` (add `noradIds()`), `test/mirror-reader.test.mjs`, `app/sitemap.ts`

**Interfaces:**
- Consumes: `getCatalogReader()` (`getRecord`, `getSnapshotRecord`, `generatedAtMs`), `resolveSatellite`, `displayName`, `isCurated` (`lib/catalog.mjs`), `makeTrack`, `liveNumbers`, `orbitElements`, `elementAge` (Task 4), `SITE_URL`.
- Produces:
  - `reader.noradIds() -> Promise<number[]>`, ascending, from the snapshot only (`[]` without one).
  - `parseSatParam(param: string) -> { id: number, canonical: boolean } | null`.
    - It accepts `/^(\d{1,9})(-[a-z0-9-]*)?$/i` with 1 ≤ id ≤ 999,999,999.
    - `canonical` is true only when `param === String(id)`.
  - `satPath(id) -> "/sat/<id>"`.
  - `rawElements(record, name) -> { twoLine: string | null, threeLine: string | null, omm: string | null, tooBigForTle: boolean }`.
    - The lines come from `record.line1`/`line2`, which the reader serves for IDs up to 99999.
    - `threeLine` is `name\nline1\nline2`.
    - `omm` is `JSON.stringify(record.omm, null, 2)`.
    - `tooBigForTle` is `noradId > 99999`.
  - `sourceLabel(record) -> string`:
    - `celestrak-gp`: `"CelesTrak GP data (groups: active, weather)"`, listing the record's groups.
    - `celestrak-catnr`: `"CelesTrak, looked up by catalog number"`.
    - otherwise: the raw source.
  - `satPageData(record, entry, nowMs) -> SatPageData` (plain, serializable; never throws):

    ```ts
    interface SatPageData {
      noradId: number; name: string; shortName: string; intlDesignator: string | null; // omm.OBJECT_ID
      note: string | null;            // curated viewingHint
      record: SatApiRecord;           // what the client builds its Track from
      downlinks: Downlink[];          // curated, else []
      source: string; fetchedAtMs: number | null; epochMs: number; groups: string[];
      elements: ReturnType<typeof orbitElements> | null;   // null when no Track can be built
      live: LiveNumbers | null;       // at renderedAtMs; null when it won't propagate
      age: ReturnType<typeof elementAge>;
      raw: ReturnType<typeof rawElements>;
      renderedAtMs: number;
    }
    ```

  - `satMetadata(data) -> Metadata fragment`:
    - `title`: `"<name> (NORAD <id>): live position and passes"`
    - `alternates.canonical`: `satPath(id)`
    - `description`: `"Live position, speed and passes for <name>, NORAD <id>. Orbit <perigee> by <apogee> km, period <period> min, inclination <incl>°."` The numbers are rounded to 0, 0, 1 and 1 decimals. Without elements it is `"Live position and passes for <name>, NORAD <id>."`
    - `openGraph`/`twitter` image tags are added in Task 12.
  - `app/sat/[id]/page.tsx`:
    - Exports `revalidate = 3600`, `dynamicParams = true` and `generateStaticParams() { return []; }`. `params` is a Promise in Next 15.
    - Flow: `parseSatParam`. Null → `notFound()`. Not canonical → `permanentRedirect(satPath(id))`. Then `getRecord(id)`; null → `notFound()`. Then `<SatApp data={satPageData(record, resolveSatellite(id), Date.now())} />`.
    - `generateMetadata` runs the same lookup.
  - `not-found.tsx` copy:
    - heading `"Satellite not found"`
    - body `"That satellite isn't in our catalog. It may have come down, or the number may be wrong."`
    - a link `"Back to SeekSat"` to `/`
  - `SatApp` (static version, server-renderable `"use client"`), in this order:
    - wordmark link to `/`
    - `<h1>` name
    - `"NORAD 25544 · 1998-067A"`
    - `note`
    - `age.text` and `source`
    - a `<dl>` of `data.elements` and `data.live` formatted with `formatNumber`
    - the raw elements in `<pre>` blocks

    Task 9 makes it live.
  - `app/sitemap.ts`:
    - async, `revalidate = 3600`
    - entries: `/`, then `/sat/<id>` for every `noradIds()` with `lastModified: new Date(generatedAtMs)`, using `SITE_URL`
    - if the reader fails or times out after 5 s, only `/`

- [ ] **Step 1: Write the failing tests**

```js
test('parseSatParam', () => {
  assert.deepEqual(parseSatParam('25544'), { id: 25544, canonical: true });
  assert.deepEqual(parseSatParam('25544-iss-zarya'), { id: 25544, canonical: false });
  assert.deepEqual(parseSatParam('025544'), { id: 25544, canonical: false });
  for (const bad of ['', 'abc', '0', '1e5', '1234567890', '-5', '25544_x']) assert.equal(parseSatParam(bad), null);
});
test('a six-digit catalog number has no TLE form', () => {
  const raw = rawElements({ noradId: 270001, omm: { NORAD_CAT_ID: 270001 } }, 'NEW OBJECT');
  assert.deepEqual([raw.twoLine, raw.threeLine, raw.tooBigForTle], [null, null, true]);
  assert.match(raw.omm, /270001/);
});
test('ISS page data', () => {
  const d = satPageData(ISS_SERVED_RECORD, resolveSatellite(25544), ISS_T0);
  assert.equal(d.name, 'ISS (ZARYA)');
  assert.equal(d.intlDesignator, '1998-067A');
  assert.ok(d.live.altitudeKm > 380);
  assert.match(d.raw.threeLine, /^ISS \(ZARYA\)\n1 25544U/);
  assert.doesNotThrow(() => JSON.stringify(d));
});
test('page data for elements that will not propagate', () => {
  const d = satPageData(DECAYED_RECORD, null, ISS_T0);
  assert.equal(d.live, null);
  assert.ok(d.raw.omm);
});
test('satMetadata', () => {
  const m = satMetadata(satPageData(ISS_SERVED_RECORD, resolveSatellite(25544), ISS_T0));
  assert.equal(m.title, 'ISS (ZARYA) (NORAD 25544): live position and passes');
  assert.equal(m.alternates.canonical, '/sat/25544');
  assert.ok(!m.description.includes('—'));
});
```

Fixture notes:
- `ISS_SERVED_RECORD`: the OMM ISS fixture (`test/fixtures/omm-iss.mjs`) passed through a memory-store reader's `getSnapshotRecord`, so it carries `line1`/`line2`.
- `DECAYED_RECORD`: the same OMM with `MEAN_MOTION: 17.5` and `EPOCH` set 400 days before `ISS_T0`. Confirm in the test that SGP4 rejects it (`makeTrack(...).stateAt(...)` is null). If it doesn't, raise the age until it does.
- Reader test: `noradIds()` returns sorted ids from a memory snapshot, and `[]` when the store is empty.

- [ ] **Step 2: Run** `node --test test/sat-page-data.test.mjs test/mirror-reader.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the module, the reader method, the route, not-found, the static `SatApp` and the sitemap. Check `app/robots.ts` allows `/sat/`.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add server-rendered satellite pages at /sat/<id> and list them in the sitemap"`.

---

### Task 7: Pass search in a Web Worker

**Files:**
- Create: `lib/passes/pass-jobs.mjs`, `lib/passes/pass.worker.js`, `lib/passes/pass-client.mjs`, `test/passes-worker.test.mjs`
- Modify: `components/home/HomeApp.tsx` (cards come from the runner)

**Interfaces:**
- Consumes: `tracksFor`, `followedTracks`, `nextUp`, `findPasses`, `makeTrack`, `CATALOG`.
- Produces:
  - `runPassJob(job) -> result` (pure; builds Tracks from plain records):
    - `{ kind: 'next-up', records: SatApiRecord[], custom, following, missing, observer, mode, minElevDeg, nowMs }` gives the `nextUp` cards.
    - `{ kind: 'passes', record, observers, mode, minElevDeg, startMs, endMs? }` gives the engine result. A record that fails `makeTrack` gives `{ kind: 'unavailable', reason: 'elements' }`.
  - `pass.worker.js`: on `{ id, job }`, it posts `{ id, ok: true, result }` or `{ id, ok: false, error }`.
  - `createPassRunner({ makeWorker = defaultMakeWorker } = {}) -> { run(job): Promise<result>, dispose() }`.
    - `defaultMakeWorker` returns `new Worker(new URL('./pass.worker.js', import.meta.url), { type: 'module' })` when `Worker` exists, else null.
    - With no worker, or after a worker `error` event, it runs every job inline from then on. Jobs waiting at that moment are re-run inline.
    - `ok: false` rejects that job only.
  - `getPassRunner()`: a lazy singleton for components.
  - HomeApp sends the next-up job. It keeps a request counter and ignores results that are not the latest. Cards stay as they were while a job runs.

- [ ] **Step 1: Write the failing tests**

```js
test('next-up job equals calling nextUp directly', () => { /* ISS fixture record, EN52VE, radio, 10°, ISS_T0 */ });
test('passes job for GOES 16 is stationary', () => {});
test('a broken record gives unavailable, not a throw', () => {});
test('runner with a fake worker resolves through postMessage', async () => {
  // fake: { postMessage(m) { setTimeout(() => this.onmessage({ data: { id: m.id, ok: true, result: runPassJob(m.job) } })) } }
});
test('runner falls back inline after a worker error, including the job in flight', async () => {});
test('runner with no Worker runs inline', async () => {});
```

- [ ] **Step 2: Run** `node --test test/passes-worker.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the job runner, worker and client, and switch HomeApp. Records are posted as plain objects, so convert the `Map` with `[...map.values()]`.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build emits a worker chunk. Report its name.
- [ ] **Step 5: Commit** with `git commit -m "perf: Run pass search in a Web Worker with a main-thread fallback"`.

---

### Task 8: Lazy chart modals and a light card painter

**Files:**
- Create: `lib/passes/card-chart.js` (move `paintPassCard` and its private constants here), `components/passes/PassChartModals.tsx`, `test/bundle-split.test.mjs`
- Modify: `lib/passes/charts.js`, `components/home/NextUpList.tsx`, `components/passes/PolarPlotSvg.tsx` (comment), `lib/pass-finder-scene.js` (import path, if it imports `paintPassCard`), `test/passes-charts.test.mjs` (import path)

**Interfaces:**
- Produces:
  - `paintPassCard` from `lib/passes/card-chart.js`, with an unchanged signature and output. `charts.js` keeps everything else and does not re-export it.
  - `<PassChartModals subject chart onChartChange onClose />` (default export) holds the sky and radio chart logic now inside `NextUpList`:
    - `subject: ChartSubject | null`, where `ChartSubject = { track, obs, pass, minElevDeg, jointWindow: { startMs, endMs } | null }`
    - `chart: 'sky' | 'radio' | null`
    - It owns `freqHz`, which resets to `defaultDownlink(track)?.hz ?? null` when the subject's `noradId` changes.
    - It passes `jointWindow` to `radioSeries`.
    - It renders `SkyChartModalView` and `RadioChartModalView` with today's titles, `subjectKey`, CSV and file names.
  - `NextUpList` loads it with `next/dynamic(() => import('@/components/passes/PassChartModals'), { ssr: false })`. It mounts it only after the first chart open, so the chunk loads on that first click. Focus return to the trigger stays in `NextUpList`.
- Test: `test/bundle-split.test.mjs` walks static imports from `components/home/HomeApp.tsx`.
  - It resolves relative paths and `@/`, and tries the extensions `.ts`, `.tsx`, `.js`, `.mjs` and `/index`.
  - It skips `import()` expressions and bare package names.
  - It asserts the reachable set contains none of `lib/passes/charts.js`, `lib/pass-finder/radio-chart.js`, `lib/pass-finder/constellations.js`, `lib/pass-finder/star-catalog.js` and `components/passes/RadioChartModalView.tsx`.

- [ ] **Step 1: Write** `test/bundle-split.test.mjs`. **Run** it. Expected: FAIL, naming the reachable chart modules.
- [ ] **Step 2: Implement** the move and the lazy modals.
- [ ] **Step 3: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean. Report `/`'s First Load JS before and after (Plan 3 measured about 201 kB).
- [ ] **Step 4: Commit** with `git commit -m "perf: Load chart modals on first use and split the card painter out"`.

---

### Task 9: Live satellite page

**Files:**
- Create: `components/sat/LiveNumbers.tsx`, `components/sat/OrbitDiagram.tsx`, `components/sat/RawElements.tsx`, `components/sat/Downlinks.tsx`, `app/sat.css`
- Modify: `components/sat/SatApp.tsx`

**Interfaces:**
- Consumes: `SatPageData` (Task 6); `useHomeStore` (`hydrate`, `prefs`, `follow`, `unfollow`, `setPrefs`); `followBlockedMessage`; `FlatMap`; `groundTrack`, `subpoint`, `footprintFeature`; `liveNumbers`, `orbitElements`, `elementAge`, `formatNumber`, `HOW_WE_COMPUTE` (Task 4); `orbitDiagram` (Task 5); `trueNow`; `SAT_PALETTE[0]` as the satellite color.
- Produces `SatApp`, laid out top to bottom:
  1. **Header:** the wordmark linking to `/`, the `<h1>` name, `"NORAD <id> · <intlDesignator>"` (the designator is omitted when null), and `note`. A `Follow` / `Following` toggle; at the cap it shows `followBlockedMessage`.
  2. **Element age:** `age.text`, then `", from <source>, fetched <relative time>."`. A badge `"old elements"` (level `old`) or `"stale elements: positions may be far off"` (level `stale`).
  3. **`LiveNumbers`:** a `<dl>` updating every second, with each value followed by its `HOW_WE_COMPUTE` line as visible small text. Rows and digits:
     - inertial speed: 3, km/s
     - ground speed: 3, km/s
     - altitude: 1, km
     - distance from center: 1, km
     - v²r/GM next to 2 − r/a: 4 each
     - perigee and apogee: 0, km
     - eccentricity: 7 when under 0.01, else 4
     - period: 2, min, plus `" (N h M min)"` over 600 min
     - inclination: 2, °
     - semi-major axis: 1, km
     - epoch: as ISO UTC to the second

     The first client render uses `data.renderedAtMs` (so it matches the server HTML). The clock starts after mount and pauses while the tab is hidden, as on the home page.
  4. **Map:** `FlatMap` with this one satellite, selected, with its footprint at `prefs.minElevDeg`, the observer, and `prefs.projection`.
  5. **`OrbitDiagram`:** an SVG of `orbitDiagram(track, nowMs)`. It shows the ellipse, Earth's disk, perigee and apogee markers labeled `perigee` / `apogee`, and the live dot in the satellite color. Caption: `"Drawn to scale in the orbit's own plane, from mean elements. Earth's center is at one focus."` It repaints every 10 s.
  6. **Passes:** the pass section placeholder (Task 10).
  7. **`Downlinks`:** heading `"Known downlinks"`. Each row reads like `"437.800 MHz, FM cross-band repeater (on-demand)"`. With none: `"No downlink frequencies are on file for this satellite. You can type one into the radio chart."`
  8. **`RawElements`:** headings `"2LE"`, `"3LE"`, `"OMM"`, each a `<pre>` with a `Copy` button (`navigator.clipboard.writeText`; it shows `"Copied"` for 2 s, and on failure selects the text). With `tooBigForTle`, in place of 2LE and 3LE: `"This catalog number is too big for the TLE format, so only the OMM form exists."`
  9. **Footer:** the same credit as the home page.
- If `data.live` is null or the Track can't be built: in place of items 3 to 5, `"These elements can't be used to compute a position."` Items 7 and 8 still show.
- **Styles:** `app/sat.css` (plus `app/home.css` for shared pieces), at 360 px with no horizontal scroll. `<pre>` blocks scroll inside themselves.

- [ ] **Step 1: Build** the components as specified. There are no new pure modules; the tests are Tasks 4 to 6 plus `npx tsc --noEmit`.
- [ ] **Step 2: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 3: Commit** with `git commit -m "feat: Make satellite pages live with numbers, map, orbit diagram and elements"`.

---

### Task 10: Passes on the satellite page

**Files:**
- Create: `lib/sat/pass-rows.mjs`, `test/sat-pass-rows.test.mjs`, `components/sat/PassSection.tsx`
- Modify: `components/sat/SatApp.tsx`, `app/sat.css`

**Interfaces:**
- Consumes: `getPassRunner().run({ kind: 'passes', ... })` (Task 7); `accuracyNote`, `DEFAULT_SEARCH_DAYS`; `formatPassDuration`; `PassChartModals` (Task 8, loaded with `next/dynamic` as in `NextUpList`); `passToIcs`, `icsFileName`; `LocationPrompt`; `HomeControls`.
- Produces:
  - `compass(azDeg) -> 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'`.
  - `passRows(result, { epochMs, nowMs, minElevDeg, mode, timeZone, locale }) -> View`:
    - `{ kind: 'rows', rows }`. Each row is `{ key, dayLabel, startLabel, peakLabel, endLabel, durationLabel, maxElevLabel, azLabel, visible, inProgress, runsPastEnd, accuracy, pass }`.
      - `dayLabel`: weekday, day, month (`'Sat 1 Nov'` in en-GB). The time labels are `HH:MM` in `timeZone`.
      - `azLabel`: `"NW 312° to SE 140°"`.
      - `maxElevLabel`: `"67°"`.
      - `accuracy`: `accuracyNote(epochMs, peakMs)?.text ?? null`.
    - `{ kind: 'message', text }`:
      - for no passes in visual mode: `"No visible passes in the next 10 days."`
      - for no passes in radio mode: `"No passes above <minElevDeg>° in the next 10 days."`
      - for unavailable: `"These elements can't be used to compute passes."`
    - `{ kind: 'stationary', text }`:
      - visible: `"Fixed in your sky at azimuth <az>°, elevation <el>°. Over a day it stays between <elMin>° and <elMax>° up."`
      - not visible, `elMaxDeg < 0`: `"It never rises here."`
      - otherwise: `"It never rises above <minElevDeg>° here."`
      - Values print with one decimal.
  - `PassSection` (heading `"Passes from your location"`):
    - **No location:** it shows `LocationPrompt`.
    - **Otherwise:**
      - `HomeControls` (mode, minimum elevation, location with `Change`).
      - `"Finding passes..."` while the job runs.
      - Then the view. A row shows the day, start to end time, duration, max elevation and az.
      - Tags: `visible`, `"up now"` when in progress, and `"continues past the 10-day search"` when it runs past the end.
      - The accuracy note shows as visible text under the row.
      - Buttons: `Sky chart`, `Radio chart` and `📅` (`aria-label="Add to calendar"`, `url: null`).
    - The search runs from `trueNow()` for `DEFAULT_SEARCH_DAYS`. It re-runs when location, mode, minimum elevation or observers change, and when the first row's pass ends.

- [ ] **Step 1: Write the failing tests**

```js
const opts = { epochMs: ISS_EPOCH, nowMs: ISS_T0, minElevDeg: 10, mode: 'radio', timeZone: 'UTC', locale: 'en-GB' };
test('rows for ISS passes', () => {
  const v = passRows(findPasses({ track: iss, observers: [EN52VE], startMs: ISS_T0 }), opts);
  assert.equal(v.kind, 'rows');
  assert.match(v.rows[0].startLabel, /^\d\d:\d\d$/);
  assert.match(v.rows[0].azLabel, /^(N|NE|E|SE|S|SW|W|NW) \d+° to (N|NE|E|SE|S|SW|W|NW) \d+°$/);
});
test('a pass far from the epoch carries the accuracy note', () => {
  const v = passRows(findPasses({ track: iss, observers: [EN52VE], startMs: ISS_EPOCH + 5 * DAY }), { ...opts, nowMs: ISS_EPOCH + 5 * DAY });
  assert.match(v.rows[0].accuracy, /days old at this pass/);
});
test('GOES 16 stationary text is rounded', () => {
  const v = passRows(findPasses({ track: goes, observers: [EN52VE], startMs: GOES_T0 }), opts);
  assert.match(v.text, /^Fixed in your sky at azimuth \d+\.\d°, elevation \d+\.\d°\./);
});
test('messages', () => {
  assert.equal(passRows({ kind: 'passes', passes: [] }, { ...opts, mode: 'visual' }).text, 'No visible passes in the next 10 days.');
  assert.equal(passRows({ kind: 'passes', passes: [] }, opts).text, 'No passes above 10° in the next 10 days.');
  assert.equal(passRows({ kind: 'unavailable' }, opts).text, "These elements can't be used to compute passes.");
});
test('compass', () => {
  assert.deepEqual([0, 22, 23, 180, 337, 338].map(compass), ['N', 'N', 'NE', 'S', 'NW', 'N']);
});
```

- [ ] **Step 2: Run** `node --test test/sat-pass-rows.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `pass-rows.mjs`, then `PassSection`, and mount it in `SatApp`.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `git commit -m "feat: Show 10 days of passes on satellite pages with charts and calendar export"`.

---

### Task 11: Joint observers on the satellite page

**Files:**
- Create: `components/sat/ExtraObservers.tsx`
- Modify: `lib/home/prefs.mjs`, `lib/home/actions.mjs`, `lib/home/store.ts`, `components/sat/PassSection.tsx`, `test/home-prefs.test.mjs`, `test/home-actions.test.mjs`

**Interfaces:**
- Consumes: `parseLocationInput` (`lib/location/maidenhead.mjs`), `geocodeOne` (`lib/pass-finder/geocode.js`).
- Produces:
  - Prefs gain `observers: Array<{ id: string, name: string, latDeg: number, lonDeg: number }>`, default `[]`, with `MAX_EXTRA_OBSERVERS = 3`. `parsePrefs` cleans the list: valid ranges, `id` matching `/^obs-\d+$/`, names cut to 60 characters, duplicates by id dropped, capped at 3.
  - `addObserverTo(prefs, { name, latDeg, lonDeg }) -> { prefs } | { error }`. The id is `obs-<n>` with the next unused n. At the cap: `"You can add up to 3 other places."`
  - `removeObserverFrom(prefs, id) -> prefs`.
  - Store: `addObserver(loc) -> { ok: true } | { ok: false, message }` and `removeObserver(id)`.
  - `ExtraObservers` UI:
    - Heading `"Also seen from"`, with the line `"Add other places to see only the times when every place can see it."`
    - A chip per observer with a remove button (`aria-label="Remove <name>"`).
    - A form with the same input rules as `LocationPrompt`: a grid square or coordinates are used directly, a place goes through `geocodeOne`, and `No place found for "<text>".` shows when nothing matches.
  - `PassSection` with observers sends `[home, ...observers]` to the job.
    - The heading becomes `"Passes everyone can see"`.
    - Rows are the joint windows; max elevation is the lowest, from the engine.
    - Charts use your location with `jointWindow: { startMs, endMs }` of the row.
    - `.ics` gets `observerCount`.

- [ ] **Step 1: Write the failing tests:** prefs clean garbage, the cap, duplicate ids and default `[]`; `addObserverTo` assigns `obs-1`, `obs-2`, and gives the cap message on the fourth; `removeObserverFrom`.
- [ ] **Step 2: Run** `node --test test/home-prefs.test.mjs test/home-actions.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the prefs, actions, store, `ExtraObservers` and the `PassSection` changes.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add joint observer windows to satellite pages"`.

---

### Task 12: Link-preview card for satellite pages

**Files:**
- Create: `lib/og/sat-card.mjs`, `lib/og/sat-og.mjs`, `app/api/og/sat/[id]/route.ts`, `test/og/sat-card.test.mjs`
- Modify: `lib/sat/page-data.mjs` (`satMetadata` adds images), `test/sat-page-data.test.mjs`

**Interfaces:**
- Consumes: `newSvgRoot`/`serialize` (`lib/og/dom.mjs`) or a string template; `rasterizeSvg` (`lib/og/rasterize.mjs`, Exo 2 fonts already embedded); `wrapText` (`lib/pass-finder/text.js`); `satPageData` (Task 6).
- Produces:
  - `buildSatCardSvg({ name, noradId, intlDesignator, elements, ageText }) -> string`. It is a 1200×630 SVG on the dark theme background, containing:
    - the `SeekSat` wordmark
    - the name wrapped at 24 characters, at most 2 lines
    - `"NORAD <id> · <designator>"`
    - `"Orbit <perigee> by <apogee> km · <period> min · <incl>°"` (omitted without elements)
    - `ageText`
    - All text is XML-escaped.
  - `satOgResponse(param, { reader, nowMs }) -> Promise<Response>`.
    - It parses with `parseSatParam` and reads with `reader.getSnapshotRecord` (never on-demand).
    - Missing or invalid gives 404 with `Cache-Control: public, s-maxage=600`.
    - Found gives `image/png` with `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`.
  - The route is a thin Node-runtime wrapper.
  - `satMetadata` adds:
    - `openGraph: { images: [{ url: '/api/og/sat/<id>', width: 1200, height: 630 }] }`
    - `twitter: { card: 'summary_large_image', images: ['/api/og/sat/<id>'] }`

- [ ] **Step 1: Write the failing tests:**
  - The card escapes `&` and `<` in names.
  - The card has no em dash.
  - A long name wraps to two lines.
  - `satOgResponse` returns 404 for `'abc'` and for an id missing from a memory reader.
  - It returns 200 with PNG signature bytes `89 50 4E 47` for the ISS fixture.
  - `satMetadata` image URLs are as above.
- [ ] **Step 2: Run** `node --test test/og/sat-card.test.mjs test/sat-page-data.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the card, the handler, the route and the metadata.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add link-preview cards for satellite pages"`.

---

### Task 13: Home leftovers: legend, About, page links, CSS fixes, final check

**Files:**
- Create: `lib/map/legend.mjs`, `test/map-legend.test.mjs`, `components/home/AboutSection.tsx`, `test/home-css.test.mjs`
- Modify: `components/home/FlatMap.tsx` (legend, a `minElevDeg` prop), `components/home/HomeApp.tsx`, `components/home/NextUpList.tsx` (a `Details` link per card), `components/sat/SatApp.tsx` (pass `minElevDeg`), `app/home.css`, `app/pass-finder.css`

**Interfaces:**
- Produces:
  - `legendItems({ sats, observer, minElevDeg }) -> Array<{ key, kind: 'sat' | 'track' | 'footprint' | 'night' | 'observer', label, color? }>`, in this order:
    1. One `sat` item per satellite, with its name and color.
    2. `track`: `"Line: ground track, from a quarter orbit ago to one orbit ahead"` (matches `groundTrack`'s span; for GEO only, `"Line: ground track over a day"`).
    3. `footprint`: `"Circle: where <selected name> is at least <minElevDeg>° up"`. Only when a satellite is selected.
    4. `night`: `"Shading: night, darker through twilight"`.
    5. `observer`: `"You"`. Only with an observer.
  - `FlatMap` renders it as `<ul className="map-legend">` under the canvas, with the swatches drawn in CSS to match `MAP_COLORS` and the satellite colors.
  - `AboutSection` is a `<details className="home-about">` with `<summary>About SeekSat</summary>`, placed above the footer on `/`. Its paragraphs are exact:
    - `"SeekSat tracks any satellite in the public catalog and finds its passes from where you are, for radio or for watching."`
    - `"Positions come from SGP4, the standard model for these element sets, using elements from CelesTrak that we refresh every few hours. Each satellite's page shows how old its elements are and how every number is worked out."`
    - `"Everything runs in your browser. Your location and the satellites you follow stay on this device. No accounts, no ads."`
    - `"AI agents can ask the same pass engine through MCP."`, where `MCP` links to `/mcp`.
  - Each home card gets a `Details` link to `/sat/<id>` (`aria-label="Details for <name>"`), except for pasted elements.
  - CSS:
    - `.flat-map` declares `height: max(220px, 50vh);` before `height: max(220px, 50svh);`.
    - Both stylesheets add the same rule, `@media (pointer: coarse) { .radio-freq-select, .radio-freq-input { font-size: 16px; } }`, so `home-css-drift` still passes.
    - `pass-finder.css` also lists `.radio-elev-input` in that rule.
- `test/home-css.test.mjs` asserts:
  - the vh-then-svh order inside the `.flat-map` block;
  - the coarse-pointer 16 px rule in both files.

- [ ] **Step 1: Write the failing tests** for `legendItems` (with and without a selection or observer, and the GEO track label) and the CSS assertions.
- [ ] **Step 2: Run** `node --test test/map-legend.test.mjs test/home-css.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the legend, About, links and CSS.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds. Report First Load JS for `/` and `/sat/[id]`.
- [ ] **Step 5: Manual check for Aaron** (`npm run dev`; local reads the shared Blob, never CelesTrak):
  1. `/sat/25544` on a phone-sized window:
     - the live numbers tick, with each "how we compute this" line visible;
     - the map shows the ISS with its footprint;
     - the orbit diagram shows a near circle hugging Earth;
     - 2LE, 3LE and OMM copy;
     - there are no hydration warnings in the console.
  2. `/sat/25485` (MOLNIYA 1-91), if the mirror has it:
     - the speed and the vis-viva comparison agree to under 1%;
     - the element age shows;
     - passes from EN52ve list long passes;
     - the dot moves along a long ellipse.

     If the mirror lacks it, the page is a 404 locally, because on-demand runs only in production.
  3. `/sat/41866` (GOES 16) shows `Fixed in your sky at azimuth ...` with one-decimal values.
  4. Charts and calendar export:
     - `Sky chart` and `Radio chart` from a satellite page row look exactly like the classic ones;
     - the radio chart frequency box doesn't zoom on an iPhone;
     - `📅` downloads an `.ics`.
  5. Add `FN31` as another place. The heading becomes `Passes everyone can see`, and rows narrow to the shared windows.
  6. `/sat/025544` and `/sat/25544-iss` redirect to `/sat/25544`, and `/sat/abc` shows `Satellite not found`.
  7. On `/`:
     - the legend is under the map and the About section opens;
     - a card's `Details` opens its satellite page;
     - the first chart click loads the modal and later clicks are instant;
     - cards still fill with no jank while scrolling.
  8. `/sitemap.xml` lists satellite pages.
  9. `/api/og/sat/25544` shows the preview card.
- [ ] **Step 6: Commit** with `git commit -m "feat: Add map legend, About section, satellite page links and touch-size chart inputs"`.
