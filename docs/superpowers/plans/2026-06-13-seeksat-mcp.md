# SeekSat MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed Streamable-HTTP MCP server inside the SeekSat repo that lets AI agents query satellite passes and positions, reusing SeekSat's existing pass-prediction engine, backed by a cron-refreshed TLE cache.

**Architecture:** Pure logic lives in `lib/mcp/*.mjs` modules (unit-tested with `node:test`, mirroring the existing `lib/pass-finder/*` convention). Thin Next.js route handlers (`app/api/mcp/route.ts`, `app/api/refresh-tle/route.ts`) adapt those modules to MCP and cron — mirroring the existing `app/api/og/route.ts` pattern (thin route → tested `.mjs` lib). A Vercel Cron refreshes TLEs into Edge Config every 6h; every MCP request reads TLEs from the cache, never from upstream.

**Tech Stack:** Next.js 15 (App Router) · `satellite.js` (already a dep) · `mcp-handler` + `zod` (new) · `@vercel/edge-config` (new) · Vercel Cron + Edge Config.

**Scope note:** This plan covers spec workstreams 1 (shared TLE cache + refresh cron) and 2 (MCP server). Workstream 3 (webapp load-path retrofit) is a separate follow-up plan — see "Deferred: Webapp Retrofit" at the end. The MCP is fully functional without it.

---

## File Structure

**New pure modules (unit-tested):**
- `lib/mcp/catalog.mjs` — curated satellite list + `resolveSatellite(idOrName)`.
- `lib/mcp/tle-record.mjs` — pure TLE record shape, epoch-guard merge, age helper.
- `lib/mcp/tle-fetch.mjs` — fetch a TLE for any NORAD id from the three sources (generalizes the ISS-only `lib/pass-finder/tle.js`).
- `lib/mcp/tle-store.mjs` — storage abstraction: in-memory store (dev/test) + Edge Config store (prod).
- `lib/mcp/ecef-sampler.mjs` — `makeEcefSampler(line1,line2)` building the satrec once.
- `lib/mcp/passes.mjs` — `findPasses(...)` + `getPosition(...)` reusing search/visibility/scoring.
- `lib/mcp/tools.mjs` — pure tool handlers (`listSatellites`, `findPassesTool`, `getPositionTool`, `nextVisiblePassTool`, `getPassWeatherTool`) taking an injected `deps` bag.

**New thin adapters (manual/integration verification):**
- `app/api/mcp/route.ts` — `mcp-handler` wiring tool schemas → pure handlers.
- `app/api/refresh-tle/route.ts` — cron endpoint: fetch catalog TLEs → epoch-guard merge → write to store.

**Modified:**
- `lib/pass-finder/geocode.js` — add optional `init` arg so the server can pass a `User-Agent` header (backward-compatible).
- `vercel.json` — created: cron schedule.
- `package.json` — new deps; test glob already covers `test/*.mjs`.
- `README.md` (or `docs/seeksat-mcp.md`) — portfolio writeup.

**New tests:** `test/mcp-catalog.test.mjs`, `test/mcp-tle-record.test.mjs`, `test/mcp-ecef-sampler.test.mjs`, `test/mcp-passes.test.mjs`, `test/mcp-tools.test.mjs`. (The existing `npm test` glob `test/*.{mjs,js}` picks these up automatically.)

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

Run:
```bash
npm install mcp-handler zod @vercel/edge-config
```

- [ ] **Step 2: Verify they landed in package.json**

Run: `node -e "const p=require('./package.json'); console.log(p.dependencies['mcp-handler'], p.dependencies.zod, p.dependencies['@vercel/edge-config'])"`
Expected: three version strings printed (not `undefined`).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add mcp-handler, zod, edge-config deps"
```

---

## Task 2: Satellite catalog

**Files:**
- Create: `lib/mcp/catalog.mjs`
- Test: `test/mcp-catalog.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// test/mcp-catalog.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, resolveSatellite } from '../lib/mcp/catalog.mjs';

test('catalog contains the ISS keyed by NORAD id', () => {
  const iss = CATALOG.find(s => s.noradId === 25544);
  assert.ok(iss, 'ISS present');
  assert.equal(iss.name, 'ISS (ZARYA)');
});

test('resolveSatellite matches by numeric id', () => {
  assert.equal(resolveSatellite(25544).noradId, 25544);
  assert.equal(resolveSatellite('25544').noradId, 25544);
});

test('resolveSatellite matches by name/alias case-insensitively', () => {
  assert.equal(resolveSatellite('iss').noradId, 25544);
  assert.equal(resolveSatellite('Hubble').noradId, 20580);
  assert.equal(resolveSatellite('TIANGONG').noradId, 48274);
});

