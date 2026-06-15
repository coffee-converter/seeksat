# MCP Monetization Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dormant, monetization-ready API-key tier gate + per-call usage logging to the MCP server, changing no current behavior (all satellites stay free, no keys configured).

**Architecture:** A thin route wrapper reads an API key, resolves a `free`/`pro` tier, and runs the MCP dispatch inside an `AsyncLocalStorage` scope. Each tool callback reads the tier from context, logs usage, and passes the tier to the pure handlers, where `requireRecord` gates `premium` satellites. Pure logic (`auth`, `usage`, tier gating) is `node:test`-covered; the route wiring is verified by typecheck + build.

**Tech Stack:** Next.js route handler, `mcp-handler`, `node:crypto` (key masking), `node:async_hooks` (ALS), `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-14-mcp-monetization-seam-design.md`

---

## File Structure

- **Create** `lib/mcp/auth.mjs` — `parseProKeys`, `resolveTier` (pure key→tier + masked keyId).
- **Create** `lib/mcp/request-context.mjs` — ALS holding `{ tier, keyId }` for the request.
- **Create** `lib/mcp/usage.mjs` — `logUsage` structured stdout line.
- **Modify** `lib/mcp/tools.mjs` — exported `assertTierAllows`, `tier` param threaded through `requireRecord` + satellite handlers, `tier` added to `listSatellites` output.
- **Modify** `app/api/mcp/route.ts` — key read, tier resolve, ALS wrap, per-tool usage logging.
- **Tests** `test/mcp-auth.test.mjs`, `test/mcp-request-context.test.mjs`, `test/mcp-usage.test.mjs`, additions to `test/mcp-tools.test.mjs`.

---

## Task 1: `auth.mjs` — key parsing + tier resolution

**Files:** Create `lib/mcp/auth.mjs`; Test `test/mcp-auth.test.mjs`.

- [ ] **Step 1: Write the failing test**

Create `test/mcp-auth.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProKeys, resolveTier } from '../lib/mcp/auth.mjs';

test('parseProKeys: empty/undefined/blank -> empty set', () => {
  assert.equal(parseProKeys(undefined).size, 0);
  assert.equal(parseProKeys('').size, 0);
  assert.equal(parseProKeys('   ').size, 0);
});

test('parseProKeys: trims and drops blank entries', () => {
  const s = parseProKeys(' a , b ,, c ');
  assert.deepEqual([...s].sort(), ['a', 'b', 'c']);
});

test('resolveTier: no keys configured -> free for any input, keyId masked or null', () => {
  const none = new Set();
  assert.deepEqual(resolveTier(null, none), { tier: 'free', keyId: null });
  const r = resolveTier('whatever', none);
  assert.equal(r.tier, 'free');
  assert.ok(r.keyId.startsWith('key_'));
});

test('resolveTier: matching key -> pro; non-matching -> free; raw key never leaks', () => {
  const keys = parseProKeys('secret123');
  const pro = resolveTier('secret123', keys);
  assert.equal(pro.tier, 'pro');
  assert.ok(pro.keyId.startsWith('key_'));
  assert.ok(!pro.keyId.includes('secret123'));
  const free = resolveTier('wrongkey', keys);
  assert.equal(free.tier, 'free');
  assert.ok(!free.keyId.includes('wrongkey'));
});

test('resolveTier: anonymous (no key) -> null keyId', () => {
  assert.equal(resolveTier(null, parseProKeys('k')).keyId, null);
  assert.equal(resolveTier('', parseProKeys('k')).keyId, null);
  assert.equal(resolveTier('   ', parseProKeys('k')).keyId, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-auth.test.mjs`
Expected: FAIL — cannot find module `../lib/mcp/auth.mjs`.

- [ ] **Step 3: Implement `lib/mcp/auth.mjs`**

```js
// lib/mcp/auth.mjs — pure API-key → tier resolution for the MCP server.
// Dormant by default: with no MCP_PRO_KEYS configured, every caller is
// 'free'. Never returns or logs the raw key — only a masked keyId.

import { createHash } from 'node:crypto';

// Parse the comma-separated MCP_PRO_KEYS env value into a Set of keys.
export function parseProKeys(envValue) {
  if (!envValue) return new Set();
  return new Set(envValue.split(',').map((s) => s.trim()).filter(Boolean));
}

// Resolve a presented key to { tier, keyId }. tier is 'pro' iff the key
// is non-empty and present in proKeys, else 'free'. keyId is a short,
// non-reversible label for logs ('key_' + 6 hex of SHA-256) when a key
// is presented, or null when the caller is anonymous.
export function resolveTier(presentedKey, proKeys) {
  const key = presentedKey && presentedKey.trim();
  if (!key) return { tier: 'free', keyId: null };
  const keyId = 'key_' + createHash('sha256').update(key).digest('hex').slice(0, 6);
  return { tier: proKeys.has(key) ? 'pro' : 'free', keyId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcp-auth.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/auth.mjs test/mcp-auth.test.mjs
git commit -m "feat(mcp): API-key tier resolution (parseProKeys, resolveTier)"
```

