# MCP Monetization Seam — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)
**Scope:** Spec B of a 3-part batch. (A = satellite selector + catalog tiering, shipped on `seeksat-satellite-selector`; C = discoverability surfaces, follows.) This branch (`seeksat-mcp-monetization`) is stacked on Spec A because it consumes the catalog `tier` field A introduced.

## Purpose

Make the live MCP server **monetization-ready** without building billing: an optional API-key tier gate that is a complete no-op until configured, plus per-call usage logging. The point is architectural — flipping the MCP from "free for everyone" to "premium satellites require a paid key" later is a config + data change, not a refactor. For a job-hunt portfolio piece this reads as product-minded engineering, not a toy.

Today the gate is **dormant**: all five catalog satellites are `tier: 'free'` (from Spec A), and no `MCP_PRO_KEYS` are configured, so every caller is `free` and reaches everything. The seam is built, tested, and provably functional, but changes no current behavior.

## Background / current state

- `app/api/mcp/route.ts` is a thin adapter: it builds a static module-level `deps` object, registers five tools via `createMcpHandler` (each tool callback validates args with zod and delegates to a pure handler), and exports the handler as both `GET` and `POST`.
- `lib/mcp/tools.mjs` holds the pure handlers — `listSatellites`, `getPositionTool`, `findPassesTool`, `nextVisiblePassTool`, `getPassWeatherTool` — each `(input, deps)`, throwing `Error` on bad input. `requireRecord(satellite, deps)` resolves a catalog entry and its cached TLE record.
- `lib/catalog.mjs` entries carry `tier: 'free' | 'premium'` (Spec A). All five are currently `'free'`.
- Tests are `node:test` over pure `.mjs`/`.js` modules; the route is verified by typecheck + `next build` + manual curl (no React/route test harness).

## The tier-threading approach (chosen: AsyncLocalStorage)

The tool callbacks are registered once at module load and close over a static `deps`. To enforce per-request tiering inside the pure handlers without rebuilding the handler per request or coupling to `mcp-handler` internals, a thin route wrapper resolves the caller's tier and runs `handler(req)` inside an `AsyncLocalStorage` scope. Each tool callback reads the tier from that context and passes it to the pure handler. ALS context propagation through awaited promises is a Node guarantee, so it survives `mcp-handler`'s async tool dispatch. Rejected alternatives: `withMcpAuth` (OAuth-flavored, heavier than an API-key seam needs, couples to library internals) and reading the header inside every tool callback (repetitive, no shared context).

## Components

### 1. `lib/mcp/auth.mjs` (pure, new)

```
parseProKeys(envValue: string | undefined) -> Set<string>
  // split MCP_PRO_KEYS on commas, trim, drop empties.

resolveTier(presentedKey: string | null, proKeys: Set<string>) -> { tier, keyId }
  // tier 'pro' iff presentedKey is non-empty AND in proKeys; else 'free'.
  // keyId: a short, non-reversible label for logs (e.g. 'key_' + first 6
  //   chars of a SHA-256 hex of the key) when a key is presented; null
  //   when anonymous. NEVER returns the raw key.
```

When `proKeys` is empty (env unset) every caller resolves to `free` — the dormant, fully-open default.

### 2. `lib/mcp/request-context.mjs` (new)

A module-scoped `AsyncLocalStorage<{ tier, keyId }>`:

```
runWithRequestContext(ctx, fn)  // als.run(ctx, fn)
getRequestContext()             // als.getStore() ?? { tier: 'free', keyId: null }
```

`getRequestContext` defaults to `free`/anonymous so a tool invoked outside any wrapper (e.g. a unit test importing the handler) degrades safely.

### 3. Tier enforcement in `lib/mcp/tools.mjs`

`requireRecord` gains a third parameter `tier`:

```
async function requireRecord(satellite, deps, tier) {
  const entry = resolveSatellite(satellite);
  if (!entry) throw new Error(`unknown satellite: ${satellite}`);
  if (entry.tier === 'premium' && tier !== 'pro') {
    throw new Error(`${entry.name} is a premium satellite — set an API key to access it`);
  }
  const record = (await deps.readMap())[entry.noradId];
  if (!record) throw new Error(`no TLE cached yet for ${entry.name} (${entry.noradId})`);
  return { entry, record };
}
```