test('resolveSatellite returns null for unknown input', () => {
  assert.equal(resolveSatellite('does-not-exist'), null);
  assert.equal(resolveSatellite(99999), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-catalog.test.mjs`
Expected: FAIL — `Cannot find module '../lib/mcp/catalog.mjs'`.

- [ ] **Step 3: Write the implementation**

```javascript
// lib/mcp/catalog.mjs — curated, trackable satellites.
// The MCP layer is satellite-agnostic: it takes an identifier and
// resolves it here. Adding "track any NORAD id" later means relaxing
// resolveSatellite to synthesize an entry for an unknown numeric id.

export const CATALOG = [
  { noradId: 25544, name: 'ISS (ZARYA)', aliases: ['iss', 'zarya', 'space station'] },
  { noradId: 20580, name: 'Hubble Space Telescope', aliases: ['hubble', 'hst'] },
  { noradId: 48274, name: 'Tiangong (CSS)', aliases: ['tiangong', 'css', 'chinese space station'] },
];

// Resolve a NORAD id (number or numeric string) or a name/alias
// (case-insensitive) to a catalog entry, or null if unknown.
export function resolveSatellite(idOrName) {
  if (idOrName == null) return null;
  const asNum = Number(idOrName);
  if (Number.isInteger(asNum)) {
    return CATALOG.find(s => s.noradId === asNum) ?? null;
  }
  const q = String(idOrName).trim().toLowerCase();
  if (!q) return null;
  return CATALOG.find(s =>
    s.name.toLowerCase() === q || s.aliases.includes(q),
  ) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcp-catalog.test.mjs`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/catalog.mjs test/mcp-catalog.test.mjs
git commit -m "feat(mcp): add satellite catalog + resolver"
```

---

## Task 3: TLE record shape + epoch-guard merge

**Files:**
- Create: `lib/mcp/tle-record.mjs`
- Test: `test/mcp-tle-record.test.mjs`

A TLE record is `{ noradId, name, line1, line2, epochMs, source, fetchedAtMs }`. The epoch guard is the heart of the "a flaky source can't clobber good data" property.

- [ ] **Step 1: Write the failing test**

```javascript
// test/mcp-tle-record.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTleRecord, mergeRecord, tleAgeHours } from '../lib/mcp/tle-record.mjs';

const fetched = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990',
  line2: '2 25544  51.6400 100.0000 0000000   0.0000   0.0000 15.50000000000000',
  epochMs: 1000,
  source: 'wheretheiss',
};

test('makeTleRecord stamps fetchedAtMs and keeps fields', () => {
  const r = makeTleRecord(25544, fetched, 5000);
  assert.equal(r.noradId, 25544);
  assert.equal(r.line1, fetched.line1);
  assert.equal(r.epochMs, 1000);
  assert.equal(r.source, 'wheretheiss');
  assert.equal(r.fetchedAtMs, 5000);
});

test('mergeRecord keeps the newer epoch (incoming newer)', () => {
  const existing = makeTleRecord(25544, { ...fetched, epochMs: 1000 }, 0);
  const incoming = makeTleRecord(25544, { ...fetched, epochMs: 2000 }, 10);
  assert.equal(mergeRecord(existing, incoming).epochMs, 2000);
});

test('mergeRecord rejects an older incoming epoch (no clobber)', () => {
  const existing = makeTleRecord(25544, { ...fetched, epochMs: 2000 }, 0);
  const incoming = makeTleRecord(25544, { ...fetched, epochMs: 1000 }, 10);
  assert.equal(mergeRecord(existing, incoming).epochMs, 2000);
});

test('mergeRecord accepts incoming when no existing record', () => {
  const incoming = makeTleRecord(25544, fetched, 10);
  assert.equal(mergeRecord(null, incoming).epochMs, 1000);
});

test('tleAgeHours computes hours since epoch', () => {
  const r = makeTleRecord(25544, { ...fetched, epochMs: 0 }, 0);
  assert.equal(tleAgeHours(r, 3_600_000), 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-tle-record.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// lib/mcp/tle-record.mjs — pure TLE record shape + epoch-guarded merge.
// No I/O. The epoch guard guarantees a flaky source returning an older
// element set can never overwrite a newer stored one.

export function makeTleRecord(noradId, fetched, fetchedAtMs) {
  return {
    noradId,
    name: fetched.name,
    line1: fetched.line1,
    line2: fetched.line2,
    epochMs: fetched.epochMs,
    source: fetched.source,
    fetchedAtMs,
  };
}

// Return whichever record has the newer (larger) epochMs. Incoming wins
// ties (a re-fetch of the same epoch refreshes fetchedAtMs/source).
export function mergeRecord(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return incoming.epochMs >= existing.epochMs ? incoming : existing;
}

export function tleAgeHours(record, nowMs) {
  if (!record || !Number.isFinite(record.epochMs)) return null;
  return (nowMs - record.epochMs) / 3_600_000;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcp-tle-record.test.mjs`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/tle-record.mjs test/mcp-tle-record.test.mjs
git commit -m "feat(mcp): TLE record shape + epoch-guarded merge"
```

---

## Task 4: Multi-satellite TLE fetch

**Files:**
- Create: `lib/mcp/tle-fetch.mjs`
- Test: `test/mcp-tle-fetch.test.mjs`

Generalizes `lib/pass-finder/tle.js` (ISS-only) to any NORAD id, reusing its `parseTleEpoch`. Source order matches the existing module (wheretheiss → ivanstanojevic → celestrak). `fetch` is injectable for testing.

- [ ] **Step 1: Write the failing test**

```javascript
// test/mcp-tle-fetch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceUrls, fetchTleForId } from '../lib/mcp/tle-fetch.mjs';

const LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const LINE2 = '2 25544  51.6400 100.0000 0000000   0.0000   0.0000 15.50000000000000';

test('buildSourceUrls injects the NORAD id into every source', () => {
  const urls = buildSourceUrls(20580).map(s => s.url);
  assert.ok(urls.some(u => u.includes('20580')));
  assert.ok(urls.every(u => u.includes('20580')));
});

test('fetchTleForId returns the first source that parses', async () => {
  const fakeFetch = async (url) => {
    assert.ok(url.includes('25544'));
    return { ok: true, headers: new Map(), json: async () => ({ header: 'ISS (ZARYA)', line1: LINE1, line2: LINE2 }) };
  };
  const r = await fetchTleForId(25544, { fetchImpl: fakeFetch });
  assert.equal(r.line1, LINE1);
  assert.equal(r.source, 'wheretheiss');
  assert.ok(Number.isFinite(r.epochMs));
});

test('fetchTleForId falls through to the next source on failure', async () => {
  let calls = 0;
  const fakeFetch = async (url) => {
    calls++;
    if (url.includes('wheretheiss')) return { ok: false, status: 508 };
    return { ok: true, headers: new Map(), json: async () => ({ name: 'ISS (ZARYA)', line1: LINE1, line2: LINE2 }) };
  };
  const r = await fetchTleForId(25544, { fetchImpl: fakeFetch });
  assert.equal(r.source, 'ivanstanojevic');
  assert.ok(calls >= 2);
});

test('fetchTleForId returns null when all sources fail', async () => {
  const r = await fetchTleForId(25544, { fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.equal(r, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-tle-fetch.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// lib/mcp/tle-fetch.mjs — fetch a current TLE for ANY NORAD id.
// Generalizes lib/pass-finder/tle.js (which is hardwired to 25544) by
// parameterizing the catalog number in each source URL. Source order
// and parse shapes match the existing module. fetch is injectable so
// the source-ladder logic is unit-testable without network.

import { parseTleEpoch } from '../pass-finder/tle.js';

const PER_SOURCE_TIMEOUT_MS = 6000;

export function buildSourceUrls(noradId) {
  return [
    {
      name: 'wheretheiss',
      url: `https://api.wheretheiss.at/v1/satellites/${noradId}/tles`,
      parse: async (resp) => {
        const j = await resp.json();
        if (!j.line1 || !j.line2) throw new Error('malformed JSON shape');
        return { name: j.header || j.name || String(noradId), line1: j.line1, line2: j.line2 };
      },
    },
    {
      name: 'ivanstanojevic',
      url: `https://tle.ivanstanojevic.me/api/tle/${noradId}`,
      parse: async (resp) => {
        const j = await resp.json();
        if (!j.line1 || !j.line2) throw new Error('malformed JSON shape');
        return { name: j.name || String(noradId), line1: j.line1, line2: j.line2 };
      },
    },
    {
      name: 'celestrak',
      url: `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=TLE`,
      parse: async (resp) => {
        const text = await resp.text();
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length < 3) throw new Error('unexpected TLE shape');
        return { name: lines[0], line1: lines[1], line2: lines[2] };
      },
    },
  ];
}

async function fetchOne(src, fetchImpl) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PER_SOURCE_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(src.url, { signal: ac.signal });
    if (!resp.ok) throw new Error(`${src.name}: HTTP ${resp.status}`);
    const tle = await src.parse(resp);
    const epochMs = parseTleEpoch(tle.line1);
    if (!Number.isFinite(epochMs)) throw new Error(`${src.name}: unparseable epoch`);
    return { ...tle, epochMs, source: src.name };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTleForId(noradId, { fetchImpl = fetch } = {}) {
  for (const src of buildSourceUrls(noradId)) {
    try {
      return await fetchOne(src, fetchImpl);
    } catch (e) {
      console.warn(`TLE source failed (${noradId}): ${e?.message ?? e}`);
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcp-tle-fetch.test.mjs`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/tle-fetch.mjs test/mcp-tle-fetch.test.mjs
git commit -m "feat(mcp): multi-satellite TLE fetch"
```

---

## Task 5: TLE store (memory + Edge Config)

**Files:**
- Create: `lib/mcp/tle-store.mjs`
- Test: `test/mcp-tle-store.test.mjs`

A store maps `noradId -> record`. Two implementations behind one shape `{ readMap(), writeMap(map) }`. The in-memory store is for dev/test and is fully unit-tested; the Edge Config store is prod-only (network, verified manually in Task 12).

- [ ] **Step 1: Write the failing test**

```javascript
// test/mcp-tle-store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/mcp/tle-store.mjs';

test('memory store round-trips a map', async () => {
  const store = createMemoryStore();
  assert.deepEqual(await store.readMap(), {});
  await store.writeMap({ 25544: { noradId: 25544, epochMs: 1 } });
  assert.equal((await store.readMap())['25544'].epochMs, 1);
});

test('memory store can be seeded', async () => {
  const store = createMemoryStore({ 20580: { noradId: 20580, epochMs: 9 } });
  assert.equal((await store.readMap())['20580'].epochMs, 9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-tle-store.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// lib/mcp/tle-store.mjs — storage for the TLE record map (noradId -> record).
//
// createMemoryStore: dev/test, in-process.
// createEdgeConfigStore: prod. Reads via @vercel/edge-config (sub-ms at
//   the edge); writes via the Vercel REST API (the cron writes ~4x/day).
//   Requires env: EDGE_CONFIG (read connection string, set automatically
//   when an Edge Config is linked), EDGE_CONFIG_ID, VERCEL_API_TOKEN,
//   and optionally VERCEL_TEAM_ID.

export function createMemoryStore(initial = {}) {
  let map = { ...initial };
  return {
    async readMap() { return map; },
    async writeMap(next) { map = { ...next }; },
  };
}

export function createEdgeConfigStore() {
  const id = process.env.EDGE_CONFIG_ID;
  const token = process.env.VERCEL_API_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  return {
    async readMap() {
      const { get } = await import('@vercel/edge-config');
      return (await get('tle')) ?? {};
    },
    async writeMap(next) {
      const qs = teamId ? `?teamId=${teamId}` : '';
      const resp = await fetch(`https://api.vercel.com/v1/edge-config/${id}/items${qs}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ operation: 'upsert', key: 'tle', value: next }] }),
      });
      if (!resp.ok) throw new Error(`Edge Config write failed: HTTP ${resp.status}`);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcp-tle-store.test.mjs`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/tle-store.mjs test/mcp-tle-store.test.mjs
git commit -m "feat(mcp): TLE store (memory + edge config)"
```

---

## Task 6: Refresh endpoint (cron)

**Files:**
- Create: `lib/mcp/refresh.mjs` (pure orchestration, testable)
- Create: `app/api/refresh-tle/route.ts` (thin adapter)
- Test: `test/mcp-refresh.test.mjs`

Pure `refreshCatalog(deps)` does: read current map → fetch each catalog sat → epoch-guard merge → write map. The route adapts it and guards with `CRON_SECRET`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/mcp-refresh.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshCatalog } from '../lib/mcp/refresh.mjs';
import { createMemoryStore } from '../lib/mcp/tle-store.mjs';

const mkFetched = (noradId, epochMs) => ({
  name: `SAT-${noradId}`, line1: `L1-${noradId}`, line2: `L2-${noradId}`, epochMs, source: 'fake',
});

test('refreshCatalog writes a record for every fetched satellite', async () => {
  const store = createMemoryStore();
  const result = await refreshCatalog({
    store,
    catalog: [{ noradId: 1 }, { noradId: 2 }],
    fetchTle: async (id) => mkFetched(id, 100 + id),
    now: () => 5000,
  });
  const map = await store.readMap();
  assert.equal(map['1'].epochMs, 101);
  assert.equal(map['2'].epochMs, 102);
  assert.equal(result.updated.length, 2);
});

test('refreshCatalog keeps the stored record when fetch returns an older epoch', async () => {
  const store = createMemoryStore({ 1: { noradId: 1, epochMs: 999, line1: 'OLDGOOD' } });
  await refreshCatalog({
    store, catalog: [{ noradId: 1 }],
    fetchTle: async (id) => mkFetched(id, 500), // older
    now: () => 5000,
  });
  assert.equal((await store.readMap())['1'].epochMs, 999);
  assert.equal((await store.readMap())['1'].line1, 'OLDGOOD');
});

test('refreshCatalog is a no-op for a satellite whose fetch fails (serve-stale)', async () => {
  const store = createMemoryStore({ 1: { noradId: 1, epochMs: 999 } });
  const result = await refreshCatalog({
    store, catalog: [{ noradId: 1 }],
    fetchTle: async () => null,
    now: () => 5000,
  });
  assert.equal((await store.readMap())['1'].epochMs, 999);
  assert.equal(result.failed.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-refresh.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure orchestration**

```javascript
// lib/mcp/refresh.mjs — pure refresh orchestration. No framework, no
// global state: store, catalog, fetchTle and now are all injected.

import { makeTleRecord, mergeRecord } from './tle-record.mjs';

export async function refreshCatalog({ store, catalog, fetchTle, now }) {
  const map = { ...(await store.readMap()) };
  const updated = [];
  const failed = [];
  for (const entry of catalog) {
    const fetched = await fetchTle(entry.noradId);
    if (!fetched) { failed.push(entry.noradId); continue; }
    const incoming = makeTleRecord(entry.noradId, fetched, now());
    const merged = mergeRecord(map[entry.noradId] ?? null, incoming);
    map[entry.noradId] = merged;
    if (merged === incoming) updated.push(entry.noradId);
  }
  await store.writeMap(map);
  return { updated, failed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcp-refresh.test.mjs`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Write the route adapter**

```typescript
// app/api/refresh-tle/route.ts — Vercel Cron target. Reads catalog,
// fetches each TLE, epoch-guard merges into Edge Config. Guarded by
// CRON_SECRET so only Vercel Cron (or an authorized caller) can run it.
import { CATALOG } from '@/lib/mcp/catalog.mjs';
import { fetchTleForId } from '@/lib/mcp/tle-fetch.mjs';
import { refreshCatalog } from '@/lib/mcp/refresh.mjs';
import { createEdgeConfigStore } from '@/lib/mcp/tle-store.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const result = await refreshCatalog({
    store: createEdgeConfigStore(),
    catalog: CATALOG,
    fetchTle: (id) => fetchTleForId(id),
    now: () => Date.now(),
  });
  return Response.json({ ok: true, ...result });
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/mcp/refresh.mjs app/api/refresh-tle/route.ts test/mcp-refresh.test.mjs
git commit -m "feat(mcp): cron TLE refresh endpoint"
```

---

## Task 7: Cron schedule + env documentation

**Files:**
- Create: `vercel.json`
- Modify: `README.md` (env section — created if absent)

- [ ] **Step 1: Create the cron config**

```json
{
  "crons": [
    { "path": "/api/refresh-tle", "schedule": "0 */6 * * *" }
  ]
}
```

(Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on cron invocations when `CRON_SECRET` is set as an env var, matching the route guard in Task 6.)

- [ ] **Step 2: Document required env vars**

Append to `README.md`:

```markdown
## MCP server env vars

- `CRON_SECRET` — random string; Vercel Cron sends it as a Bearer token to `/api/refresh-tle`.
- `EDGE_CONFIG` — read connection string (auto-set when an Edge Config store is linked to the project).
- `EDGE_CONFIG_ID` — the Edge Config id (for writes).
- `VERCEL_API_TOKEN` — token with Edge Config write scope (for the cron write).
- `VERCEL_TEAM_ID` — only if the project lives under a team.
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json README.md
git commit -m "chore(mcp): cron schedule + env docs"
```

---

## Task 8: ECEF sampler

**Files:**
- Create: `lib/mcp/ecef-sampler.mjs`
- Test: `test/mcp-ecef-sampler.test.mjs`

Like `lib/truth.js: tlePositionEcef` but builds the satrec **once** and returns a sampler — the pass search calls it thousands of times.

- [ ] **Step 1: Write the failing test**

```javascript
// test/mcp-ecef-sampler.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEcefSampler } from '../lib/mcp/ecef-sampler.mjs';
import { tlePositionEcef } from '../lib/truth.js';

const LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const LINE2 = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';

test('sampler matches tlePositionEcef at the same instant', () => {
  const sampler = makeEcefSampler(LINE1, LINE2);
  const d = new Date('2024-01-01T13:00:00Z');
  const [x, y, z] = sampler(d);
  const [tx, ty, tz] = tlePositionEcef(LINE1, LINE2, d);
  assert.ok(Math.abs(x - tx) < 1, 'x within 1 m');
  assert.ok(Math.abs(y - ty) < 1, 'y within 1 m');
  assert.ok(Math.abs(z - tz) < 1, 'z within 1 m');
});

test('sampler returns a 3-vector with plausible LEO magnitude', () => {
  const sampler = makeEcefSampler(LINE1, LINE2);
  const v = sampler(new Date('2024-01-01T13:00:00Z'));
  const r = Math.hypot(...v);
  assert.ok(r > 6.6e6 && r < 7.1e6, `radius ${r} in LEO band`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-ecef-sampler.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// lib/mcp/ecef-sampler.mjs — build the satrec once, sample ECEF (meters)
// at any Date. Mirrors lib/truth.js: tlePositionEcef but hoists the
// twoline2satrec parse out of the hot loop for the pass search.

import * as sat from 'satellite.js';

export function makeEcefSampler(line1, line2) {
  const satrec = sat.twoline2satrec(line1.trim(), line2.trim());
  return function ecefAt(jsDate) {
    const pv = sat.propagate(satrec, jsDate);
    if (!pv || !pv.position) return null;
    const gmst = sat.gstime(jsDate);
    const ecf = sat.eciToEcf(pv.position, gmst);
    return [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000];
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcp-ecef-sampler.test.mjs`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/ecef-sampler.mjs test/mcp-ecef-sampler.test.mjs
git commit -m "feat(mcp): satrec-cached ECEF sampler"
```

---

## Task 9: Pass computation + position

**Files:**
- Create: `lib/mcp/passes.mjs`
- Test: `test/mcp-passes.test.mjs`

Reuses `findWindowsFromPredicate` (search.js), `observerSeesIss` (observer-pass.js), `issAltAzDeg`/`issIlluminated` (visibility.js), `peakMagnitudeInWindow`/`passSuccessProbability` (scoring.js), `sunPositionEcef` (sun.js), `ecefToGeodetic` (coords.js). Weather is neutralized with `() => null` (→ `effectivePClear` 0.5), so the core needs no network.

- [ ] **Step 1: Write the failing test**

```javascript
// test/mcp-passes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPasses, getPosition } from '../lib/mcp/passes.mjs';

// Real-ish ISS element set; epoch 2024-001. We search a fixed 48h
// window from the epoch so the test is deterministic.
const LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const LINE2 = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';
const START = Date.parse('2024-01-01T12:00:00Z');

test('getPosition returns a geodetic sub-point and sunlit flag', () => {
  const p = getPosition(LINE1, LINE2, new Date(START));
  assert.ok(p.latDeg >= -90 && p.latDeg <= 90);
  assert.ok(p.lonDeg >= -180 && p.lonDeg <= 180);
  assert.ok(p.altitudeKm > 300 && p.altitudeKm < 500, `alt ${p.altitudeKm}`);
  assert.equal(typeof p.sunlit, 'boolean');
});

test('findPasses (radio mode) returns ordered windows with the expected shape', () => {
  // Radio mode is deterministic and not gated on twilight/illumination,
  // so an observer under the ground track will always see passes — a
  // robust shape/ordering check independent of sun geometry.
  const passes = findPasses({
    line1: LINE1, line2: LINE2,
    observer: { latDeg: 0, lonDeg: 100 },
    startMs: START, windowHours: 48,
    minElevationDeg: 10, mode: 'radio',
  });
  assert.ok(passes.length > 0, 'finds at least one pass');
  for (const p of passes) {
    assert.ok(Date.parse(p.rise) <= Date.parse(p.peak));
    assert.ok(Date.parse(p.peak) <= Date.parse(p.set));
    assert.ok(p.peakElevationDeg >= 10);
    assert.ok(p.durationSec > 0);
    assert.equal(typeof p.sunlit, 'boolean');
    assert.ok('peakMagnitude' in p);
    assert.ok(p.quality >= 0 && p.quality <= 1);
    assert.ok(p.azimuthDeg.rise >= 0 && p.azimuthDeg.rise < 360);
  }
  const rises = passes.map(p => Date.parse(p.rise));
  assert.deepEqual(rises, [...rises].sort((a, b) => a - b), 'chronological');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-passes.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// lib/mcp/passes.mjs — MCP pass computation + position, composed from
// the existing pure pass-finder modules. Single-observer; weather is
// neutralized (no network) by passing a () => null cloud lookup.

import { findWindowsFromPredicate } from '../pass-finder/search.js';
import { observerSeesIss } from '../pass-finder/observer-pass.js';
import { issAltAzDeg, issIlluminated } from '../pass-finder/visibility.js';
import { peakMagnitudeInWindow, passSuccessProbability } from '../pass-finder/scoring.js';
import { sunPositionEcef } from '../pass-finder/sun.js';
import { ecefToGeodetic } from '../coords.js';
import { makeEcefSampler } from './ecef-sampler.mjs';

const round = (x, n = 2) => (x == null ? null : Number(x.toFixed(n)));
const iso = (ms) => new Date(ms).toISOString();

export function getPosition(line1, line2, jsDate) {
  const sampler = makeEcefSampler(line1, line2);
  const ecef = sampler(jsDate);
  if (!ecef) return null;
  const { latDeg, lonDeg, elevM } = ecefToGeodetic(ecef[0], ecef[1], ecef[2]);
  return {
    latDeg: round(latDeg, 4),
    lonDeg: round(lonDeg, 4),
    altitudeKm: round(elevM / 1000, 1),
    sunlit: issIlluminated(ecef, sunPositionEcef(jsDate)),
    time: jsDate.toISOString(),
  };
}

function summarizePass(win, observer, sampler, mode, minElevDeg) {
  const STEP = 1000;
  let peakAlt = -Infinity;
  let peakMs = win.startMs;
  for (let t = win.startMs; t <= win.endMs; t += STEP) {
    const e = sampler(new Date(t));
    if (!e) continue;
    const { alt } = issAltAzDeg(observer, e);
    if (alt > peakAlt) { peakAlt = alt; peakMs = t; }
  }
  const azAt = (ms) => {
    const e = sampler(new Date(ms));
    return e ? round(issAltAzDeg(observer, e).az, 1) : null;
  };
  const peakEcef = sampler(new Date(peakMs));
  const sunlit = peakEcef ? issIlluminated(peakEcef, sunPositionEcef(new Date(peakMs))) : false;
  const quality = passSuccessProbability(win, [observer], {
    mode, minElevDeg, issEcefAtFn: sampler, cloudForecastForObs: () => null,
  });
  return {
    rise: iso(win.startMs),
    peak: iso(peakMs),
    set: iso(win.endMs),
    peakElevationDeg: round(peakAlt, 1),
    azimuthDeg: { rise: azAt(win.startMs), peak: azAt(peakMs), set: azAt(win.endMs) },
    durationSec: Math.round((win.endMs - win.startMs) / 1000),
    peakMagnitude: round(peakMagnitudeInWindow(win, [observer], sampler), 1),
    sunlit,
    quality: round(quality, 3),
  };
}

export function findPasses({ line1, line2, observer, startMs, windowHours = 48, minElevationDeg = 10, mode = 'visual' }) {
  const obs = { id: 'observer', latDeg: observer.latDeg, lonDeg: observer.lonDeg };
  const sampler = makeEcefSampler(line1, line2);
  const endMs = startMs + windowHours * 3_600_000;
  const predicate = (ms) => {
    const e = sampler(new Date(ms));
    if (!e) return false;
    return observerSeesIss(obs, e, new Date(ms), mode, minElevationDeg);
  };
  const windows = findWindowsFromPredicate(predicate, startMs, endMs, 60_000);
  return windows.map(w => summarizePass(w, obs, sampler, mode, minElevationDeg));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcp-passes.test.mjs`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/passes.mjs test/mcp-passes.test.mjs
git commit -m "feat(mcp): pass computation + position"
```

---

## Task 10: Server-side geocoding (UA header)

**Files:**
- Modify: `lib/pass-finder/geocode.js`
- Test: `test/mcp-geocode.test.mjs`

Add an optional `init` arg so the server can supply a Nominatim-compliant `User-Agent`. Backward-compatible: existing browser callers pass nothing.

- [ ] **Step 1: Write the failing test**

```javascript
// test/mcp-geocode.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geocodeOne } from '../lib/pass-finder/geocode.js';

test('geocodeOne forwards a custom User-Agent header to fetch', async () => {
  let seenHeaders = null;
  const fakeFetch = async (_url, init) => {
    seenHeaders = init.headers;
    return { ok: true, json: async () => ([{ lat: '35.6', lon: '139.7', display_name: 'Tokyo' }]) };
  };
  const r = await geocodeOne('Tokyo', { fetchImpl: fakeFetch, headers: { 'User-Agent': 'seeksat-mcp/1.0' } });
  assert.equal(seenHeaders['User-Agent'], 'seeksat-mcp/1.0');
  assert.equal(r.displayName, 'Tokyo');
  assert.equal(r.latDeg, 35.6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-geocode.test.mjs`
Expected: FAIL — current `geocodeOne` ignores the second arg / uses global `fetch`.

- [ ] **Step 3: Make the backward-compatible edit**

Replace the body of `geocodeOne` in `lib/pass-finder/geocode.js` so it accepts options. The new signature is `geocodeOne(query, { fetchImpl = fetch, headers } = {})`:

```javascript
export async function geocodeOne(query, { fetchImpl = fetch, headers } = {}) {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const mergedHeaders = { "Accept-Language": "en-US,en;q=0.9", ...headers };
  const promise = fetchImpl(url, { headers: mergedHeaders })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(arr => {
      if (!arr || !arr.length) return null;
      const r = arr[0];
      return { latDeg: Number(r.lat), lonDeg: Number(r.lon), displayName: r.display_name };
    })
    .catch(err => {
      cache.delete(key);
      console.warn(`geocode failed for "${query}": ${err.message}`);
      return null;
    });
  cache.set(key, promise);
  return promise;
}
```

- [ ] **Step 4: Run the new test AND the full suite (backward compatibility)**

Run: `node --test test/mcp-geocode.test.mjs && npm test`
Expected: new test PASSES; the full suite still passes (no existing test referenced `geocodeOne` with a second arg).

- [ ] **Step 5: Commit**

```bash
git add lib/pass-finder/geocode.js test/mcp-geocode.test.mjs
git commit -m "feat(geocode): optional fetch/headers for server-side use"
```

---

## Task 11: Tool handlers (pure, deps-injected)

**Files:**
- Create: `lib/mcp/tools.mjs`
- Test: `test/mcp-tools.test.mjs`

Each handler takes validated input + a `deps` bag `{ readMap, geocode, fetchWeather, now }` and returns plain JSON. This is where catalog resolution, location resolution, and TLE-freshness attachment live — all testable with fakes, no network.

- [ ] **Step 1: Write the failing test**

```javascript
// test/mcp-tools.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSatellites, findPassesTool, getPositionTool, nextVisiblePassTool } from '../lib/mcp/tools.mjs';

const LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const LINE2 = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';
const REC = { noradId: 25544, name: 'ISS (ZARYA)', line1: LINE1, line2: LINE2, epochMs: Date.parse('2024-01-01T12:00:00Z'), source: 'wheretheiss', fetchedAtMs: 0 };
const NOW = Date.parse('2024-01-01T13:00:00Z');

const deps = {
  readMap: async () => ({ 25544: REC }),
  geocode: async (q) => (q.toLowerCase() === 'tokyo' ? { latDeg: 35.68, lonDeg: 139.69, displayName: 'Tokyo, Japan' } : null),
  fetchWeather: async () => null,
  now: () => NOW,
};

test('listSatellites returns catalog entries with freshness', async () => {
  const out = await listSatellites(deps);
  const iss = out.satellites.find(s => s.noradId === 25544);
  assert.equal(iss.name, 'ISS (ZARYA)');
  assert.equal(iss.tleAgeHours, 1);
  assert.equal(iss.source, 'wheretheiss');
});

test('getPositionTool resolves a satellite and returns a sub-point', async () => {
  const out = await getPositionTool({ satellite: 'iss' }, deps);
  assert.ok(out.altitudeKm > 300 && out.altitudeKm < 500);
  assert.equal(out.tleAgeHours, 1);
});

test('findPassesTool geocodes a location string', async () => {
  const out = await findPassesTool({ satellite: 'iss', location: 'Tokyo', mode: 'radio' }, deps);
  assert.equal(out.resolvedLocation.displayName, 'Tokyo, Japan');
  assert.ok(Array.isArray(out.passes));
});

test('findPassesTool errors clearly on unknown satellite', async () => {
  await assert.rejects(() => findPassesTool({ satellite: 'narnia', lat: 0, lon: 0 }, deps), /unknown satellite/i);
});

test('findPassesTool errors when neither coords nor location given', async () => {
  await assert.rejects(() => findPassesTool({ satellite: 'iss' }, deps), /location/i);
});

test('nextVisiblePassTool returns a single pass or null', async () => {
  const out = await nextVisiblePassTool({ satellite: 'iss', lat: 0, lon: 100, mode: 'radio' }, deps);
  assert.ok(out.pass === null || typeof out.pass.rise === 'string');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-tools.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// lib/mcp/tools.mjs — pure MCP tool handlers. All I/O is injected via
// deps: { readMap(), geocode(query, opts?), fetchWeather(lat,lon), now() }.
// Handlers throw Error on bad input; the route layer maps that to an
// MCP error response.

import { CATALOG, resolveSatellite } from './catalog.mjs';
import { tleAgeHours } from './tle-record.mjs';
import { findPasses, getPosition } from './passes.mjs';
import { cloudAt } from '../pass-finder/weather.js';
import { effectivePClear } from '../pass-finder/ratings.js';

const GEOCODE_HEADERS = { 'User-Agent': 'seeksat-mcp/1.0 (https://seeksat.app)' };

function freshness(record, nowMs) {
  return {
    tleEpoch: record ? new Date(record.epochMs).toISOString() : null,
    tleAgeHours: record ? Number(tleAgeHours(record, nowMs).toFixed(2)) : null,
    source: record ? record.source : null,
  };
}

async function requireRecord(satellite, deps) {
  const entry = resolveSatellite(satellite);
  if (!entry) throw new Error(`unknown satellite: ${satellite}`);
  const record = (await deps.readMap())[entry.noradId];
  if (!record) throw new Error(`no TLE cached yet for ${entry.name} (${entry.noradId})`);
  return { entry, record };
}

async function resolveLocation(input, deps) {
  if (input.lat != null && input.lon != null) {
    return { latDeg: input.lat, lonDeg: input.lon, displayName: null };
  }
  if (input.location) {
    const g = await deps.geocode(input.location, { headers: GEOCODE_HEADERS });
    if (!g) throw new Error(`could not geocode location: ${input.location}`);
    return g;
  }
  throw new Error('a location is required: pass lat+lon or a location string');
}

export async function listSatellites(deps) {
  const map = await deps.readMap();
  const nowMs = deps.now();
  return {
    satellites: CATALOG.map(s => ({
      noradId: s.noradId,
      name: s.name,
      aliases: s.aliases,
      ...freshness(map[s.noradId] ?? null, nowMs),
    })),
  };
}

export async function getPositionTool(input, deps) {
  const { record } = await requireRecord(input.satellite, deps);
  const when = input.time ? new Date(input.time) : new Date(deps.now());
  const pos = getPosition(record.line1, record.line2, when);
  return { ...pos, name: record.name, ...freshness(record, deps.now()) };
}

export async function findPassesTool(input, deps) {
  const { record } = await requireRecord(input.satellite, deps);
  const loc = await resolveLocation(input, deps);
  const passes = findPasses({
    line1: record.line1, line2: record.line2,
    observer: { latDeg: loc.latDeg, lonDeg: loc.lonDeg },
    startMs: deps.now(),
    windowHours: input.windowHours ?? 48,
    minElevationDeg: input.minElevation ?? 10,
    mode: input.mode ?? 'visual',
  });
  return {
    satellite: record.name,
    resolvedLocation: loc,
    passes,
    ...freshness(record, deps.now()),
  };
}

export async function nextVisiblePassTool(input, deps) {
  const out = await findPassesTool({ ...input, mode: input.mode ?? 'visual', windowHours: 72 }, deps);
  return { satellite: out.satellite, resolvedLocation: out.resolvedLocation, pass: out.passes[0] ?? null, tleEpoch: out.tleEpoch, tleAgeHours: out.tleAgeHours, source: out.source };
}

export async function getPassWeatherTool(input, deps) {
  const loc = input.location
    ? await deps.geocode(input.location, { headers: GEOCODE_HEADERS })
    : { latDeg: input.lat, lonDeg: input.lon, displayName: null };
  if (!loc) throw new Error(`could not geocode location: ${input.location}`);
  const forecast = await deps.fetchWeather(loc.latDeg, loc.lonDeg);
  const atMs = Date.parse(input.time);
  const cloudPct = cloudAt(forecast, atMs);
  const ageDays = (atMs - deps.now()) / 86_400_000;
  return {
    resolvedLocation: loc,
    cloudCoverPct: cloudPct == null ? null : Number(cloudPct.toFixed(0)),
    viewingProbability: Number(effectivePClear(cloudPct, ageDays).toFixed(2)),
    forecastSource: forecast ? 'open-meteo+met.no' : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcp-tools.test.mjs`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/tools.mjs test/mcp-tools.test.mjs
git commit -m "feat(mcp): pure tool handlers"
```

---

## Task 12: MCP route handler

**Files:**
- Create: `app/api/mcp/route.ts`

Wires the pure handlers to MCP via `mcp-handler` and `zod`. This is a thin adapter — verified by build + a live MCP client, not unit tests.

- [ ] **Step 1: Confirm the installed `mcp-handler` API**

Run: `node -e "import('mcp-handler').then(m => console.log(Object.keys(m)))"`
Expected: includes `createMcpHandler`. If the export name differs in the installed version, adjust the import in Step 2 accordingly (the tool-registration shape `server.tool(name, description, zodShape, handler)` is the stable part).

- [ ] **Step 2: Write the route**

```typescript
// app/api/mcp/route.ts — Streamable-HTTP MCP server. Thin adapter:
// validates input with zod, delegates to the pure handlers in
// lib/mcp/tools.mjs, returns the result as JSON text content.
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import {
  listSatellites, findPassesTool, getPositionTool, nextVisiblePassTool, getPassWeatherTool,
} from '@/lib/mcp/tools.mjs';
import { createEdgeConfigStore } from '@/lib/mcp/tle-store.mjs';
import { geocodeOne } from '@/lib/pass-finder/geocode.js';
import { fetchCloudForecast } from '@/lib/pass-finder/weather.js';

export const runtime = 'nodejs';

const store = createEdgeConfigStore();
const deps = {
  readMap: () => store.readMap(),
  geocode: (q: string, opts?: object) => geocodeOne(q, opts),
  fetchWeather: (lat: number, lon: number) => fetchCloudForecast(lat, lon),
  now: () => Date.now(),
};

const asText = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] });
const asError = (e: unknown) => ({ content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true });

const handler = createMcpHandler((server) => {
  server.tool(
    'list_satellites',
    'List the satellites this server can track, with each one\'s current TLE freshness.',
    {},
    async () => { try { return asText(await listSatellites(deps)); } catch (e) { return asError(e); } },
  );

  server.tool(
    'find_passes',
    'Find upcoming passes of a satellite over a location. Provide lat+lon or a location string. mode "visual" returns only sunlit, after-dark passes; "radio" returns all line-of-sight passes.',
    {
      satellite: z.string().describe('NORAD id or name, e.g. "iss" or 25544'),
      lat: z.number().min(-90).max(90).optional(),
      lon: z.number().min(-180).max(180).optional(),
      location: z.string().optional().describe('place name, geocoded if lat/lon omitted'),
      windowHours: z.number().positive().max(240).optional(),
      minElevation: z.number().min(0).max(90).optional(),
      mode: z.enum(['visual', 'radio']).optional(),
    },
    async (args) => { try { return asText(await findPassesTool(args, deps)); } catch (e) { return asError(e); } },
  );

  server.tool(
    'get_position',
    'Get the current (or at a given time) sub-point latitude/longitude, altitude, and sunlit state of a satellite.',
    {
      satellite: z.string(),
      time: z.string().optional().describe('ISO 8601; defaults to now'),
    },
    async (args) => { try { return asText(await getPositionTool(args, deps)); } catch (e) { return asError(e); } },
  );

  server.tool(
    'next_visible_pass',
    'Get the single next good visible pass of a satellite from a location.',
    {
      satellite: z.string(),
      lat: z.number().min(-90).max(90).optional(),
      lon: z.number().min(-180).max(180).optional(),
      location: z.string().optional(),
      mode: z.enum(['visual', 'radio']).optional(),
    },
    async (args) => { try { return asText(await nextVisiblePassTool(args, deps)); } catch (e) { return asError(e); } },
  );

  server.tool(
    'get_pass_weather',
    'Cloud-cover forecast and viewing probability for a location at a given time. Network-dependent.',
    {
      lat: z.number().min(-90).max(90).optional(),
      lon: z.number().min(-180).max(180).optional(),
      location: z.string().optional(),
      time: z.string().describe('ISO 8601 time of the pass'),
    },
    async (args) => { try { return asText(await getPassWeatherTool(args, deps)); } catch (e) { return asError(e); } },
  );
});

export { handler as GET, handler as POST };
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run typecheck && npm run build`
Expected: typecheck passes; build completes with `/api/mcp` and `/api/refresh-tle` in the route list.

- [ ] **Step 4: Commit**

```bash
git add app/api/mcp/route.ts
git commit -m "feat(mcp): streamable-http MCP route"
```

---

## Task 13: Local end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Seed a local TLE so tools have data without Edge Config**

For local dev, temporarily point the route's `store` at a memory store seeded from a live fetch. Create `scripts/seed-local-tle.mjs`:

```javascript
// scripts/seed-local-tle.mjs — prints a current TLE map you can paste
// into a local memory store or inspect. Run: node scripts/seed-local-tle.mjs
import { CATALOG } from '../lib/mcp/catalog.mjs';
import { fetchTleForId } from '../lib/mcp/tle-fetch.mjs';

const map = {};
for (const s of CATALOG) {
  const t = await fetchTleForId(s.noradId);
  if (t) map[s.noradId] = { noradId: s.noradId, ...t, fetchedAtMs: Date.now() };
  console.error(`${s.name}: ${t ? 'ok' : 'FAILED'}`);
}
console.log(JSON.stringify(map, null, 2));
```

Run: `node scripts/seed-local-tle.mjs > /tmp/tle.json`
Expected: stderr shows `ok` for at least ISS; `/tmp/tle.json` contains a record map.

- [ ] **Step 2: Run the dev server and connect the MCP inspector**

Run (terminal 1): `npm run dev`
Run (terminal 2): `npx @modelcontextprotocol/inspector`

In the inspector, connect to `http://localhost:3000/api/mcp` (Streamable HTTP transport). Confirm the five tools list. Call `list_satellites`.

Note: with the Edge Config store unset locally, `readMap()` returns `{}`, so pass-returning tools will report "no TLE cached yet." To exercise them locally, either (a) link a dev Edge Config and run `/api/refresh-tle` once with the `CRON_SECRET` header, or (b) temporarily swap `store` in `app/api/mcp/route.ts` for `createMemoryStore(JSON.parse(fs.readFileSync('/tmp/tle.json')))`. Revert any temporary swap before committing.

- [ ] **Step 3: Confirm the full test suite is green**

Run: `npm test`
Expected: all tests pass — the existing `lib/pass-finder/*` suite plus the new `mcp-*` suites.

- [ ] **Step 4: (no commit — verification task)**

If `scripts/seed-local-tle.mjs` is worth keeping, commit it:

```bash
git add scripts/seed-local-tle.mjs
git commit -m "chore(mcp): local TLE seed helper"
```

---

## Task 14: Portfolio writeup

**Files:**
- Create: `docs/seeksat-mcp.md`
- Modify: `README.md` (link to it)

- [ ] **Step 1: Write the doc**

Create `docs/seeksat-mcp.md` covering: the "two faces, one engine, one data layer" framing; the connect URL (`https://<domain>/api/mcp`) and a `claude_desktop_config.json` snippet; an example exchange ("when can I next see the ISS from Tokyo?"); and a "design decisions" section — deterministic offline core vs the single network-dependent `get_pass_weather`; cron-cached, epoch-guarded TLEs serving last-known-good through upstream outages; tool ergonomics (`next_visible_pass` as a one-call answer); and reuse of the same unit-tested engine that powers the 3D app.

```markdown
# SeekSat MCP

Same engine, two faces, one data layer: the SeekSat web app renders ISS passes
in a 3D globe for humans; this MCP server exposes the *same* SGP4 +
visibility-physics engine to AI agents.

## Connect

Streamable HTTP endpoint: `https://<your-domain>/api/mcp`

```json
{
  "mcpServers": {
    "seeksat": { "url": "https://<your-domain>/api/mcp" }
  }
}
```

## Tools

- `list_satellites` — what's trackable + TLE freshness
- `find_passes` — upcoming passes (magnitude, sunlit, quality) for a sat + location
- `get_position` — live sub-point + sunlit state
- `next_visible_pass` — one-call "when can I next see X from here?"
- `get_pass_weather` — cloud forecast + viewing probability (network-dependent)

## Design decisions

- **Deterministic, offline core.** Pass geometry, magnitude, and visibility run
  with zero network calls; weather is the only network-dependent tool and is
  deliberately separate.
- **Cron-cached, epoch-guarded TLEs.** A 6-hour cron refreshes TLEs into Edge
  Config; requests read from the cache (sub-ms), never upstream. A flaky source
  returning an older element set can't clobber good data, and an upstream outage
  just means serving the last-known-good TLE — still SGP4-valid for days.
- **Engine reuse.** Every pass number comes from the same unit-tested
  `lib/pass-finder/*` modules that drive the web app, so the two faces can't
  drift.
```

- [ ] **Step 2: Link from README**

Add a line under a "Docs" or top section of `README.md`: `- [SeekSat MCP server](docs/seeksat-mcp.md)`.

- [ ] **Step 3: Commit**

```bash
git add docs/seeksat-mcp.md README.md
git commit -m "docs(mcp): portfolio writeup + readme link"
```

---

## Deferred: Webapp Retrofit (workstream 3 — separate plan)

Not in this plan. Once the shared TLE cache (Tasks 5–7) is deployed, a follow-up
plan will server-seed the existing web app's TLE from the same Edge Config:
the page/server component reads the cached TLE and passes it to `PassFinderApp`
→ `TlePanel` as an initial prop (instant globe render); the existing client
`fetchIssTle()` becomes a non-blocking background freshen that swaps in only on
a newer epoch (shared epoch-guard from `lib/mcp/tle-record.mjs: mergeRecord`).
That work touches the Zustand store + Cesium scene TLE flow and deserves its own
focused plan. The MCP server in this plan is complete and deployable without it.

---

## Deployment checklist (after Task 14)

- [ ] In the Vercel project: create/link an **Edge Config** store (sets `EDGE_CONFIG`).
- [ ] Set env: `EDGE_CONFIG_ID`, `VERCEL_API_TOKEN` (Edge Config write scope), `VERCEL_TEAM_ID` (if applicable), `CRON_SECRET`.
- [ ] Deploy. Manually hit `/api/refresh-tle` once with `Authorization: Bearer $CRON_SECRET` to populate the cache before the first cron tick.
- [ ] Confirm `list_satellites` shows fresh `tleAgeHours`, then run a real agent query.
```