---

## Task 2: `request-context.mjs` — ALS request scope

**Files:** Create `lib/mcp/request-context.mjs`; Test `test/mcp-request-context.test.mjs`.

- [ ] **Step 1: Write the failing test**

Create `test/mcp-request-context.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWithRequestContext, getRequestContext } from '../lib/mcp/request-context.mjs';

test('getRequestContext defaults to free/anonymous outside any scope', () => {
  assert.deepEqual(getRequestContext(), { tier: 'free', keyId: null });
});

test('context is visible to callees, including across await', async () => {
  await runWithRequestContext({ tier: 'pro', keyId: 'key_abc123' }, async () => {
    assert.equal(getRequestContext().tier, 'pro');
    await Promise.resolve();
    assert.equal(getRequestContext().keyId, 'key_abc123');
  });
  // restored to default outside the scope
  assert.equal(getRequestContext().tier, 'free');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-request-context.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `lib/mcp/request-context.mjs`**

```js
// lib/mcp/request-context.mjs — AsyncLocalStorage carrying the resolved
// { tier, keyId } for the current MCP request, so the statically-
// registered tool callbacks can read per-request auth without rebuilding
// the handler. ALS propagates through awaited promises (Node guarantee),
// so it survives mcp-handler's async tool dispatch.

import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();
const DEFAULT = { tier: 'free', keyId: null };

export function runWithRequestContext(ctx, fn) {
  return als.run(ctx, fn);
}

// Defaults to free/anonymous when called outside any scope (e.g. a unit
// test importing a handler), so tools degrade safely.
export function getRequestContext() {
  return als.getStore() ?? DEFAULT;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcp-request-context.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/request-context.mjs test/mcp-request-context.test.mjs
git commit -m "feat(mcp): AsyncLocalStorage request context for tier threading"
```

---

## Task 3: `usage.mjs` — structured usage logging

**Files:** Create `lib/mcp/usage.mjs`; Test `test/mcp-usage.test.mjs`.

- [ ] **Step 1: Write the failing test**

Create `test/mcp-usage.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logUsage } from '../lib/mcp/usage.mjs';

test('logUsage returns the structured record', () => {
  const r = logUsage({ tool: 'find_passes', tier: 'free', keyId: null, satellite: 'iss' });
  assert.equal(r.evt, 'mcp_tool');
  assert.equal(r.tool, 'find_passes');
  assert.equal(r.tier, 'free');
  assert.equal(r.satellite, 'iss');
  assert.equal(typeof r.ts, 'number');
});