Handlers that call `requireRecord` (`getPositionTool`, `findPassesTool`, and `nextVisiblePassTool` via `findPassesTool`) accept `tier` and forward it. `tier` defaults to `'free'` when omitted so existing callers/tests are unaffected. `getPassWeatherTool` takes no satellite, so it is not tier-gated. `listSatellites` is not gated but **adds each satellite's `tier`** to its output so an agent can see which satellites need a paid key.

Dormant today: with all catalog satellites `'free'`, the premium branch never triggers. A test fixture with a `'premium'` entry proves it does gate.

### 4. `lib/mcp/usage.mjs` (new)

```
logUsage({ tool, tier, keyId, satellite }) -> the structured record (also written)
  // Emits one JSON line to stdout: {"evt":"mcp_tool", tool, tier, keyId,
  //   satellite, ts}. Vercel captures stdout as logs — this is the
  //   metering foundation. Returns the record so it is unit-testable
  //   without capturing console output. ts via Date.now().
```

### 5. Route wiring (`app/api/mcp/route.ts`)

- Read the presented key once per request: `Authorization: Bearer <key>`, falling back to the `x-api-key` header.
- `const { tier, keyId } = resolveTier(presentedKey, PRO_KEYS)` where `PRO_KEYS = parseProKeys(process.env.MCP_PRO_KEYS)` is module-level.
- Wrap the exported handler so the whole MCP dispatch runs inside `runWithRequestContext({ tier, keyId }, () => handler(req))`. Export the wrapper as `GET`/`POST`.
- In each tool callback: read `getRequestContext()`, pass `tier` to handlers that take it, and call `logUsage({ tool, tier, keyId, satellite: args.satellite ?? null })`.

## Data flow

```
request → wrapper reads key → resolveTier → runWithRequestContext({tier,keyId})
        → mcp-handler dispatch → tool callback reads getRequestContext()
        → logUsage(...) + pure handler(args, deps, tier)
        → requireRecord gates premium → result
```

## Error handling

- Unknown / absent / non-matching key → `free` (fail-open). Never 401 — all content is free today; the seam must not break existing anonymous access.
- Premium satellite requested by a `free` caller → the pure handler throws; the route's existing `asError` maps it to a clean MCP error with `isError: true`.
- `logUsage` must never throw into the request path — it only formats + writes a line.

## Testing

`node:test` (pure modules):
- `auth.parseProKeys`: empty/undefined → empty set; CSV with spaces/blanks → trimmed set.
- `auth.resolveTier`: no env keys → `free` for any input; matching key → `pro`; non-matching key → `free`; `keyId` is masked (never equals the raw key) when a key is presented, `null` when anonymous.
- `tools` premium gating: with a `premium` fixture entry, a `free` tier throws; `pro` passes. Existing all-free catalog still works with default `tier`.
- `tools.listSatellites`: output entries include `tier`.
- `usage.logUsage`: returns the expected record shape including `evt: 'mcp_tool'`.

Route wiring: `npm run typecheck` + `next build`, plus a manual curl matrix — no key (free, works), bogus `Authorization: Bearer x` (still free, works), and (after temporarily marking a sat premium locally) confirming the premium error. Manual only; documented in the plan.

## Out of scope (explicitly deferred)

- **Real rate limiting** — needs a durable store (e.g. Upstash/Vercel KV). The usage log + resolved tier are its foundation; not built now.
- **Billing / Stripe / key issuance UI** — none.
- **OAuth / MCP auth spec** — the seam is a simple API key, not OAuth.
- **Marketing/docs narrative** ("free tier, contact for more") — that lives in Spec C; Spec B only surfaces `tier` in `list_satellites` and the premium error text.
- **Flipping any real satellite to `premium`** — product decision deferred; the catalog stays all-free.

## Files affected

- **Add:** `lib/mcp/auth.mjs`, `lib/mcp/request-context.mjs`, `lib/mcp/usage.mjs`, `test/mcp-auth.test.mjs`, `test/mcp-usage.test.mjs`.
- **Modify:** `lib/mcp/tools.mjs` (tier param on `requireRecord` + gated handlers, `tier` in `listSatellites`), `test/mcp-tools.test.mjs` (premium-gating + tier-in-output cases), `app/api/mcp/route.ts` (key read, tier resolve, ALS wrap, usage logging).
