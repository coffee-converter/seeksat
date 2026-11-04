# Any-Satellite Tracker, Plan 1: Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five-satellite Edge Config TLE store with a CelesTrak OMM mirror in Vercel Blob, plus an on-demand fetch for anything outside it, so every later plan can look up any NORAD ID (6-digit included).

**Architecture:** A cron fetches CelesTrak GP groups as OMM JSON, merges them into one snapshot (epoch-guarded against the previous one), and writes it gzipped to a single Blob. Server code reads the snapshot once per warm instance through a catalog reader, which falls back to a rate-limited, cached CelesTrak `CATNR` fetch for unknown IDs. All propagation goes through one `satrecFromRecord` helper that accepts OMM or TLE lines. Two cached read routes (`/api/sats`, `/api/search`) expose the catalog to the browser.

**Tech Stack:** Next.js 15 App Router, satellite.js 6.0.2 (`json2satrec`), `@vercel/blob` (new), `node:zlib`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-30-any-satellite-tracker-design.md` (sections 6.7, 8, 9).

## Roadmap (this plan is 1 of 5)

1. **Data layer** (this plan). Site keeps working as today, now fed by the mirror.
2. Any-satellite pass engine and charts: pull orchestration out of `lib/pass-finder-scene.js`, parameterize away the ISS, HEO/GEO pass search, grid squares, .ics, joint windows as a mode.
3. Satellite pages: `/sat/[id]`, honest-numbers module, orbit diagram, curated frequencies, link previews, sitemap.
4. Flat map and home screen: in-house map, following list, "Next up" cards, search.
5. Cesium removal and share-link migration.

Each plan gets written after the previous one lands, so it can cite real interfaces.

## Global Constraints

- Branch: `any-satellite-data-layer`. Never commit to `main` directly.
- Commit messages: conventional prefixes (`feat:`, `fix:`, `test:`, `chore:`, `refactor:`); no AI attribution or Co-Authored-By lines.
- Tests: `node --test`, one file per module under `test/`, `node:test` + `node:assert/strict`, all I/O injected (match `test/mcp-refresh.test.mjs`).
- New server modules are `.mjs`, pure where possible, I/O passed in (match `lib/mcp/refresh.mjs`).
- CelesTrak: group queries only for the mirror; per-ID `CATNR` only through the on-demand fetcher; send `User-Agent: seeksat/1.0 (https://seeksat.app)`; never fetch the same group twice per refresh.
- Cron cadence: every 4 hours (`0 */4 * * *`).
- Blob: one object, pathname `catalog/snapshot.json.gz`, rewritten each refresh. Not one blob per satellite.
- Copy (any user-facing string): plain language, no em dashes.
- Do not change how the existing pass finder, sky chart, or radio chart look or behave.

## Review Focus

1. **CelesTrak blocks or errors** (HTTP 403, an HTML page instead of JSON, timeout): the refresh must keep the previous snapshot, not write an empty one. Test in Task 6.
2. **One group fails while others succeed:** records from the failed group must carry forward from the previous snapshot instead of vanishing. Test in Task 4.
3. **NORAD ID above 99999:** no TLE lines exist; APIs return the OMM without `line1`/`line2`, and MCP position/pass tools still work. Tests in Tasks 1, 2, 8.
4. **A crawler walking `/api/sats?ids=` through thousands of unknown IDs:** CelesTrak calls are capped by the limiter and misses are negative-cached. Test in Task 7.
5. **First deploy before the cron has ever run** (no blob yet): the home page and MCP fall back the way they do today when Edge Config is empty, and read routes return 503 rather than crash. Tests in Tasks 7 and 9.

---

### Task 1: OMM helpers

**Files:**
- Create: `lib/sat/omm.mjs`
- Create: `test/fixtures/omm-iss.mjs`
- Test: `test/sat-omm.test.mjs`

**Interfaces:**
- Produces:
  - `type Omm` = CelesTrak GP JSON object with numeric fields as numbers: `OBJECT_NAME, OBJECT_ID, EPOCH, MEAN_MOTION, ECCENTRICITY, INCLINATION, RA_OF_ASC_NODE, ARG_OF_PERICENTER, MEAN_ANOMALY, EPHEMERIS_TYPE, CLASSIFICATION_TYPE, NORAD_CAT_ID, ELEMENT_SET_NO, REV_AT_EPOCH, BSTAR, MEAN_MOTION_DOT, MEAN_MOTION_DDOT`.
  - `normalizeOmm(raw: object): Omm | null`
  - `ommEpochMs(omm: Omm): number` (EPOCH is UTC without a `Z`)
  - `ommToTleLines(omm: Omm): { line1: string, line2: string } | null` (null when `NORAD_CAT_ID > 99999`)
  - `test/fixtures/omm-iss.mjs` exports `ISS_OMM`, `ISS_LINE1`, `ISS_LINE2`.

- [ ] **Step 1: Write the fixture** (values are exact; the pair propagates to 0 m difference)

```js
// test/fixtures/omm-iss.mjs - a synthetic ISS element set in both forms.
// The TLE checksums are valid; json2satrec(ISS_OMM) and
// twoline2satrec(ISS_LINE1, ISS_LINE2) propagate identically.
export const ISS_OMM = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', EPOCH: '2026-03-01T12:00:00.000000',
  MEAN_MOTION: 15.5, ECCENTRICITY: 0.00047, INCLINATION: 51.64, RA_OF_ASC_NODE: 200,
  ARG_OF_PERICENTER: 30, MEAN_ANOMALY: 100, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 25544, ELEMENT_SET_NO: 900, REV_AT_EPOCH: 1000, BSTAR: 0.0001027,
  MEAN_MOTION_DOT: 0.00016717, MEAN_MOTION_DDOT: 0,
};
export const ISS_LINE1 = '1 25544U 98067A   26060.50000000  .00016717  00000+0  10270-3 0  9005';
export const ISS_LINE2 = '2 25544  51.6400 200.0000 0004700  30.0000 100.0000 15.50000000 10007';
```

- [ ] **Step 2: Write the failing tests**

```js
test('ommToTleLines reproduces the fixture TLE exactly, checksums included', () => {
  assert.deepEqual(ommToTleLines(ISS_OMM), { line1: ISS_LINE1, line2: ISS_LINE2 });
});
test('ommToTleLines returns null for a 6-digit catalog number', () => {
  assert.equal(ommToTleLines({ ...ISS_OMM, NORAD_CAT_ID: 100001 }), null);
});
test('ommEpochMs reads EPOCH as UTC', () => {
  assert.equal(ommEpochMs(ISS_OMM), Date.UTC(2026, 2, 1, 12));
});
test('normalizeOmm coerces numeric strings and keeps text fields', () => {
  const o = normalizeOmm({ ...ISS_OMM, MEAN_MOTION: '15.5', NORAD_CAT_ID: '25544' });
  assert.equal(o.MEAN_MOTION, 15.5);
  assert.equal(o.NORAD_CAT_ID, 25544);
  assert.equal(o.OBJECT_NAME, 'ISS (ZARYA)');
});
test('normalizeOmm rejects a record missing MEAN_MOTION or with a non-integer NORAD_CAT_ID', () => {
  const { MEAN_MOTION, ...noMm } = ISS_OMM;
  assert.equal(normalizeOmm(noMm), null);
  assert.equal(normalizeOmm({ ...ISS_OMM, NORAD_CAT_ID: 'abc' }), null);
});
test('normalizeOmm rejects an unparseable EPOCH', () => {
  assert.equal(normalizeOmm({ ...ISS_OMM, EPOCH: 'yesterday' }), null);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test test/sat-omm.test.mjs`
Expected: FAIL, cannot find module `../lib/sat/omm.mjs`.

- [ ] **Step 4: Implement `lib/sat/omm.mjs`**

`ommToTleLines` follows the standard TLE column layout. The decisions the tests don't make obvious:
- Epoch field: `YYDDD.DDDDDDDD` (2-digit year, day-of-year with 8 decimals).
- `MEAN_MOTION_DOT`: `.00016717` style, sign or space in column 34.
- `MEAN_MOTION_DDOT` and `BSTAR`: implied-decimal exponent form (`10270-3`). Zero is written `00000+0`.
- The international designator comes from `OBJECT_ID` (`1998-067A` becomes `98067A`).
- Element set number and rev number are right-aligned.
- The checksum is the digit sum plus 1 per `-`, mod 10.

- [ ] **Step 5: Run to verify pass**

Run: `node --test test/sat-omm.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/sat/omm.mjs test/fixtures/omm-iss.mjs test/sat-omm.test.mjs
git commit -m "feat: add OMM parsing and TLE line formatting"
```

---

### Task 2: One propagation entry point, records instead of TLE lines on the server

**Files:**
- Create: `lib/sat/satrec.mjs`
- Modify: `lib/mcp/ecef-sampler.mjs`, `lib/mcp/passes.mjs` (`getPosition`, `findPasses`, `nextPassWindow`), `lib/mcp/pass-chart.mjs`, `lib/mcp/tools.mjs` (call sites only)
- Test: `test/sat-satrec.test.mjs`; update `test/mcp-passes.test.mjs`, `test/mcp-pass-chart.test.mjs`, `test/mcp-ecef-sampler.test.mjs`

**Interfaces:**
- Consumes: `Omm`, `ISS_OMM`, `ISS_LINE1/2` (Task 1).
- Produces:
  - `type SatRecordLike = { omm?: Omm, line1?: string, line2?: string }`
  - `satrecFromRecord(record: SatRecordLike): SatRec`. Uses `json2satrec` when `record.omm` exists, else `twoline2satrec`. Throws `Error('record has neither OMM nor TLE lines')` otherwise.
  - `makeEcefSampler(record: SatRecordLike): (Date) => [x,y,z] | null` (was `(line1, line2)`)
  - `getPosition(record, jsDate)`, `findPasses({ record, observer, ... })`, `nextPassWindow({ record, observer, ... })`. Same options and returns as today, with `record` replacing `line1, line2`.

- [ ] **Step 1: Write the failing tests**

```js
// test/sat-satrec.test.mjs
test('OMM and TLE records propagate to the same position', () => {
  const t = new Date(Date.UTC(2026, 2, 1, 13, 30));
  const a = sat.propagate(satrecFromRecord({ omm: ISS_OMM }), t).position;
  const b = sat.propagate(satrecFromRecord({ line1: ISS_LINE1, line2: ISS_LINE2 }), t).position;
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6);
});
test('OMM wins when a record has both', () => {
  const rec = { omm: { ...ISS_OMM, INCLINATION: 97 }, line1: ISS_LINE1, line2: ISS_LINE2 };
  assert.ok(Math.abs(satrecFromRecord(rec).inclo * 180 / Math.PI - 97) < 1e-9);
});
test('a record with neither form throws', () => {
  assert.throws(() => satrecFromRecord({}), /neither OMM nor TLE/);
});
```

In `test/mcp-passes.test.mjs`, switch existing calls to `getPosition({ line1: LINE1, line2: LINE2 }, ...)` and `findPasses({ record: { line1: LINE1, line2: LINE2 }, ... })`, keeping their assertions. Add:

```js
test('getPosition works for a 6-digit, OMM-only record', () => {
  const t = new Date(Date.UTC(2026, 2, 1, 13, 30));
  const six = getPosition({ omm: { ...ISS_OMM, NORAD_CAT_ID: 100001 } }, t);
  const five = getPosition({ line1: ISS_LINE1, line2: ISS_LINE2 }, t);
  assert.equal(six.latDeg, five.latDeg);
  assert.equal(six.lonDeg, five.lonDeg);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/sat-satrec.test.mjs test/mcp-passes.test.mjs`
Expected: FAIL (module missing, old signatures).

- [ ] **Step 3: Implement `satrecFromRecord`, then switch `ecef-sampler`, `passes`, `pass-chart` and the three `tools.mjs` call sites to pass the record.** Leave `lib/truth.js`, `lib/og/tle.mjs` and client code alone; Plan 2 owns them.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add lib/sat/satrec.mjs lib/mcp test/sat-satrec.test.mjs test/mcp-*.test.mjs
git commit -m "refactor: propagate from records so OMM-only satellites work"
```

---

### Task 3: CelesTrak client

**Files:**
- Create: `lib/mirror/celestrak.mjs`
- Test: `test/mirror-celestrak.test.mjs`

**Interfaces:**
- Consumes: `normalizeOmm` (Task 1).
- Produces:
  - `MIRROR_GROUPS: readonly string[]` = `['active', 'last-30-days']`. The implementer confirms both names on celestrak.org's GP index; `molniya` is not added because the on-demand path covers dead objects.
  - `groupUrl(group): string` = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`
  - `catnrUrl(noradId): string` = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=json`
  - `fetchGroup(group, { fetchImpl = fetch } = {}): Promise<Omm[]>`. Throws on non-OK, non-JSON, or non-array responses. Drops entries that `normalizeOmm` rejects.
  - `fetchByCatnr(noradId, { fetchImpl = fetch } = {}): Promise<Omm | null>`. Returns null for CelesTrak's "No GP data found" text or an empty array; throws on HTTP or network errors so callers can tell "absent" from "unreachable".

- [ ] **Step 1: Write the failing tests** with a fake `fetchImpl` returning `new Response(...)`:
  - `fetchGroup` sends `User-Agent: seeksat/1.0 (https://seeksat.app)` and returns the normalized array (`[ISS_OMM]` passed in yields `length === 1`, `NORAD_CAT_ID === 25544`).
  - `fetchGroup` drops one malformed element out of two (`length === 1`).
  - `fetchGroup` rejects on HTTP 403 (`/403/`) and on an HTML body (`/not JSON/`).
  - `fetchByCatnr` returns null for body `No GP data found` with status 200, and for `[]`.
  - `fetchByCatnr` rejects on HTTP 500.

- [ ] **Step 2: Run to verify failure.** `node --test test/mirror-celestrak.test.mjs`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement**, with a 15 s timeout per request (AbortController, same pattern as `lib/mcp/tle-fetch.mjs`).
- [ ] **Step 4: Run to verify pass.** Same command, PASS.
- [ ] **Step 5: Commit** `feat: add CelesTrak GP client for group and catalog-number queries`

---

### Task 4: Snapshot build and codec

**Files:**
- Create: `lib/mirror/snapshot.mjs`
- Test: `test/mirror-snapshot.test.mjs`

**Interfaces:**
- Consumes: `Omm`, `ommEpochMs`; `mergeRecord` from `lib/mcp/tle-record.mjs` (epoch guard, reused).
- Produces:
  - `type CatalogRecord = { noradId: number, name: string, omm: Omm, epochMs: number, source: 'celestrak-gp' | 'celestrak-catnr', fetchedAtMs: number, groups: string[] }`
  - `type Snapshot = { version: 1, generatedAtMs: number, objects: Record<string, CatalogRecord> }`
  - `buildSnapshot({ results, previous, nowMs }): Snapshot`, where `results` is `Record<group, { ok: true, omms: Omm[] } | { ok: false }>`
  - `encodeSnapshot(s: Snapshot): Buffer` (gzip JSON) and `decodeSnapshot(buf: Buffer | Uint8Array): Snapshot` (throws on wrong `version`)

- [ ] **Step 1: Write the failing tests**
  - An object in two OK groups becomes one record with `groups` holding both names.
  - An incoming element set older than the previous record keeps the previous record (epoch guard).
  - An object only in a failed group carries forward from `previous` unchanged.
  - An object missing from all OK groups and not in any failed group is dropped. That is the decay/removal case.
  - `decodeSnapshot(encodeSnapshot(s))` deep-equals `s`; `decodeSnapshot` of `{version: 2}` throws `/version/`.
- [ ] **Step 2: Run to verify failure.** `node --test test/mirror-snapshot.test.mjs`
- [ ] **Step 3: Implement** with `node:zlib` `gzipSync`/`gunzipSync`.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** `feat: build epoch-guarded catalog snapshots`

---

### Task 5: Snapshot store (Blob and memory)

**Files:**
- Create: `lib/mirror/snapshot-store.mjs`
- Modify: `package.json` (add `@vercel/blob`)
- Test: `test/mirror-snapshot-store.test.mjs`

**Interfaces:**
- Consumes: `encodeSnapshot`, `decodeSnapshot` (Task 4).
- Produces:
  - `SNAPSHOT_PATHNAME = 'catalog/snapshot.json.gz'`
  - `createMemorySnapshotStore(initial?: Snapshot)`, which returns `{ read(): Promise<Snapshot | null>, write(s: Snapshot): Promise<void> }`
  - `createBlobSnapshotStore({ blob = await import('@vercel/blob'), fetchImpl = fetch } = {})`, with the same shape. `write` calls `blob.put(SNAPSHOT_PATHNAME, encodeSnapshot(s), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/gzip', cacheControlMaxAge: 60 })`. `read` calls `blob.head(SNAPSHOT_PATHNAME)`, fetches its `url`, and decodes. It returns null when `head` throws `BlobNotFoundError`.

- [ ] **Step 1: Install.** `npm install @vercel/blob`. Then confirm `put` option names and `head`/`BlobNotFoundError` against `node_modules/@vercel/blob/README.md`, and adjust the names above if the installed version differs.
- [ ] **Step 2: Write the failing tests:**
  - The memory store round-trips.
  - The blob store, given a fake `blob` and `fetchImpl`, writes with the exact options above and reads back the same snapshot.
  - The blob store's `read` returns null when the fake `head` throws an error named `BlobNotFoundError`.
- [ ] **Step 3: Run to verify failure.**
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run to verify pass.**
- [ ] **Step 6: Commit** `feat: store the catalog snapshot in Vercel Blob`

---

### Task 6: Mirror refresh and cron

**Files:**
- Create: `lib/mirror/refresh.mjs`
- Modify: `app/api/refresh-tle/route.ts`, `vercel.json` (schedule `0 */4 * * *`)
- Test: `test/mirror-refresh.test.mjs`

**Interfaces:**
- Consumes: `MIRROR_GROUPS`, `fetchGroup` (Task 3); `buildSnapshot` (Task 4); snapshot store (Task 5).
- Produces: `refreshMirror({ store, groups, fetchGroup, now }): Promise<{ written: boolean, objectCount: number, failedGroups: string[] }>`

- [ ] **Step 1: Write the failing tests** against `createMemorySnapshotStore`:
  - All groups OK: `written === true`, and `objectCount` matches the unique IDs.
  - **Every group fails** (fake `fetchGroup` rejects): `written === false`, the store still holds the previous snapshot, and `failedGroups` lists them all.
  - One group fails: `written === true`, and the failed group's previous records are present.
  - A previous snapshot that is null (first run) with all groups OK writes normally.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Fetch groups sequentially, never in parallel, to be gentle on CelesTrak.
- [ ] **Step 4: Rewire the cron route** to `refreshMirror({ store: createBlobSnapshotStore(), groups: MIRROR_GROUPS, fetchGroup, now: Date.now })`. Keep the `CRON_SECRET` check and route path. Respond with `Response.json({ ok: true, ...result })`.
- [ ] **Step 5: Run `npm test` and `npm run typecheck`.** Expected: both pass.
- [ ] **Step 6: Commit** `feat: refresh the catalog mirror from CelesTrak every 4 hours`

---

### Task 7: Catalog reader with on-demand fetch

**Files:**
- Create: `lib/mirror/on-demand.mjs`, `lib/mirror/reader.mjs`, `lib/mirror/server.mjs`
- Test: `test/mirror-on-demand.test.mjs`, `test/mirror-reader.test.mjs`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5; `CATALOG` from `lib/catalog.mjs` (aliases for search).
- Produces:
  - `createOnDemandFetcher({ fetchByCatnr, now, maxPerHour = 60, hitTtlMs = 4 * 3_600_000, missTtlMs = 3_600_000 })`, which returns `{ get(noradId): Promise<CatalogRecord | null> }`. Hits get `source: 'celestrak-catnr'` and `groups: []`. When the hourly budget is spent, it returns null without calling CelesTrak. A thrown fetch is not cached.
  - `type ServedRecord = CatalogRecord & { line1?: string, line2?: string }`, with lines added via `ommToTleLines` when one exists.
  - `createCatalogReader({ store, onDemand, now, reloadMs = 15 * 60_000 })`, which returns:
    - `ready(): Promise<boolean>`, false when the store has no snapshot
    - `getRecord(noradId: number): Promise<ServedRecord | null>`, from the snapshot first, then on-demand
    - `search(query: string, limit = 20): Promise<{ noradId: number, name: string }[]>`
    - `generatedAtMs(): number | null`
  - `lib/mirror/server.mjs`: `getCatalogReader()`, a lazily created module-level singleton wiring `createBlobSnapshotStore`, `createOnDemandFetcher({ fetchByCatnr, now: Date.now })`, and `Date.now`.

- [ ] **Step 1: Write the failing on-demand tests:**
  - A second `get` for the same ID within `hitTtlMs` makes no second fetch.
  - A miss is cached for `missTtlMs` and refetched after it.
  - **61 distinct unknown IDs in one hour cause exactly 60 fetches.** The 61st returns null, and a fetch is allowed again after the hour rolls.
  - A rejected fetch returns null and is retried on the next call.
- [ ] **Step 2: Write the failing reader tests:**
  - `getRecord(25544)` serves the snapshot record with `line1 === ISS_LINE1`.
  - A 6-digit record has no `line1`.
  - An unknown ID goes to `onDemand.get`.
  - The snapshot reloads only after `reloadMs`.
  - `ready()` is false when the store reads null, and `getRecord` then still tries on-demand.
  - Search ranking:
    1. an exact ID (`'25544'`)
    2. an exact name or curated alias (`'iss'` finds 25544 first)
    3. a name prefix
    4. a name substring

    It is case-insensitive and capped at `limit`. An empty query returns `[]`.
- [ ] **Step 3: Run to verify failure.**
- [ ] **Step 4: Implement** the three modules.
- [ ] **Step 5: Run to verify pass.**
- [ ] **Step 6: Commit** `feat: add catalog reader with rate-limited on-demand lookup`

---

### Task 8: Public read routes

**Files:**
- Create: `lib/mirror/api.mjs`, `app/api/sats/route.ts`, `app/api/search/route.ts`
- Test: `test/mirror-api.test.mjs`

**Interfaces:**
- Consumes: `createCatalogReader` shape (Task 7); `tleAgeHours` (`lib/mcp/tle-record.mjs`).
- Produces (pure handlers returning `{ status: number, body: object, headers: Record<string,string> }`):
  - `satsHandler(reader, searchParams: URLSearchParams, nowMs)`: `ids` is a comma list, max 50 unique positive integers. The body is `{ generatedAtMs, objects: ServedRecord & { tleAgeHours }[], missing: number[] }`.
  - `searchHandler(reader, searchParams)`: `q` is required, max 64 chars. The body is `{ results }`.
  - Both handlers:
    - success headers: `Cache-Control: public, s-maxage=900, stale-while-revalidate=3600`
    - 400 for bad input
    - 503 when `reader.ready()` is false and nothing was found, with `Cache-Control: no-store`
  - Routes: `GET /api/sats?ids=25544,25485` and `GET /api/search?q=molniya`, thin wrappers over the handlers using `getCatalogReader()`, `runtime = 'nodejs'`.

- [ ] **Step 1: Write the failing tests** against a reader stub:
  - 51 IDs gives 400.
  - `ids=abc` gives 400.
  - Duplicates are collapsed.
  - Known and unknown IDs split into `objects` and `missing`.
  - A 6-digit object is returned without `line1`.
  - `tleAgeHours` comes out right for a fixed `nowMs`.
  - A not-ready, empty result gives 503.
  - A missing `q` gives 400.
  - The cache header is exact on success.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement the handlers and the two routes.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Both pass.
- [ ] **Step 5: Commit** `feat: add cached satellite and search API routes`

---

### Task 9: Switch consumers to the mirror; retire Edge Config

**Files:**
- Modify:
  - `lib/catalog.mjs` (`resolveSatellite`)
  - `lib/mcp/tools.mjs` (deps)
  - `app/api/mcp/route.ts`
  - `app/page.tsx` (`readInitialSatelliteTles`)
  - `lib/pass-finder/satellite-seed.js` (record source only)
  - `lib/mcp/tle-store.mjs`
  - `package.json`
- Delete: `lib/mcp/refresh.mjs`, `test/mcp-refresh.test.mjs` (superseded by `lib/mirror/refresh.mjs`)
- Test: update `test/catalog.test.mjs`, `test/mcp-tools.test.mjs`, `test/mcp-tle-store.test.mjs`, `test/satellite-seed.test.mjs`

**Interfaces:**
- Consumes: `getCatalogReader()` (Task 7).
- Produces:
  - `resolveSatellite(idOrName)` now returns a synthesized entry for any positive integer not in `CATALOG`: `{ noradId, name: String(noradId), shortName: null, aliases: [], tier: 'free', standardMag: null, defaultMode: 'radio', downlinks: [] }`. Names still resolve only against `CATALOG`.
  - MCP tool deps change from `readMap()` to `getRecord(noradId): Promise<ServedRecord | null>`. A synthesized entry takes its display name from `record.name`. `listSatellites` still lists `CATALOG`, now described as the popular set.
  - `recordsToSatelliteTles(catalog, records: Record<number, ServedRecord | null>)` keeps its output shape `{ [noradId]: Tle }`, and skips records without lines.
  - `lib/mcp/tle-store.mjs` keeps only `createMemoryStore`, and `@vercel/edge-config` is removed from dependencies.

- [ ] **Step 1: Write the failing tests:**
  - `resolveSatellite(25485)` returns a synthesized entry with `defaultMode === 'radio'`.
  - `resolveSatellite('molniya')` is null.
  - `resolveSatellite(0)` and `resolveSatellite(-5)` are null.
  - `getPositionTool({ satellite: '100001' }, deps)` works with a `getRecord` stub serving an OMM-only record, and its `name` is the record's.
  - With `getRecord` resolving null for everything, tools throw `/no orbit data/` rather than crashing. The old message `no TLE cached yet` changes to `no orbit data for ${name} (${noradId}) yet`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement the changes.**
  - In `app/page.tsx`, read the five `CATALOG` records through `getCatalogReader().getRecord`. Wrap it in the same try/catch fallback to `{}`.
  - In `app/api/mcp/route.ts`, pass `getRecord: (id) => getCatalogReader().getRecord(id)`.
  - Then `grep -rn "edge-config\|createEdgeConfigStore\|readMap" app lib test` must return nothing.
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Both pass.
- [ ] **Step 5: Manual check** (Aaron runs this, needs `BLOB_READ_WRITE_TOKEN` and `CRON_SECRET` in `.env.local`):

```bash
npm run dev
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/refresh-tle
curl "localhost:3000/api/sats?ids=25544,25485"
curl "localhost:3000/api/search?q=molniya"
```

Expected:
- The refresh returns `written: true` with an `objectCount` over 10,000.
- `25485` comes back either from the snapshot or with `source: "celestrak-catnr"`. This settles spec section 8's "does MOLNIYA 1-91 resolve" question.
- Search lists Molniya objects.
- The home page still shows ISS passes as before.

- [ ] **Step 6: Commit** `refactor: serve satellites from the catalog mirror and drop Edge Config`