test('logUsage defaults keyId and satellite to null', () => {
  const r = logUsage({ tool: 'list_satellites', tier: 'pro' });
  assert.equal(r.keyId, null);
  assert.equal(r.satellite, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-usage.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `lib/mcp/usage.mjs`**

```js
// lib/mcp/usage.mjs — per-call usage metering for the MCP. Emits one
// structured JSON line to stdout (Vercel captures stdout as logs); the
// foundation for future metered/paid tiers. Returns the record so it is
// unit-testable without capturing console output. Must never throw into
// the request path.

export function logUsage({ tool, tier, keyId = null, satellite = null }) {
  const record = { evt: 'mcp_tool', tool, tier, keyId, satellite, ts: Date.now() };
  console.log(JSON.stringify(record));
  return record;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcp-usage.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/usage.mjs test/mcp-usage.test.mjs
git commit -m "feat(mcp): structured per-call usage logging"
```

---

## Task 4: Tier gating in `tools.mjs`

**Files:** Modify `lib/mcp/tools.mjs`; Test additions in `test/mcp-tools.test.mjs`.

Context: `requireRecord(satellite, deps)` currently resolves a catalog entry + record. `getPositionTool`, `findPassesTool` call it; `nextVisiblePassTool` delegates to `findPassesTool`. `listSatellites` maps `CATALOG` to `{ noradId, name, aliases, ...freshness }`. We add a pure `assertTierAllows` (so gating is testable without touching the all-free real catalog), thread a `tier` param (default `'free'`) through the handlers, and add `tier` to the `listSatellites` output.

- [ ] **Step 1: Write the failing tests**

Append to `test/mcp-tools.test.mjs` (add this import alongside the existing `'../lib/mcp/tools.mjs'` import — a second import line from the same module is fine, or merge it into the existing one):

```js
import { assertTierAllows } from '../lib/mcp/tools.mjs';

test('assertTierAllows gates premium satellites for the free tier', () => {
  const premium = { name: 'Spy Sat', tier: 'premium' };
  assert.throws(() => assertTierAllows(premium, 'free'), /premium satellite/i);
  assert.doesNotThrow(() => assertTierAllows(premium, 'pro'));
});

test('assertTierAllows always allows free satellites', () => {
  const free = { name: 'ISS (ZARYA)', tier: 'free' };
  assert.doesNotThrow(() => assertTierAllows(free, 'free'));
  assert.doesNotThrow(() => assertTierAllows(free, 'pro'));
});

test('listSatellites includes each satellite tier', async () => {
  const out = await listSatellites(deps);
  const iss = out.satellites.find((s) => s.noradId === 25544);
  assert.equal(iss.tier, 'free');
});

test('getPositionTool still works at the default free tier for a free satellite', async () => {
  const out = await getPositionTool({ satellite: 'iss' }, deps);
  assert.ok(out.altitudeKm > 300);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/mcp-tools.test.mjs`
Expected: FAIL — `assertTierAllows` is not exported; `iss.tier` is undefined.

- [ ] **Step 3: Add `assertTierAllows` and thread tier through `tools.mjs`**

In `lib/mcp/tools.mjs`, add the exported helper (near the top, after the imports):

```js
// Throw if `tier` may not access `entry`. Premium satellites require the
// 'pro' tier; free satellites are always allowed. Pure + exported so the
// gate is testable without a premium entry in the real (all-free) catalog.
export function assertTierAllows(entry, tier) {
  if (entry.tier === 'premium' && tier !== 'pro') {
    throw new Error(`${entry.name} is a premium satellite — set an API key to access it`);
  }
}
```

Change `requireRecord` to take and enforce `tier` (default `'free'`):

```js
async function requireRecord(satellite, deps, tier = 'free') {
  const entry = resolveSatellite(satellite);
  if (!entry) throw new Error(`unknown satellite: ${satellite}`);
  assertTierAllows(entry, tier);
  const record = (await deps.readMap())[entry.noradId];
  if (!record) throw new Error(`no TLE cached yet for ${entry.name} (${entry.noradId})`);
  return { entry, record };
}
```

Thread `tier` (default `'free'`) through the satellite handlers:

```js
export async function getPositionTool(input, deps, tier = 'free') {
  const { record } = await requireRecord(input.satellite, deps, tier);
  // ...rest unchanged...
```

```js
export async function findPassesTool(input, deps, tier = 'free') {
  const { record } = await requireRecord(input.satellite, deps, tier);
  // ...rest unchanged...
```

```js
export async function nextVisiblePassTool(input, deps, tier = 'free') {
  const out = await findPassesTool({ ...input, mode: input.mode ?? 'visual', windowHours: 72 }, deps, tier);
  // ...rest unchanged...
```

Add `tier` to the `listSatellites` output mapping:

```js
    satellites: CATALOG.map(s => ({
      noradId: s.noradId,
      name: s.name,
      aliases: s.aliases,
      tier: s.tier,
      ...freshness(map[s.noradId] ?? null, nowMs),
    })),
```

(`getPassWeatherTool` is unchanged — it takes no satellite, so it is not tier-gated.)

- [ ] **Step 4: Run the full suite to verify pass + no regressions**

Run: `npm test`
Expected: ALL PASS (existing tools tests still pass because `tier` defaults to `'free'` and all real satellites are free).

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/tools.mjs test/mcp-tools.test.mjs
git commit -m "feat(mcp): tier-gate premium satellites; expose tier in list_satellites"
```

---

## Task 5: Route wiring (`app/api/mcp/route.ts`)

**Files:** Modify `app/api/mcp/route.ts`.

Context: the file builds `const handler = createMcpHandler(...)` and exports `{ handler as GET, handler as POST }`. We rename the inner handler to `mcpHandler`, add auth/logging imports, read the key, and export a wrapper that resolves the tier and runs the dispatch inside the ALS scope. Each tool callback reads the context, logs usage, and passes `tier` to the handlers that accept it.

- [ ] **Step 1: Add imports + module-level key set**

After the existing imports in `app/api/mcp/route.ts`, add:

```ts
import { parseProKeys, resolveTier } from '@/lib/mcp/auth.mjs';
import { runWithRequestContext, getRequestContext } from '@/lib/mcp/request-context.mjs';
import { logUsage } from '@/lib/mcp/usage.mjs';

const PRO_KEYS = parseProKeys(process.env.MCP_PRO_KEYS);

function presentedKey(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return req.headers.get('x-api-key');
}
```

- [ ] **Step 2: Add context read + usage logging + tier pass-through in each tool callback**

Update the five tool callbacks. For each, read the context and log usage at the top, and pass `tier` to the satellite handlers:

```ts
    server.tool('list_satellites', '...keep description...', {}, async () => {
      const { tier, keyId } = getRequestContext();
      logUsage({ tool: 'list_satellites', tier, keyId });
      try { return asText(await listSatellites(deps)); } catch (e) { return asError(e); }
    });

    server.tool('find_passes', '...keep description+schema...', { /* keep schema */ },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'find_passes', tier, keyId, satellite: args.satellite });
        try { return asText(await findPassesTool(args, deps, tier)); } catch (e) { return asError(e); }
      });

    server.tool('get_position', '...keep...', { /* keep schema */ },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'get_position', tier, keyId, satellite: args.satellite });
        try { return asText(await getPositionTool(args, deps, tier)); } catch (e) { return asError(e); }
      });

    server.tool('next_visible_pass', '...keep...', { /* keep schema */ },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'next_visible_pass', tier, keyId, satellite: args.satellite });
        try { return asText(await nextVisiblePassTool(args, deps, tier)); } catch (e) { return asError(e); }
      });

    server.tool('get_pass_weather', '...keep...', { /* keep schema */ },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'get_pass_weather', tier, keyId });
        try { return asText(await getPassWeatherTool(args, deps)); } catch (e) { return asError(e); }
      });
