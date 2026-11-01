# Any-Satellite Pass Engine and Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Cesium-free pass engine and chart layer that works for any satellite and any orbit (LEO, Molniya-type HEO, MEO, GEO), plus grid-square locations, pasted 2LE/3LE elements and calendar export, with the current app rewired onto it.

**Architecture:** A `Track` (built from a mirror record or pasted elements) owns the satrec, samplers and orbit class. `lib/passes/engine.mjs` turns a track plus observers into a pass list, a fixed GEO pointing, or "unavailable". `lib/passes/charts.js` is the sky chart and radio chart orchestration lifted out of `lib/pass-finder-scene.js`, taking explicit inputs instead of scene state. The existing pure painters in `lib/pass-finder/` are untouched apart from a rename of ISS-specific identifiers. The Cesium scene keeps running and becomes a caller of these modules. Plan 5 deletes it.

**Tech Stack:** Next.js App Router, React, Zustand, satellite.js 6.0.2, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-30-any-satellite-tracker-design.md`, sections 6.5, 6.6 and 8 ("Pass search for HEO/GEO"). Plan 1 (data layer, done) is `docs/superpowers/plans/2026-10-30-any-satellite-1-data-layer.md`.

**Roadmap after this plan** (reordered 2026-11-01, Claude's call, Aaron said "go with your plan"): 3 flat map and home screen, 4 satellite pages, 5 Cesium removal and share-link migration.

## Global Constraints

- Never call CelesTrak from a developer machine. Tests use the frozen fixtures in `test/fixtures/`. No network in tests.
- The look of the polar sky chart and radio chart does not change. Painters in `lib/pass-finder/` keep their output byte-for-byte except for renamed identifiers.
- Existing share links (`/?s=...`) and the MCP server keep working.
- All user-facing copy: plain language, no em dashes.
- Tests: `node --test`, run with `npm test` (`node --test test/*.{mjs,js} test/og/*.{mjs,js}`). Typecheck: `npx tsc --noEmit`.
- Commits use conventional prefixes (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`). No AI attribution lines in commit messages.
- Pass list horizon: next 10 days (spec 6.5).
- Radio default minimum elevation: 10° (spec 6.5).
- One pass engine serves the single-observer and joint (multi-observer) cases (spec 6.5).

## Review Focus

1. **A pass already in progress when the search starts.** The user expects it listed as "in progress", not with a rise time we never computed. Pinned in Task 4 (`inProgress`).
2. **Elements that will not propagate** (decayed object, SGP4 error at the search start). The user expects "can't compute passes for these elements", not "no passes". Pinned in Task 4 (`kind: 'unavailable'`).
3. **Messy pasted elements:** CRLF line endings, trailing spaces, a `0 ` name prefix, a single wrong digit. The user expects the first three to work and a plain error naming the bad line for the last. Pinned in Task 1.
4. **Grid squares at the edges and in odd case:** `en52VE`, 4- and 8-character squares, the poles and the antimeridian. The user expects valid squares to parse and invalid ones (`ZZ99`, `EN5`) to be rejected, never a wrong location. Pinned in Task 5.
5. **Calendar text with commas and semicolons** (an observer named "Elgin, IL; home"). The user expects the event to import with that name intact. Pinned in Task 6.

---

### Task 1: Tracks and pasted elements

**Files:**
- Create: `lib/sat/elements.mjs`, `lib/sat/track.mjs`, `test/fixtures/orbits.mjs`, `test/sat-elements.test.mjs`, `test/sat-track.test.mjs`
- Modify: `.gitignore` (commit the uncommitted `.env*` line the Vercel CLI added)

**Interfaces:**
- Consumes: `satrecFromRecord(record)` from `lib/sat/satrec.mjs`; `makeSatStateAt(sat, satrec)` from `lib/pass-finder/sat-state.js`; `ISS_LINE1`, `ISS_LINE2`, `ISS_OMM` from `test/fixtures/omm-iss.mjs`; `CATALOG` from `lib/catalog.mjs`.
- Produces:
  - `class ElementsError extends Error` (its `message` is user-facing copy).
  - `parseElements(text: string) -> SatRecord`, where `SatRecord = { noradId, name, line1, line2, epochMs, source: 'pasted', fetchedAtMs: null, groups: [] }`. This is the same shape the mirror serves, so `satrecFromRecord` accepts it.
  - `classifyOrbit({ meanMotionRevPerDay, eccentricity }) -> 'leo' | 'meo' | 'heo' | 'geo'`.
  - `makeTrack(record, entry = null) -> Track` with `Track = { noradId, name, shortName, standardMag, downlinks, record, epochMs, satrec, meanMotionRevPerDay, eccentricity, inclinationDeg, periodMs, orbitClass, ecefAt(date) -> [x, y, z] metres | null, stateAt(date) -> makeSatStateAt result | null }`.
  - `orbitTrackEcef(track, centerDate, samples = 360) -> number[][]`.
  - Fixtures: `MOLNIYA_LINE1`, `MOLNIYA_LINE2` (MOLNIYA 1-91, epoch 2023-06-27T03:03:14.710Z), `GOES16_LINE1`, `GOES16_LINE2` (epoch 2026-10-31T14:18:36.800Z), `EN52VE = { id: 'en52ve', name: 'EN52ve', latDeg: 42.1875, lonDeg: -88.2083 }`, and `recordFrom(line1, line2, name)` returning a `SatRecord`-shaped object with `source: 'fixture'`.

Fixture lines (verbatim):

```
MOLNIYA_LINE1 = '1 25485U 98054A   23178.12725359  .00000103  00000+0  00000+0 0  9997'
MOLNIYA_LINE2 = '2 25485  63.3372  91.8251 6791666 291.6975  11.8681  2.36444410187230'
GOES16_LINE1  = '1 41866U 16071A   26304.59625927 -.00000095  00000+0  00000+0 0  9993'
GOES16_LINE2  = '2 41866   0.6755  83.6414 0002750 164.7985 261.4686  1.00271572 36478'
```

Rules for `parseElements`:
- Split on `\r?\n`, trim each line and drop empty ones. Two lines means no name. Three means the first line is the name, with a leading `0 ` stripped.
- Each element line must start with `1 ` and `2 ` respectively and be 69 characters long.
- Checksum: the sum of the digits in columns 1 to 68, plus 1 for each `-`, mod 10, must equal column 69.
- The catalog number (columns 3 to 7) must be digits and the same on both lines.
- `name` falls back to `String(noradId)`. `epochMs` comes from the satrec (`jdsatepoch`).
- Error copy, exact:
  - Empty input or the wrong line count: `Paste two TLE lines, or three with a name line first.`
  - Wrong line prefix: `Line 1 must start with "1 " and line 2 with "2 ".`
  - Wrong length: `Each TLE line must be 69 characters long.`
  - Checksum failure: `Line 2 fails its checksum. Check for a copy or paste error.` (the line number varies)
  - Mismatched catalog numbers: `The two lines are for different satellites.`
  - Non-digit catalog number: `Catalog numbers with letters (Alpha-5) are not supported yet.`
  - `twoline2satrec` reporting an error: `These elements could not be read.`

Rules for `classifyOrbit`, checked in this order:
- `geo` when 0.9 ≤ n ≤ 1.1 rev/day and e < 0.1.
- `heo` when e ≥ 0.25.
- `leo` when n ≥ 11.25.
- `meo` otherwise.

Rules for `makeTrack`:
- `meanMotionRevPerDay = satrec.no * 1440 / (2π)` and `periodMs = 86_400_000 / meanMotionRevPerDay`.
- `name`: `entry?.name ?? record.name ?? String(noradId)`. `shortName`: `entry?.shortName ?? record.name ?? String(noradId)`.
- `standardMag`: `entry?.standardMag ?? null`. `downlinks`: `entry?.downlinks ?? []`.

`orbitTrackEcef` is `truth.js`'s `tleOrbitTrackEcef`, but uses `track.periodMs` instead of the hardcoded 93 minutes.

- [ ] **Step 1: Write the failing tests**

`test/sat-elements.test.mjs`:

```js
test('parses 2LE and 3LE, including CRLF, trailing spaces and a "0 " name line', () => {
  const r2 = parseElements(`${ISS_LINE1}\n${ISS_LINE2}`);
  assert.equal(r2.noradId, 25544);
  assert.equal(r2.name, '25544');
  assert.equal(r2.epochMs, Date.parse('2026-03-01T12:00:00Z'));
  assert.equal(r2.source, 'pasted');
  const r3 = parseElements(`0 ISS (ZARYA)  \r\n${ISS_LINE1}  \r\n${ISS_LINE2}\r\n`);
  assert.equal(r3.name, 'ISS (ZARYA)');
  assert.equal(r3.line1, ISS_LINE1);
});
test('rejects bad input with the exact copy', () => {
  const bad = ISS_LINE2.slice(0, 68) + String((Number(ISS_LINE2[68]) + 1) % 10);
  assert.throws(() => parseElements(`${ISS_LINE1}\n${bad}`), { message: 'Line 2 fails its checksum. Check for a copy or paste error.' });
  assert.throws(() => parseElements(''), { message: 'Paste two TLE lines, or three with a name line first.' });
  assert.throws(() => parseElements(`${ISS_LINE1}\n${MOLNIYA_LINE2}`), { message: 'The two lines are for different satellites.' });
  assert.throws(() => parseElements(`${ISS_LINE2}\n${ISS_LINE1}`), { message: 'Line 1 must start with "1 " and line 2 with "2 ".' });
  assert.throws(() => parseElements(`${ISS_LINE1.slice(0, 60)}\n${ISS_LINE2}`), { message: 'Each TLE line must be 69 characters long.' });
  assert.throws(() => parseElements('nonsense'), ElementsError);
});
```

`test/sat-track.test.mjs`:

```js
test('classifyOrbit', () => {
  assert.equal(classifyOrbit({ meanMotionRevPerDay: 15.5, eccentricity: 0.0005 }), 'leo');
  assert.equal(classifyOrbit({ meanMotionRevPerDay: 2.3644, eccentricity: 0.679 }), 'heo');
  assert.equal(classifyOrbit({ meanMotionRevPerDay: 1.0027, eccentricity: 0.0003 }), 'geo');
  assert.equal(classifyOrbit({ meanMotionRevPerDay: 2.0056, eccentricity: 0.01 }), 'meo');
});
test('makeTrack from TLE lines, OMM and a catalog entry', () => {
  const m = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'MOLNIYA 1-91'));
  assert.equal(m.orbitClass, 'heo');
  assert.ok(Math.abs(m.periodMs - 86_400_000 / 2.3644441) < 1000);
  assert.equal(m.standardMag, null);
  assert.deepEqual(m.downlinks, []);
  const iss = makeTrack({ noradId: 25544, name: 'ISS (ZARYA)', omm: ISS_OMM }, CATALOG.find((c) => c.noradId === 25544));
  assert.equal(iss.shortName, 'ISS');
  assert.equal(iss.standardMag, -1.8);
  assert.equal(iss.orbitClass, 'leo');
  const e = iss.ecefAt(new Date('2026-03-01T12:00:00Z'));
  assert.equal(e.length, 3);
  assert.ok(Math.hypot(...e) > 6.6e6 && Math.hypot(...e) < 6.9e6);
  assert.equal(makeTrack(recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16')).orbitClass, 'geo');
});
test('orbitTrackEcef spans one period of the track', () => {
  const m = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M'));
  const pts = orbitTrackEcef(m, new Date('2023-06-27T06:00:00Z'));
  assert.equal(pts.length, 360);
  const radii = pts.map((p) => Math.hypot(...p));
  assert.ok(Math.max(...radii) > 4e7, 'reaches Molniya apogee (~46,000 km)');
});
```

- [ ] **Step 2: Run the tests and confirm they fail** with `node --test test/sat-elements.test.mjs test/sat-track.test.mjs`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement** `lib/sat/elements.mjs`, `lib/sat/track.mjs` and `test/fixtures/orbits.mjs` as specified above.
- [ ] **Step 4: Run the tests and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .gitignore lib/sat/elements.mjs lib/sat/track.mjs test/fixtures/orbits.mjs test/sat-elements.test.mjs test/sat-track.test.mjs
git commit -m "feat: Add satellite tracks and pasted TLE parsing"
```

---

### Task 2: Rename ISS-specific identifiers

A mechanical rename with no behavior change. Spec 6.6 point 2.

**Files:**
- Modify: every file in `lib/pass-finder/`, `lib/mcp/passes.mjs`, `lib/mcp/pass-chart.mjs`, `lib/og/*.mjs`, `lib/pass-finder-scene.js`, `components/passes/PageLoader.tsx`, and the tests that import renamed names.
- Create: `test/no-iss-names.test.mjs`

**Interfaces:**
- Produces, with exact new names:
  - `visibility.js`: `issAltitudeDeg` → `satAltitudeDeg`, `issAltAzDeg` → `satAltAzDeg`, `issIlluminated` → `satIlluminated`. The option `minIssAltDeg` → `minSatAltDeg`.
  - `observer-pass.js`: `observerSeesIss` → `observerSeesSat`.
  - `polar-arc.js`: `issAlphaForMag` → `satAlphaForMag`.
  - `lib/og/tle.mjs`: `issEcefAtFactory` → `ecefAtFactory`. `getIssTle` keeps its name, because it really does fetch the ISS for the home-page preview.
  - Every parameter or local named `issEcef` → `satEcef`, `issEcefAtFn` or `issEcefAt` → `ecefAtFn` or `ecefAt`, including the scene's `issEcefAt` function.
  - `polar-png.js`: `polarModalFileNameFor(obs, ms, prefix, ext = "png")` loses the `"iss-pass"` default, so `prefix` becomes required. Every caller passes one, and the scene passes `` `${slug(selectedSatShortName(), "sat")}-pass` ``. ISS files stay named `iss-pass-...`.
  - `PageLoader.tsx` copy: `Asking ISS to slow down…` → `Asking the satellite to slow down…`.
- Comments that say "ISS" where they mean any satellite become "satellite". `fetchIssTle` in `lib/pass-finder/tle.js` stays: the triangulate page uses it.

- [ ] **Step 1: Write the failing guard test** `test/no-iss-names.test.mjs`. It imports every `lib/pass-finder/*.js` module (read the directory with `fs.readdirSync`) plus `lib/mcp/passes.mjs`, and asserts that no export name matches `/iss/i`, except `fetchIssTle` and `getIssTle`.
- [ ] **Step 2: Run it** with `node --test test/no-iss-names.test.mjs`. Expected: FAIL, listing `satAltitudeDeg`'s old name and the others.
- [ ] **Step 3: Apply the rename** across the listed files and their tests. `grep -rnE "issEcef|IssAlt|issAlt|issIllum|observerSeesIss|minIssAltDeg|issAlphaForMag|issEcefAtFactory" lib components test app` must print nothing.
- [ ] **Step 4: Run `npm test` and `npx tsc --noEmit`.** Expected: all tests pass, as many as before plus the guard test. Typecheck is clean.
- [ ] **Step 5: Commit**

```bash
git add -A lib components test
git commit -m "refactor: Rename ISS-specific pass identifiers to satellite-neutral names"
```

---

### Task 3: Orbit-aware per-observer pass walk

**Files:**
- Modify: `lib/pass-finder/observer-pass.js`, `lib/pass-finder/radio-window.js`, `lib/pass-finder/window-scoring.js`
- Test: `test/observer-pass-orbits.test.mjs` (new). The existing observer-pass and radio-window tests must keep passing unchanged.

**Interfaces:**
- Consumes: `makeTrack`, fixtures (Task 1); `observerSeesSat` (Task 2).
- Produces:
  - `passWindowAtMsForObserver(obs, anchorMs, mode, minElevDeg, ecefAtFn, opts = {})`, with `opts = { maxEdgeMs = 15 * 60_000, coarseStepMs = 1000 }`. It walks outward from the anchor at `coarseStepMs`. At the first out-of-view sample it bisects between the last in-view and first out-of-view times down to ≤ 1000 ms and returns the last in-view time. `clamped` keeps its meaning: the walk reached `maxEdgeMs` with the satellite still in view. With the default opts the results are identical to today.
  - `walkOptsForOrbit(orbitClass, periodMs) -> { maxEdgeMs, coarseStepMs }`: `leo` gives `{ maxEdgeMs: 15 * 60_000, coarseStepMs: 1000 }`, and any other class gives `{ maxEdgeMs: periodMs, coarseStepMs: 30_000 }`.
  - `radioChartWindows(obs, anchorMs, minElevDeg, ecefAtFn, opts = {})` passes `opts` to both walks.
  - `bestMomentMs(w, observers, ecefAtFn, stepMs = 5000)`.
  - `peakStepMsFor(durationMs) -> Math.max(5000, Math.ceil(durationMs / 2000))`.

- [ ] **Step 1: Write the failing tests**

```js
const m = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M'));
const anchor = Date.parse('2023-06-27T07:00:00Z'); // inside a ~365 min radio pass from EN52ve
test('a Molniya pass is walked to its real edges, not clamped', () => {
  const w = passWindowAtMsForObserver(EN52VE, anchor, 'radio', 10, m.ecefAt, walkOptsForOrbit('heo', m.periodMs));
  assert.equal(w.clamped, false);
  assert.ok(Math.abs((w.endMs - w.startMs) / 60_000 - 365.5) < 2, `${(w.endMs - w.startMs) / 60_000} min`);
});
test('the old LEO budget clamps the same pass', () => {
  const w = passWindowAtMsForObserver(EN52VE, anchor, 'radio', 10, m.ecefAt);
  assert.equal(w.clamped, true);
});
test('walkOptsForOrbit', () => {
  assert.deepEqual(walkOptsForOrbit('leo', 5_550_000), { maxEdgeMs: 900_000, coarseStepMs: 1000 });
  assert.deepEqual(walkOptsForOrbit('geo', 86_164_000), { maxEdgeMs: 86_164_000, coarseStepMs: 30_000 });
});
test('radioChartWindows carries opts to both walks', () => {
  const r = radioChartWindows(EN52VE, anchor, 10, m.ecefAt, walkOptsForOrbit('heo', m.periodMs));
  assert.equal(r.clamped, false);
  assert.ok(r.full.endMs - r.full.startMs >= r.workable.endMs - r.workable.startMs);
});
test('peakStepMsFor', () => {
  assert.equal(peakStepMsFor(5 * 60_000), 5000);
  assert.equal(peakStepMsFor(9 * 3_600_000), 16_200);
});
```

- [ ] **Step 2: Run** `node --test test/observer-pass-orbits.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run `npm test`.** Expected: PASS, with the existing observer-pass and radio-window tests unchanged.
- [ ] **Step 5: Commit** with `git commit -m "feat: Walk pass edges by orbit so long Molniya passes are not cut at 15 minutes"`.

---

### Task 4: Pass engine

**Files:**
- Create: `lib/passes/engine.mjs`, `lib/passes/format.mjs`, `test/passes-engine.test.mjs`, `test/passes-format.test.mjs`

**Interfaces:**
- Consumes: `Track` (Task 1); `findWindowsFromPredicate` (`search.js`); `observerSeesSat`, `walkOptsForOrbit` (Task 3); `satAltAzDeg`, `satIlluminated`, `sunAltitudeDeg` (Task 2); `apparentAltDeg` (`lib/refraction.js`); `sunPositionEcef`; `bestMomentMs`, `peakStepMsFor` (Task 3).
- Produces:
  - `DEFAULT_SEARCH_DAYS = 10`
  - `ACCURACY_WARNING_DAYS = 3`
  - `searchStepMsFor(orbitClass) -> 60_000` for `leo`, `120_000` otherwise.
  - `findPasses({ track, observers, mode = 'radio', minElevDeg = 10, startMs, endMs = startMs + DEFAULT_SEARCH_DAYS * 86_400_000 }) -> PassResult`, one of:
    - `{ kind: 'passes', passes: Pass[] }`
    - `{ kind: 'stationary', visible: boolean, pointing: Array<{ obsId, azDeg, elDeg, elMinDeg, elMaxDeg }> }`
    - `{ kind: 'unavailable', reason: 'propagation' }`
  - `Pass = { startMs, endMs, peakMs, durationMs, maxElevDeg, startAzDeg, peakAzDeg, endAzDeg, visible, inProgress, runsPastEnd }`
  - `accuracyNote(epochMs, passMs) -> null | { ageDays, text }`
  - `formatPassDuration(durationSec) -> string`, in `format.mjs`.

Rules:
- **Unavailable:** `track.ecefAt(new Date(startMs))` is null.
- **Stationary** (only when `track.orbitClass === 'geo'`):
  - Sample 24 h from `startMs` every 10 min, 145 samples per observer, taking apparent elevation and azimuth.
  - `elDeg`/`azDeg` are the values at `startMs`. `elMinDeg`/`elMaxDeg` come from the samples.
  - If every observer has `elMinDeg ≥ minElevDeg`, return `visible: true`. If any observer has `elMaxDeg < minElevDeg`, return `visible: false` ("never rises here").
  - Otherwise (an inclined geosynchronous satellite crossing the threshold daily) fall through to passes.
  - Mode does not change the stationary result.
- **Passes:**
  - Windows come from `findWindowsFromPredicate` with predicate `every observer: observerSeesSat(obs, ecef, date, mode, minElevDeg)` and step `searchStepMsFor(track.orbitClass)`. An observer list of length 1 is the single-observer case. Longer lists give joint windows.
  - `peakMs = bestMomentMs(w, observers, track.ecefAt, peakStepMsFor(w.endMs - w.startMs))`.
  - `maxElevDeg` is the lowest observer's geometric elevation at the peak, to 1 decimal.
  - Azimuths are for `observers[0]`, to 1 decimal.
  - `visible` means the satellite is sunlit at the peak and every observer's sun altitude at the peak is ≤ -6°.
  - `inProgress` is `w.startMs === startMs`. `runsPastEnd` is `w.endMs === endMs`.
- **Accuracy note:** `ageDays = (passMs - epochMs) / 86_400_000` rounded to 1 decimal. Return null when `ageDays ≤ ACCURACY_WARNING_DAYS`. Otherwise `text` is exactly `` `Elements are ${ageDays} days old at this pass, so times may be off by a minute or more.` ``
- **`formatPassDuration`:** below 3600 s it returns `5m18s` (zero-padded seconds, today's format). From 3600 s it returns `8h07m`.

- [ ] **Step 1: Write the failing tests** (`ISS = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'))`, `T0 = Date.parse('2026-03-01T12:00:00Z')`, `DAY = 86_400_000`):

```js
test('ISS from EN52ve: 17 radio passes in 3 days, the first at 13:16Z for about 5 minutes', () => {
  const r = findPasses({ track: ISS, observers: [EN52VE], mode: 'radio', startMs: T0, endMs: T0 + 3 * DAY });
  assert.equal(r.kind, 'passes');
  assert.equal(r.passes.length, 17);
  const p = r.passes[0];
  assert.ok(Math.abs(p.startMs - Date.parse('2026-03-01T13:16:00Z')) < 60_000);
  assert.ok(Math.abs(p.durationMs / 60_000 - 5.3) < 0.3);
  assert.ok(p.maxElevDeg >= 10 && p.maxElevDeg <= 90);
  assert.ok(p.peakMs > p.startMs && p.peakMs < p.endMs);
});
test('visual mode returns only visible passes', () => {
  const r = findPasses({ track: ISS, observers: [EN52VE], mode: 'visual', startMs: T0, endMs: T0 + 3 * DAY });
  assert.equal(r.passes.length, 4);
  assert.ok(r.passes.every((p) => p.visible));
});
test('Molniya passes last hours, some over 8', () => {
  const m = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M'));
  const s = Date.parse('2023-06-27T04:00:00Z');
  const r = findPasses({ track: m, observers: [EN52VE], mode: 'radio', startMs: s, endMs: s + 3 * DAY });
  assert.equal(r.passes.length, 7);
  assert.ok(r.passes.some((p) => p.durationMs > 8 * 3_600_000));
});
test('GOES-16 is a fixed pointing from EN52ve and never rises at 80° N', () => {
  const g = makeTrack(recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'));
  const s = Date.parse('2026-10-31T15:00:00Z');
  const here = findPasses({ track: g, observers: [EN52VE], startMs: s });
  assert.equal(here.kind, 'stationary');
  assert.equal(here.visible, true);
  const pt = here.pointing[0];
  assert.ok(pt.elDeg > 37.7 && pt.elDeg < 39.3);
  assert.ok(pt.azDeg > 203.3 && pt.azDeg < 204.2);
  const north = findPasses({ track: g, observers: [{ id: 'n', latDeg: 80, lonDeg: -88 }], startMs: s });
  assert.deepEqual([north.kind, north.visible], ['stationary', false]);
});
test('joint windows lie inside the single-observer windows', () => {
  const toronto = { id: 'yyz', latDeg: 43.65, lonDeg: -79.38 };
  const one = findPasses({ track: ISS, observers: [EN52VE], startMs: T0, endMs: T0 + 3 * DAY }).passes;
  const both = findPasses({ track: ISS, observers: [EN52VE, toronto], startMs: T0, endMs: T0 + 3 * DAY }).passes;
  assert.ok(both.length >= 1 && both.length <= one.length);
  for (const j of both) assert.ok(one.some((p) => p.startMs <= j.startMs && j.endMs <= p.endMs));
});
test('a pass in progress at the search start is flagged, not given a rise time', () => {
  const first = findPasses({ track: ISS, observers: [EN52VE], startMs: T0, endMs: T0 + DAY }).passes[0];
  const mid = Math.round((first.startMs + first.endMs) / 2);
  const p = findPasses({ track: ISS, observers: [EN52VE], startMs: mid, endMs: mid + DAY }).passes[0];
  assert.equal(p.inProgress, true);
  assert.equal(p.startMs, mid);
});
test('elements that will not propagate are unavailable, not "no passes"', () => {
  const dead = { ...ISS, ecefAt: () => null };
  assert.deepEqual(findPasses({ track: dead, observers: [EN52VE], startMs: T0 }), { kind: 'unavailable', reason: 'propagation' });
});
test('the default horizon is 10 days', () => {
  const r = findPasses({ track: ISS, observers: [EN52VE], startMs: T0 });
  assert.ok(r.passes.at(-1).endMs <= T0 + 10 * DAY);
  assert.ok(r.passes.at(-1).startMs > T0 + 9 * DAY);
});
test('accuracyNote', () => {
  assert.equal(accuracyNote(T0, T0 + 3 * DAY), null);
  assert.deepEqual(accuracyNote(T0, T0 + 4.24 * DAY), { ageDays: 4.2, text: 'Elements are 4.2 days old at this pass, so times may be off by a minute or more.' });
});
```

`test/passes-format.test.mjs`: `formatPassDuration(318) === '5m18s'`, `formatPassDuration(65) === '1m05s'`, `formatPassDuration(29_220) === '8h07m'`, `formatPassDuration(3600) === '1h00m'`.

- [ ] **Step 2: Run** `node --test test/passes-engine.test.mjs test/passes-format.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/passes/engine.mjs` and `lib/passes/format.mjs`.
- [ ] **Step 4: Run them again.** Expected: PASS. If the 10-day ISS search takes more than 2 s in node, say so in the report. A Web Worker is the spec's builder option (section 10), not part of this plan.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add any-orbit pass engine with GEO pointing and joint windows"`.

---

### Task 5: Grid squares and location input

**Files:**
- Create: `lib/location/maidenhead.mjs`, `test/maidenhead.test.mjs`
- Modify: `components/passes/AddObserverForm.tsx` (move `tryParseLatLon` into `parseLocationInput`, add the grid branch, update the placeholder)

**Interfaces:**
- Produces:
  - `gridToLatLon(grid) -> { latDeg, lonDeg } | null`: the centre of a 4-, 6- or 8-character square, case-insensitive. Field letters A–R, square digits 0–9, subsquare letters A–X, extended square digits 0–9.
  - `latLonToGrid(latDeg, lonDeg, chars = 6) -> string`: field in uppercase, subsquare in lowercase (`EN52ve`). Latitude is clamped into [-90, 90). Longitude is wrapped into [-180, 180).
  - `parseLocationInput(text)` returns one of:
    - `{ kind: 'grid', grid, latDeg, lonDeg }`, with `grid` in canonical case.
    - `{ kind: 'coords', latDeg, lonDeg }`, using today's `tryParseLatLon` logic and `parseDmsToDecimal`.
    - `{ kind: 'place', query }`.
    - `null` for blank input.
- Form behavior:
  - A `grid` result calls `addObserver(result.grid, result.latDeg, result.lonDeg)` without geocoding.
  - `coords` and `place` behave as today.
  - New placeholder, exact: `place, "lat, lon" or grid square (EN52ve)`.
  - Device geolocation and click-to-place stay as they are.

- [ ] **Step 1: Write the failing tests**

```js
test('EN52ve and EN52 centres', () => {
  const a = gridToLatLon('EN52ve');
  assert.ok(Math.abs(a.latDeg - 42.1875) < 1e-4 && Math.abs(a.lonDeg - -88.2083) < 1e-4);
  assert.deepEqual(gridToLatLon('EN52'), { latDeg: 42.5, lonDeg: -89 });
  assert.ok(gridToLatLon('en52VE'));
  assert.ok(gridToLatLon('EN52ve12'));
});
test('invalid squares are rejected', () => {
  for (const g of ['ZZ99', 'EN5', 'EN52v', 'EN52vz', '', 'EN52ve1']) assert.equal(gridToLatLon(g), null, g);
});
test('latLonToGrid, including poles and the antimeridian', () => {
  assert.equal(latLonToGrid(42.1875, -88.2083), 'EN52ve');
  assert.equal(latLonToGrid(90, 180), 'AR09ax');
  assert.equal(latLonToGrid(-90, -180), 'AA00aa');
  assert.equal(latLonToGrid(42.1875, -88.2083, 4), 'EN52');
});
test('parseLocationInput', () => {
  assert.deepEqual(parseLocationInput(' en52ve '), { kind: 'grid', grid: 'EN52ve', ...gridToLatLon('EN52ve') });
  assert.equal(parseLocationInput('42.19, -88.21').kind, 'coords');
  assert.deepEqual(parseLocationInput('Elgin, Illinois'), { kind: 'place', query: 'Elgin, Illinois' });
  assert.equal(parseLocationInput('   '), null);
});
```

The case `'Elgin, Illinois'` must stay a place. Both halves fail `parseDmsToDecimal`, so the coords branch returns null and the input falls through, as today.

- [ ] **Step 2: Run** `node --test test/maidenhead.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the module, then the form changes.
- [ ] **Step 4: Run `npm test` and `npx tsc --noEmit`.** Expected: PASS, clean.
- [ ] **Step 5: Commit** with `git commit -m "feat: Accept Maidenhead grid squares as observer locations"`.

---

### Task 6: Calendar export

**Files:**
- Create: `lib/passes/ics.mjs`, `test/passes-ics.test.mjs`

**Interfaces:**
- Consumes: `slug` from `lib/pass-finder/text.js`.
- Produces:
  - `passToIcs({ satName, noradId, observer: { name, latDeg, lonDeg }, pass: { startMs, endMs, peakMs, maxElevDeg, startAzDeg, endAzDeg }, mode, nowMs, url = null }) -> string`
  - `icsFileName(satShortName, observerName, startMs) -> string`

Output format:
- Lines joined with `\r\n`, ending with `\r\n`.
- A content line longer than 75 octets (UTF-8) is folded with `\r\n ` (CRLF plus one space), never splitting a multi-byte character.
- Times are UTC `YYYYMMDDTHHMMSSZ` with seconds floored.
- TEXT values escape `\` → `\\`, `;` → `\;`, `,` → `\,` and newline → `\n`.

The lines, in order:

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SeekSat//Passes//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:{noradId}-{startMs}-{slug(observer.name, 'observer')}@seeksat.app
DTSTAMP:{utc(nowMs)}
DTSTART:{utc(startMs)}
DTEND:{utc(endMs)}
SUMMARY:{satName} pass, max {Math.round(maxElevDeg)}°
LOCATION:{observer.name}
GEO:{latDeg.toFixed(4)};{lonDeg.toFixed(4)}
DESCRIPTION:{Radio|Visual} pass. Rises at azimuth {round startAz}°, peaks at {round maxElev}° at {HH:MM:SS} UTC, sets at azimuth {round endAz}°.
URL:{url}            (only when url is set)
END:VEVENT
END:VCALENDAR
```

`icsFileName` returns `` `${slug(satShortName, 'sat')}-pass-${slug(observerName, 'observer')}-${YYYYMMDDTHHMM}Z.ics` ``.

- [ ] **Step 1: Write the failing tests**

```js
const PASS = { startMs: Date.parse('2026-03-01T13:16:05.400Z'), endMs: Date.parse('2026-03-01T13:21:23.400Z'),
  peakMs: Date.parse('2026-03-01T13:18:45.400Z'), maxElevDeg: 34.6, startAzDeg: 204.4, endAzDeg: 75.2 };
const BASE = { satName: 'ISS', noradId: 25544, observer: { name: 'EN52ve', latDeg: 42.1875, lonDeg: -88.2083 },
  pass: PASS, mode: 'radio', nowMs: Date.parse('2026-03-01T12:00:00Z') };
test('full output for one pass', () => {
  assert.equal(passToIcs(BASE),
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SeekSat//Passes//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n' +
    'BEGIN:VEVENT\r\nUID:25544-1772370965400-en52ve@seeksat.app\r\nDTSTAMP:20260301T120000Z\r\n' +
    'DTSTART:20260301T131605Z\r\nDTEND:20260301T132123Z\r\nSUMMARY:ISS pass\\, max 35°\r\nLOCATION:EN52ve\r\n' +
    'GEO:42.1875;-88.2083\r\nDESCRIPTION:Radio pass. Rises at azimuth 204°\\, peaks at 35° at 13:18:45 \r\n' +
    ' UTC\\, sets at azimuth 75°.\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
});
test('commas and semicolons in names are escaped', () => {
  const ics = passToIcs({ ...BASE, observer: { ...BASE.observer, name: 'Elgin, IL; home' } });
  assert.ok(ics.includes('LOCATION:Elgin\\, IL\\; home'));
});
test('long lines fold at 75 octets without splitting characters', () => {
  const ics = passToIcs({ ...BASE, satName: 'Ä'.repeat(200) });
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.ok(ics.replace(/\r\n /g, '').includes(`SUMMARY:${'Ä'.repeat(200)} pass\\, max 35°`));
  assert.ok(!/[^\r]\n/.test(ics));
});
test('a URL line appears only when given', () => {
  assert.ok(!passToIcs(BASE).includes('URL:'));
  assert.ok(passToIcs({ ...BASE, url: 'https://seeksat.app/?s=x' }).includes('\r\nURL:https://seeksat.app/?s=x\r\n'));
});
test('icsFileName', () => {
  assert.equal(icsFileName('ISS', 'EN52ve', Date.parse('2026-03-01T13:16:05Z')), 'iss-pass-en52ve-20260301T1316Z.ics');
});
```

- [ ] **Step 2: Run** `node --test test/passes-ics.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/passes/ics.mjs`.
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat: Export a pass as an iCalendar event"`.

---

### Task 7: Chart orchestration without Cesium

Lift the sky chart and radio chart orchestration out of `lib/pass-finder-scene.js` (today lines ~574–912: `paintPolarModalStatic` through `satelliteSlug`) into a module that takes explicit inputs. The scene keeps thin wrappers that build those inputs from its state. Painting output must not change.

**Files:**
- Create: `lib/passes/charts.js`, `test/passes-charts.test.mjs`
- Modify: `lib/pass-finder-scene.js` (replace the lifted bodies with calls, and add `currentTrack()`)

**Interfaces:**
- Consumes: `Track` (Task 1); `radioChartWindows`, `walkOptsForOrbit`, `bestMomentMs`, `peakStepMsFor` (Task 3); the existing painters (`polar-modal-frame.js`, `polar-arc.js`, `polar-events.js`, `constellations.js`, `polar-stars.js`, `polar-bodies.js`, `radio-chart.js`), plus `radioPassSamples`, `radioPassCsv`, `polarModalFileNameFor`, `slug`, `sunAltitudeDeg` and `naturalSkyLimMag`.
- Produces:
  - `MODAL_GEOM = { cx: 100, cy: 100, R: 90 }`
  - `paintSkyChart(svgEl, { track, obs, win, tzRefMs }) -> void`: today's `renderPolarModalInto` body. The arc sampler is `track.ecefAt`. `satName` is `track.name`. Standard magnitude is `track.standardMag ?? -1.8`, matching today's `selectedSatStdMag` default.
  - `chartStepMs(durationMs) -> Math.max(2000, Math.ceil(durationMs / 1800 / 1000) * 1000)`
  - `csvStepMs(durationMs) -> Math.max(1000, Math.ceil(durationMs / 7200 / 1000) * 1000)`
  - `radioSeries({ track, obs, anchorMs, minElevDeg, freqHz, jointWindow = null, purpose = 'chart' }) -> null | { series, dl, freqHz, workableWindow, jointWindow, minElevDeg, clamped }`
    - Today's `radioSeriesFor` body, with `radioChartWindows(..., walkOptsForOrbit(track.orbitClass, track.periodMs))`.
    - `stepMs` is `chartStepMs(full duration)` for `'chart'` and `csvStepMs(...)` for `'csv'`.
    - `dl` is `track.downlinks.find((d) => d.hz === freqHz) ?? null`.
  - `radioChartOptions(built, { track, obs }) -> object`: the option object today's `bridgeRenderRadioModal` passes to `paintRadioChart`, with `satelliteName: track.shortName`.
  - `radioCsvText(built, { track, obs, generatedAtMs, clockSkewMs }) -> string`: today's `radioPassCsv` call. `tleEpochMs` is `track.epochMs`, and `tleLine1` and `tleLine2` are `track.record.line1` and `line2`. When the track has no TLE lines (IDs above 99999), those are `undefined` and the CSV omits them.
  - `passFileName(track, obs, ms, kind, ext = 'png') -> string`, where `kind` is `'sky'` or `'radio'`. The prefix is `` `${slug(track.shortName, 'sat')}-pass` `` for `'sky'` and `` `radio-${slug(track.shortName, 'sat')}` `` for `'radio'`, so today's names are unchanged.
- Scene changes:
  - `currentTrack()` returns a `makeTrack({ noradId: selectedNoradId, name, line1, line2 }, CATALOG entry)`, cached until the store TLE or selection changes.
  - `bridgeRenderPolarModal`, `bridgeRenderRadioModal`, `bridgeRadioPassCsvFor` and `polarModalFileNameFor` call the functions above.
  - The scene-local wrappers they replace are deleted.
  - The per-observer pass walk (`passWindowAtMsForObserver` in the scene, line ~200) passes `walkOptsForOrbit(...)` from `currentTrack()`.

- [ ] **Step 1: Write the failing tests** (no DOM; `paintSkyChart` is covered by the manual check in Task 8):

```js
test('radio series for an ISS pass keeps today\'s 2 s chart step and is not clamped', () => {
  const b = radioSeries({ track: ISS, obs: EN52VE, anchorMs: firstIssPeakMs, minElevDeg: 10, freqHz: 437_800_000 });
  assert.equal(b.clamped, false);
  const s = b.series.samples;
  assert.equal(s[1].ms - s[0].ms, 2000);
});
test('a Molniya radio series is the whole pass at a coarser step', () => {
  const b = radioSeries({ track: MOLNIYA, obs: EN52VE, anchorMs: Date.parse('2023-06-27T07:00:00Z'), minElevDeg: 10, freqHz: 1_000_000_000 });
  assert.equal(b.clamped, false);
  assert.ok(b.series.samples.length <= 1801);
});
test('csv step is 1 s for LEO passes', () => {
  assert.equal(csvStepMs(10 * 60_000), 1000);
  assert.equal(chartStepMs(10 * 60_000), 2000);
  assert.equal(chartStepMs(9 * 3_600_000), 18_000);
});
test('file names are unchanged for the ISS and generic for others', () => {
  const obs = { ...EN52VE, name: 'Home', tz: 'America/Chicago' };
  assert.match(passFileName(ISS_WITH_ENTRY, obs, firstIssPeakMs, 'sky'), /^iss-pass-home-/);
  assert.match(passFileName(ISS_WITH_ENTRY, obs, firstIssPeakMs, 'radio', 'csv'), /^radio-iss-home-.*\.csv$/);
  assert.match(passFileName(MOLNIYA, obs, firstIssPeakMs, 'sky'), /^m-pass-home-/);
});
test('CSV omits TLE lines for an OMM-only track', () => {
  const omm = makeTrack({ noradId: 25544, name: 'ISS', omm: ISS_OMM });
  const b = radioSeries({ track: omm, obs: EN52VE, anchorMs: firstIssPeakMs, minElevDeg: 10, freqHz: 437_800_000, purpose: 'csv' });
  const csv = radioCsvText(b, { track: omm, obs: EN52VE, generatedAtMs: T0, clockSkewMs: 0 });
  assert.ok(!csv.includes('undefined'));
});
```

Setup matches Task 4: `ISS`, `T0` and `DAY` as defined there, and `MOLNIYA = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M'))`. `firstIssPeakMs` is `findPasses({ track: ISS, observers: [EN52VE], startMs: T0, endMs: T0 + DAY }).passes[0].peakMs`, and `ISS_WITH_ENTRY` is `makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'), CATALOG.find((c) => c.noradId === 25544))`. Read `radio-pass.js` for the samples' time field name and adjust `s[1].ms` to match. The assertion is the 2000 ms spacing.

- [ ] **Step 2: Run** `node --test test/passes-charts.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/passes/charts.js` by moving the scene bodies, then rewire the scene.
- [ ] **Step 4: Run `npm test` and `npx tsc --noEmit`.** Expected: PASS, clean. Then run `grep -n "Cesium\|viewer\|usePassFinderStore\|state\." lib/passes/charts.js`. Expected: no output.
- [ ] **Step 5: Commit** with `git commit -m "refactor: Move sky and radio chart orchestration out of the Cesium scene"`.

---

### Task 8: Scene search on the engine, and calendar buttons

**Files:**
- Modify: `lib/pass-finder-scene.js`, `lib/scene-bridge.ts`, `components/passes/WindowsList.tsx`

**Interfaces:**
- Consumes: `findPasses`, `DEFAULT_SEARCH_DAYS`, `accuracyNote` (Task 4); `formatPassDuration` (Task 4); `passToIcs`, `icsFileName` (Task 6); `currentTrack()` and `orbitTrackEcef` (Tasks 1 and 7).
- Produces: `SceneBridge.passIcsFor(windowIdx: number) => { ics: string; filename: string } | null`, plus its wrapper export `passIcsFor`.
- Scene changes:
  - `runSearch` calls `findPasses({ track: currentTrack(), observers: state.observers, mode: state.mode, minElevDeg: state.minElevDeg, startMs, endMs })`. A `kind: 'passes'` result supplies `state.windows`, which are now `Pass` objects (a superset of `{ startMs, endMs }`). Any other kind sets windows to `[]` and status `"empty"`. The curated satellites are all LEO; the GEO and unavailable displays belong to the satellite page (Plan 4).
  - `state.horizonDays = DEFAULT_SEARCH_DAYS`, replacing 30.
  - The orbit polyline uses `orbitTrackEcef(currentTrack(), jsDate)` instead of `tleOrbitTrackEcef`, and the `truth.js` import is removed from the scene.
  - `renderWindowsList` formats the duration cell with `formatPassDuration`. When `accuracyNote(track.epochMs, w.peakMs)` is non-null, its `text` goes into the time cell's `title`.
  - `passIcsFor(i)` builds from `state.windows[i]`, `state.observers[0]`, `currentTrack()`, `state.mode`, `trueNow()` and `url: buildShareUrl()`.
- `WindowsList.tsx`:
  - Each ready row gets a trailing button with `aria-label="Add to calendar"`, `title="Add to calendar"`, the text `📅` and class `ics-btn`.
  - Its click calls `ev.stopPropagation()`, then `passIcsFor(i)`. It downloads the result through a Blob of type `text/calendar` and a temporary `<a download>`.
  - The header row gets one empty trailing `<span>`, and `gridTemplate` gets one extra `auto` column.

- [ ] **Step 1: Make the changes above.** The scene is not unit-testable (it needs Cesium), so this task is verified by the full suite plus the manual check below.
- [ ] **Step 2: Run `npm test` and `npx tsc --noEmit`.** Expected: PASS, clean. Then run `grep -n "truth.js\|findVisibilityWindows" lib/pass-finder-scene.js`. Expected: no output.
- [ ] **Step 3: Manual check for Aaron** (`npm run dev`; the local server reads the shared Blob snapshot and never calls CelesTrak):
  1. The ISS pass list loads, covers 10 days, and its durations read like `5m18s`.
  2. The sky chart and radio chart for a pass look as before. The PNG, CSV and copy work, and the file names start `iss-pass-` and `radio-iss-`.
  3. Adding an observer by typing `EN52ve` places it near Elgin, IL with the name `EN52ve`.
  4. The calendar button on a row downloads an `.ics` file that opens in Calendar with the right time and title.
  5. Switching satellites (Tiangong, Hubble, NOAA-19) relists passes, and the orbit line matches each satellite's period.
- [ ] **Step 4: Commit** with `git commit -m "feat: Run the pass list on the any-orbit engine and add calendar export"`.

---

### Task 9: Remove dead TLE code

**Files:**
- Delete:
  - `lib/mcp/tle-fetch.mjs`, `test/mcp-tle-fetch.test.mjs`
  - `scripts/seed-local-tle.mjs`
  - `lib/mcp/tle-store.mjs`, `test/mcp-tle-store.test.mjs`
- Modify: `lib/mcp/tle-record.mjs` (remove `makeTleRecord`), `test/mcp-tle-record.test.mjs` (remove its tests), and `package.json` if any script names `seed-local-tle`.
- Keep:
  - `lib/truth.js`: the triangulate page uses it, and spec section 9 leaves triangulate alone.
  - `lib/pass-finder/tle.js`: the scene and triangulate use it.
  - `lib/og/tle.mjs`: the home preview uses it, and it already reads the mirror.

- [ ] **Step 1: Delete and edit as listed.** Then run `grep -rn "tle-fetch\|tle-store\|makeTleRecord\|createMemoryStore\|seed-local-tle" lib app components scripts test package.json`. Expected: no output, apart from the HTML id `tle-fetch` in `components/triangulate/TlePanel.tsx`, which is not an import.
- [ ] **Step 2: Run `npm test` and `npx tsc --noEmit`.** Expected: PASS, clean.
- [ ] **Step 3: Commit** with `git commit -m "chore: Remove unused TLE fetch, memory store and seed script"`.
