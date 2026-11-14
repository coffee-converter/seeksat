# SatNOGS Reception Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Radio rankings in the MCP server account for slant range, hearable bands, and how recently SatNOGS stations actually heard each downlink.

**Architecture:** Phase 1 changes the radio rating and scan ordering with data we already have. Phase 2 adds a cron job that sweeps SatNOGS Network observations into a per-transmitter tally kept in its own Blob file. Phase 3 reads that tally in the MCP tools to order downlinks, pick `get_radio_pass`'s default, break ties, and cap "probably silent" satellites.

**Tech Stack:** Next.js 15 route handlers, plain ESM `.mjs` modules, node:test, Vercel Blob, Vercel Cron.

**Spec:** `docs/superpowers/specs/2026-11-14-satnogs-reception-design.md`

## Global Constraints

- Branch `develop`. Never merge to `main` without the owner's explicit go-ahead.
- Never call CelesTrak, `/api/refresh-tle` or the new cron route from a laptop. SatNOGS Network may be called by hand to record fixtures (a few pages, identifying User-Agent).
- User-Agent for every SatNOGS request: `seeksat/1.0 (${SITE_URL})` (as `lib/mirror/satnogs.mjs`).
- SatNOGS data is CC BY-SA 4.0. Any MCP output carrying reception data names the source.
- Server-only `https://` origins (SatNOGS Network) live in server-only modules (`lib/reception/`), never in client-bundled files. The origin test enforces it.
- User-facing copy (MCP notes, reasons, tool descriptions): plain words, short sentences, no em dashes.
- Tests: `node --test test/<file>.test.mjs` per task; `npm test` and `npx tsc --noEmit` at the end.
- Commits: conventional prefixes (`feat:`, `fix:`, `test:`, `docs:`).

## Decisions made in this plan (rulings on the spec's open points)