```

Keep every existing tool description string and zod schema exactly as-is — only add the two leading lines (context read + logUsage) and the `tier` argument on the three satellite handlers.

- [ ] **Step 3: Rename inner handler + export the auth wrapper**

Change `const handler = createMcpHandler(` to `const mcpHandler = createMcpHandler(`. Replace the final export line with:

```ts
// Wrap the MCP dispatch: resolve the caller's tier from the API key and
// run the whole dispatch inside the ALS scope so the tool callbacks above
// can read it. Fail-open — an unknown/absent key is simply 'free'.
async function handler(req: Request): Promise<Response> {
  const { tier, keyId } = resolveTier(presentedKey(req), PRO_KEYS);
  return runWithRequestContext({ tier, keyId }, () => mcpHandler(req));
}

export { handler as GET, handler as POST };
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: compiles; `/api/mcp` route builds.

- [ ] **Step 6: Commit**

```bash
git add app/api/mcp/route.ts
git commit -m "feat(mcp): wire API-key tier resolution + usage logging into the route"
```

---

## Task 6: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass (including the new auth/context/usage tests and the tools gating tests); typecheck + build clean.

- [ ] **Step 2: Manual curl smoke (optional, after deploy or against `npm run dev`)**

With no `MCP_PRO_KEYS` set, confirm the seam is dormant and fail-open. Initialize the MCP and list tools both with no key and with a bogus key — both should succeed identically:

```bash
# no key
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
# bogus key — still free, still works
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer bogus" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

Expected: both return a normal `initialize` result (the dormant gate never 401s). Server logs show `{"evt":"mcp_tool",...}` lines on tool calls. The premium-gating path is covered by the `assertTierAllows` unit tests (the real catalog has no premium satellite to exercise it live).

- [ ] **Step 3: Final commit (only if manual fixups were needed)**

```bash
git add -A
git commit -m "chore(mcp): monetization seam verification fixups"
```

---

## Notes for the implementer

- **Dormant by design:** no `MCP_PRO_KEYS` configured + all catalog satellites `free` means every caller is `free` and reaches everything. Do not flip any real satellite to `premium` — that's a deferred product decision.
- **Fail-open:** never return 401. An unknown/absent/bogus key resolves to `free`. The seam must not break existing anonymous MCP access.
- **Never log raw keys** — only the masked `keyId` from `resolveTier`.
- **`.mjs` into `.ts`** imports already work in this repo (the route imports `tle-store.mjs`, `catalog.mjs`). The new `auth`/`request-context`/`usage` modules import cleanly the same way.
- **No route/React test harness** — the route is verified by typecheck + build + the manual curl; all unit tests target the pure `.mjs` modules.