- **Range penalty:** one bar off per full 6 dB of free-space path loss beyond 2,000 km slant range at the peak (`20·log10(range/2000)`), never below 1 bar. 4,000 km: -1 bar; 8,000 km: -2 bars; a LEO at 10° (under ~2,500 km): no change. MCP rating only; the site's bars are unchanged (its pass objects have no range). A site follow-up goes in `docs/backlog.md`.
- **Hearable bands:** a downlink from 30 MHz up to (not including) 1 GHz. With no `bands` filter, satellites with one rank ahead of those without, in best_pass radio scans and whats_up_now radio. With a `bands` filter, every satellite counts as hearable.
- **Storage:** a separate Blob file `catalog/reception.json.gz`, not inside the catalog snapshot, so the two crons never overwrite each other's writes.
- **Collection cadence:** cron `47 */3 * * *` on `/api/refresh-reception`. Work unit is one (UTC day, status) pair over the last 7 complete UTC days, newest first. A run does units until a 200 s budget is spent. A unit is marked swept only when finished (or stopped at the page cap); a failed or unfinished unit is discarded and retried next run. Measured volume on 2026-11-13: about 3 pages (75 good observations) an hour, so about 75 pages per status per day.
- **Page cap:** 300 pages per unit; hitting it marks the unit swept with `truncated: true`.
- **"Probably silent":** no good observation in 30 days and at least 3 bad ones. Capped at 2 bars (Fair). Unknown (no observations, or no matching transmitter) is never capped.
- **Recency classes** (lower ranks first): heard in 48 h = 0, heard in 7 d = 1, heard in 30 d = 2, unknown = 3, probably silent = 4.
- **Radio ordering:** hearable, then bars, then recency class, then peak elevation, capture probability, duration, rise.
- **Counts:** each observation counts once, so two stations hearing one pass count twice (the spec's "24 good observations in 48 h" counts this way). Times are observation end times in whole minutes.

## Review Focus

1. Reception file missing, unreadable or empty: every MCP tool answers exactly as Phase 1 does, with no reception fields and no throw. (Task 6 test `reception unavailable leaves rows as before`.)
2. A curated downlink with no SatNOGS transmitter at that frequency reads "unknown" and is never capped. (Task 3 test `unmatched downlink is unknown`.)
3. SatNOGS answers 429, 5xx or times out mid-sweep: the unit is not marked swept, nothing from it is added, and the next run retries it. (Task 5 test `failed unit is retried, not half counted`.)
4. A linear transponder (passband) downlink, listed at its centre, matches its SatNOGS transmitter's low-to-high span. (Task 3 test `passband centre matches the span`.)
5. `get_radio_pass` with a frequency given uses that frequency even when another downlink was heard more recently; a `bands: ["s"]` scan still returns S-band satellites. (Task 6 tests `given frequency wins` and Task 2 test `bands filter counts every satellite hearable`.)

---

## Phase 1: range and hearable bands

### Task 1: Slant range in the radio rating

**Files:**
- Modify: `lib/passes/quality.mjs` (add `radioQuality`, `rangeBarsOff`)
- Modify: `lib/mcp/passes.mjs` (`passRating`, `rankKey`, `passRow`, new `peakRangeKm`)
- Modify: `lib/mcp/radio-scan.mjs` (`coarsePasses` records `peakRangeKm`; `roughScore`)
- Test: `test/pass-quality.test.mjs`, `test/mcp-passes.test.mjs`, `test/mcp-radio-scan.test.mjs`

**Interfaces:**
- Produces: `rangeBarsOff(rangeKm: number|null): number`; `radioQuality(pass: {maxElevDeg}, rangeKm: number|null): {level, label, bars, reason}`; `peakRangeKm(p, track, obs): number|null` (exported from `lib/mcp/passes.mjs`, the same value `passRow` puts in `peakRangeKm`); `passRating(p, mode, { ..., rangeKm = null })` (Task 6 adds `silent`); coarse runs gain `peakRangeKm: number`.
- Produces: `roughScore(run, { hearable = true, recency = 3 } = {}): number` defined as `(hearable ? 1000 : 0) + bars * 10 + (4 - recency) * 2 + run.peakElevDeg / 90`, where `bars = radioBars(run.peakElevDeg + COARSE_MARGIN_DEG, run.peakRangeKm)` (optimistic, so a rough pass near a threshold is never ranked below what its exact pass could earn). `radioBars(el, rangeKm)` is exported from `quality.mjs`: `max(1, elevationBars(el) - rangeBarsOff(rangeKm))`.

- [ ] **Step 1: Write failing tests**

```js
// test/pass-quality.test.mjs
test('range under 2,000 km costs nothing', () => {
  assert.equal(rangeBarsOff(400), 0); assert.equal(rangeBarsOff(2500), 0); assert.equal(rangeBarsOff(null), 0);
});
test('one bar per 6 dB beyond 2,000 km', () => {
  assert.equal(rangeBarsOff(4000), 1);   // 6.02 dB
  assert.equal(rangeBarsOff(8000), 2);   // 12.04 dB
  assert.equal(rangeBarsOff(3900), 0);   // 5.8 dB
});
test('a far pass at 89° rates below a near one', () => {
  assert.equal(radioQuality({ maxElevDeg: 89 }, 600).bars, 5);
  const far = radioQuality({ maxElevDeg: 89 }, 8000);
  assert.equal(far.bars, 3); assert.equal(far.label, 'Good'); assert.equal(far.level, 'ok');
  assert.match(far.reason, /8,000 km/);
});
test('never below one bar', () => assert.equal(radioQuality({ maxElevDeg: 12 }, 40000).bars, 1));
```

In `test/mcp-passes.test.mjs`: `rankKey` and `passRow` of a radio pass give the same `rating.bars`, and a row's `rating` matches `radioQuality(p, row.peakRangeKm)`. In `test/mcp-radio-scan.test.mjs`: every coarse run has a finite `peakRangeKm`; `roughScore` orders (hearable 30°) above (not hearable 89°), and (5 bars, recency 3) above (4 bars, recency 0).

- [ ] **Step 2: Run them, expect failures** — `node --test test/pass-quality.test.mjs test/mcp-passes.test.mjs test/mcp-radio-scan.test.mjs`
- [ ] **Step 3: Implement.** `radioQuality` reason: the elevation reason, plus when bars were taken off: ` It is ${km} km away, about ${dB} dB weaker than at 2,000 km.` (km with thousands separators, dB rounded to whole). Level follows the final bars (1-2 low, 3 ok, 4-5 good). `passRating` in radio mode uses `radioQuality(p, rangeKm)`; `rankKey` and `passRow` compute `peakRangeKm` once and pass it. In `coarsePasses`, keep the range (km) of the best sample and of the refined peak.
- [ ] **Step 4: Run them, expect pass.** Also `node --test test/mcp-tools.test.mjs` (existing radio expectations may shift only for far satellites; fix fixtures, not the rule).
- [ ] **Step 5: Commit** — `feat: Slant range lowers the radio rating of far passes`

### Task 2: Hearable bands first in radio scans

**Files:**
- Modify: `lib/radio/bands.mjs` (add `isHearable`, `hasHearable`)
- Modify: `lib/mcp/tools.mjs` (`byRadioRating`, `coarseRadioStage`, `radioScanTool`, `whatsUpNowTool` radio branch)
- Test: `test/radio-bands.test.mjs`, `test/mcp-tools.test.mjs`

**Interfaces:**
- Consumes: `roughScore(run, { hearable })` from Task 1.
- Produces: `isHearable(hz: number): boolean` (30e6 ≤ hz < 1e9); `hasHearable(downlinks): boolean`. Rank keys and radio rows gain `hearable: boolean`; `byRadioRating` sorts `hearable` first (true before false; a key without the field counts as true).

- [ ] **Step 1: Write failing tests**

```js
test('VHF and UHF are hearable, S-band and HF are not', () => {
  assert.ok(isHearable(145.8e6)); assert.ok(isHearable(437.8e6)); assert.ok(isHearable(137.1e6));
  assert.ok(!isHearable(2.2e9)); assert.ok(!isHearable(1.0e9)); assert.ok(!isHearable(29.9e6));
});
```

In `test/mcp-tools.test.mjs`, with a fake `deps.radioIds` holding one S-band-only satellite on a higher pass and one 70 cm satellite on a lower pass in the same window: `best_pass` radio with no bands returns the 70 cm one first; test `bands filter counts every satellite hearable`: with `bands: ['s']` the S-band one is returned and ranked by bars. `whats_up_now` radio lists a hearable satellite above a higher S-band-only one.

- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.** In `coarseRadioStage`, carry `hearable = bands ? true : hasHearable(downlinks)` per satellite into its coarse passes and into `roughScore`. In `radioScanTool`, set `key.hearable` the same way. whats_up_now radio sorts by hearable, then elevation.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat: Radio scans rank VHF and UHF satellites ahead of S-band-only ones`

---

## Phase 2: the reception collector

### Task 3: The per-transmitter tally

**Files:**
- Create: `lib/reception/tally.mjs`
- Modify: `lib/mirror/satnogs.mjs` (downlinks keep `uuid`)
- Test: `test/reception-tally.test.mjs`, `test/mirror-satnogs.test.mjs`

**Interfaces:**
- Produces (all pure):
  - `RECENCY = { H48: 0, D7: 1, D30: 2, UNKNOWN: 3, SILENT: 4 }`; `MIN_FAILED_FOR_SILENT = 3`; `KEEP_DAYS = 30`; `FREQ_MATCH_HZ = 5_000`.
  - `emptyTally(): { version: 1, tx: {}, swept: {} }`
  - `addObservations(tally, observations, status: 'good'|'bad'): void`, observations as `{ uuid, noradId, endMs, lowHz, highHz }`. `tally.tx[uuid] = { noradId, lowHz, highHz, good: number[], bad: number[] }`, times as `Math.floor(endMs / 60000)`.
  - `pruneTally(tally, nowMs): void` drops times older than `KEEP_DAYS`, transmitters left with none, and `swept` keys for days older than `KEEP_DAYS`.
  - `indexTally(tally): { tally, byNorad: Map<number, string[]> }`
  - `receptionFor(index, noradId, downlink, nowMs): Reception`, where `Reception = { state: 'heard'|'silent'|'unknown', recency: 0..4, heardLast48h, heardLast7d, heardLast30d, failedLast30d, lastHeard: string|null }` (ISO). Match by `downlink.uuid` first, else a transmitter of that `noradId` whose `[lowHz - FREQ_MATCH_HZ, (highHz || lowHz) + FREQ_MATCH_HZ]` holds `downlink.hz`. Several matches: sum them. No match: unknown with zero counts.
  - SatNOGS downlinks from `downlinksFromTransmitters` gain `uuid: t.uuid` when it is a non-empty string.

- [ ] **Step 1: Write failing tests** (fixed `NOW = Date.parse('2026-11-14T12:00:00Z')`):
  - `heard counts by window`: good at NOW-1h, NOW-30h, NOW-5d, NOW-20d → `heardLast48h 2, heardLast7d 3, heardLast30d 4, recency 0, state 'heard'`, `lastHeard` is NOW-1h's minute as ISO.
  - `only failures, three or more, is silent`: 3 bad, 0 good → `state 'silent', recency 4`; 2 bad → `state 'unknown', recency 3`.
  - `unmatched downlink is unknown`: a curated `{ hz: 145.8e6 }` with no transmitter near → `state 'unknown'`, all counts 0, `lastHeard null`.
  - `passband centre matches the span`: transmitter low 435.0e6, high 435.1e6; downlink `{ hz: 435.05e6 }` matches.
  - `uuid wins over frequency`: two transmitters at the same frequency; the downlink's uuid picks one.
  - `prune drops old times and swept days`.
  - `downlinksFromTransmitters keeps uuid`.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat: Per-transmitter reception tally from SatNOGS observations`

### Task 4: SatNOGS Network sweeper

**Files:**
- Create: `lib/reception/satnogs-network.mjs`
- Create: `test/fixtures/satnogs-observations-page1.json`, `test/fixtures/satnogs-observations-page2.json`
- Test: `test/reception-satnogs-network.test.mjs`

**Interfaces:**
- Produces: `SATNOGS_NETWORK_OBSERVATIONS_URL = 'https://network.satnogs.org/api/observations/'`; `MAX_PAGES = 300`; `PAGE_GAP_MS = 250`; `slimObservation(raw): { uuid, noradId, endMs, lowHz, highHz } | null` (null when `transmitter_uuid`, `norad_cat_id` or `end` is missing or bad; lowHz from `transmitter_downlink_low`, highHz from `transmitter_downlink_high` or lowHz); `sweepObservations({ status, startIso, endIso, fetchImpl = fetch, sleep, deadlineMs = Infinity, now = Date.now, maxPages = MAX_PAGES }): Promise<{ observations, pages, complete: boolean, truncated: boolean, error?: string }>`.
- Behaviour: first URL `?format=json&status=${status}&start=${startIso}&end=${endIso}`; follow the `Link` header's `rel="next"` URL until none (`complete: true`), `maxPages` reached (`truncated: true`), or a failure. Wait `PAGE_GAP_MS` between pages. On 429 or 5xx, retry up to 3 times, waiting `Retry-After` seconds when given, else 2 s, 4 s, 8 s; then give up with `error`. A non-list body, a network error, a timeout (30 s per request) or passing `deadlineMs` gives up with `error`. Never throws.

- [ ] **Step 1: Record fixtures.** Fetch two consecutive pages for one hour on 2026-11-13 (`status=good`), keep 3 objects per page with only the fields `id, start, end, status, norad_cat_id, transmitter_uuid, transmitter_downlink_low, transmitter_downlink_high`, and store the second page's URL as the first page's `link` header in the test.
- [ ] **Step 2: Write failing tests** with a fake `fetchImpl` and `sleep` that records waits:
  - `follows next links to the end`: 2 pages → 6 observations, `pages 2, complete true`.
  - `stops at the page cap`: `maxPages: 1` → `truncated true, complete false`.
  - `retries 429 with Retry-After`: 429 (`Retry-After: 5`) then 200 → waits include 5000, result complete.
  - `gives up after three 5xx retries`: → `complete false`, `error` set, waits `[2000, 4000, 8000]`.
  - `sends the identifying User-Agent`.
  - `slimObservation drops rows without a transmitter`.
- [ ] **Step 3: Run, expect failures. Step 4: Implement. Step 5: Run, expect pass.**
- [ ] **Step 6: Commit** — `feat: Sweep a day of SatNOGS Network observations politely`

### Task 5: Collector, store and cron route

**Files:**
- Create: `lib/reception/collect.mjs`
- Create: `lib/reception/store.mjs`
- Create: `app/api/refresh-reception/route.ts`
- Modify: `vercel.json` (second cron)
- Modify: `CLAUDE.md` (Working rules: never call `/api/refresh-reception` by hand; Where things live: `lib/reception/`)
- Test: `test/reception-collect.test.mjs`

**Interfaces:**
- Consumes: Task 3's tally functions, Task 4's `sweepObservations`.
- Produces:
  - `RECEPTION_PATHNAME = 'catalog/reception.json.gz'`; `createBlobReceptionStore()` and `createMemoryReceptionStore(initial)`, each `{ read(): Promise<Tally|null>, write(tally): Promise<void> }`, gzip JSON (reuse `snapshot-store.mjs`'s Blob read pattern: `head`, bounded fetch, `BlobNotFoundError` → null; factor the shared part out rather than copy it).
  - `BACKFILL_DAYS = 7`; `RUN_BUDGET_MS = 200_000`; `pendingUnits(tally, nowMs): Array<{ day: 'YYYY-MM-DD', status: 'good'|'bad' }>` for the last 7 complete UTC days, newest first, good before bad, skipping `tally.swept[`${day}:${status}`]`.
  - `collectReception({ store, sweep, now, budgetMs = RUN_BUDGET_MS }): Promise<{ units: number, observations: number, truncated: number, failed: string|null, written: boolean }>`. Reads (null → `emptyTally()`), runs units in order with `deadlineMs = start + budgetMs`, adds a unit's observations and sets `swept[key] = { pages, count, truncated }` only when the sweep is `complete` or `truncated`; on the first failure stops. Prunes, writes when any unit finished.
  - Route: same guard as `app/api/refresh-tle/route.ts` (CRON_SECRET bearer, `VERCEL_ENV === 'production'`), `maxDuration = 300`, returns the collect result as JSON (500 when `failed` and no unit finished).
  - `vercel.json`: `{ "path": "/api/refresh-reception", "schedule": "47 */3 * * *" }`.

- [ ] **Step 1: Write failing tests** with a memory store and a fake `sweep`:
  - `first run works newest day first`: empty store, NOW 2026-11-14T12:00Z → first unit `{ day: '2026-11-13', status: 'good' }`, 14 pending in all.
  - `failed unit is retried, not half counted`: sweep returns `{ complete: false, error }` for the second unit → only the first unit's observations are in the written tally, the second key is not in `swept`, and the next run's first unit is that second one.
  - `budget stops between units`: fake `now` passes the deadline after one unit → `units 1`.
  - `truncated unit is kept and marked`.
  - `nothing finished writes nothing`.
- [ ] **Step 2: Run, expect failures. Step 3: Implement. Step 4: Run, expect pass**, plus `node --test test/csp.test.mjs test/list-origin.test.mjs` (origin rules).
- [ ] **Step 5: Commit** — `feat: Cron job collects SatNOGS reception into a rolling 30-day tally`

---

## Phase 3: use it

### Task 6: Reception in MCP results and rankings

**Files:**
- Modify: `lib/mirror/reader.mjs` (or a small `lib/reception/reader.mjs`: cached `reception()`, reloaded hourly, never throws, null when missing)
- Modify: `app/api/mcp/route.ts` (deps `reception`)
- Modify: `lib/mcp/radio.mjs` (`downlinkList`, `radioPass` default)
- Modify: `lib/mcp/passes.mjs` (`passRating` option `silent`)
- Modify: `lib/mcp/tools.mjs` (radio scan, best_pass radio for named/popular satellites, whats_up_now radio, get_radio_pass, rows)
- Modify: `lib/mcp/tool-specs.mjs` (describe the fields and the source)
- Modify: `docs/backlog.md` (site follow-ups: card line "heard 24 times in the last 2 days"; range in the site's bars)
- Test: `test/mcp-radio.test.mjs`, `test/mcp-tools.test.mjs`

**Interfaces:**
- Consumes: `indexTally`, `receptionFor`, `RECENCY` (Task 3); `roughScore(run, { hearable, recency })` (Task 1); `hearable` keys (Task 2).
- Produces:
  - `deps.reception?: () => Promise<TallyIndex|null>`. Tools treat a missing dep, null, or a throw as "no reception data".
  - `downlinkList(track, { reception = null, noradId = null, nowMs = Date.now() } = {})`: with reception, each item gains `reception: { state, heardLast48h, heardLast7d, heardLast30d, failedLast30d, lastHeard }`, items order by recency class, then latest `lastHeard`, then the old order (stable); `isDefault` marks the first item when its state is `heard`, else the catalog default as now. Without reception: unchanged output.
  - `radioPass({ ..., reception, nowMs })`: `frequencyHz` given wins; else the `isDefault` downlink's frequency.
  - `satelliteReception(downlinkItems): Reception|null`: the first item's reception (the best after ordering).
  - `passRating(p, 'radio', { rangeKm, silent })`: `silent: true` caps bars at 2, level from the capped bars, reason adds ` SatNOGS stations tried ${n} times in 30 days and heard nothing.`
  - Rank keys gain `recency` (3 when no data); `byRadioRating` order: hearable, bars, recency, peak elevation, capture, duration, rise.
  - Radio rows (scan, named best_pass radio, whats_up_now radio) gain `reception` (satellite level). Each such response with reception data gains `receptionSource: 'SatNOGS Network observations (network.satnogs.org), CC BY-SA 4.0. Counts are observations, so two stations hearing one pass count twice.'`
  - whats_up_now radio order: hearable, recency, elevation.

- [ ] **Step 1: Write failing tests** with a tally built by Task 3's functions:
  - `heard downlink leads and becomes the default`: ISS-like track with 437.800 (catalog default) and 437.550; tally has 24 good for 437.550 in 48 h, none for 437.800 → list starts with 437.550, `isDefault` on it; `radioPass` uses 437.550.
  - `given frequency wins`: same, `frequencyHz: 437.8e6` → `frequencyMHz 437.8`.
  - `silent satellite is capped and flagged`: an 89° pass of a satellite with 3 bad, 0 good → `rating.bars 2`, `reception.state 'silent'`.
  - `heard breaks a tie`: two 5-bar passes, one heard in 48 h at 80°, one unknown at 89° → the heard one first.
  - `reception unavailable leaves rows as before`: `deps.reception` throws → same rows as with no dep, no `reception` or `receptionSource` keys.
- [ ] **Step 2: Run, expect failures. Step 3: Implement. Step 4: Run, expect pass.**
- [ ] **Step 5: Full suite and types** — `npm test` and `npx tsc --noEmit`; both clean.
- [ ] **Step 6: Commit** — `feat: MCP radio results rank and default by recent SatNOGS reception`
