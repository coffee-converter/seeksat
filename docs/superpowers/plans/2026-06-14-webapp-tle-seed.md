# Webapp TLE Server-Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pass-finder home page render the ISS immediately by server-seeding the initial TLE from the same Edge Config cache the MCP uses, while keeping the client mount fetch (and its clock-sync) intact and guarding it against overwriting a newer seed or a user edit.

**Architecture:** One new pure module (`lib/pass-finder/tle-seed.js`: `recordToTle` + `isNewerTle`, unit-tested with `node:test`). `app/page.tsx` (server component) reads the ISS record from Edge Config and passes an `initialTle` prop. `PassFinderApp` seeds the Zustand store on mount. `TlePanel`'s existing mount fetch gains a user-edit guard and an epoch guard before applying its result. The scene and panel already subscribe to the store, so the ISS appears the instant the seed lands.

**Tech Stack:** Next.js 15 App Router · React 19 · Zustand · `satellite.js` (via existing `parseTleEpoch`) · `@vercel/edge-config` (via existing `lib/mcp/tle-store.mjs`).

**Branch note:** This work stacks on the `seeksat-mcp-server` branch (PR #4) because it imports `createEdgeConfigStore` from `lib/mcp/tle-store.mjs`, which isn't on `main` yet. Implement on `seeksat-webapp-tle-seed` (already branched off `seeksat-mcp-server`). Its PR targets `seeksat-mcp-server` (or `main` once #4 merges).

---

## File Structure

**New (pure, unit-tested):**
- `lib/pass-finder/tle-seed.js` — `recordToTle(record)` maps an Edge Config TLE record to the store's `Tle` shape; `isNewerTle(currentLine1, fetchedLine1)` epoch-guard. Both pure, reusing the existing `parseTleEpoch`.
- `test/tle-seed.test.mjs` — unit tests.

**Modified (React/server wiring — verified by typecheck + build + manual check, matching the repo's pure-logic-only automated-test convention):**
- `app/page.tsx` — read Edge Config, compute `initialTle`, pass as prop.
- `components/PassFinderApp.tsx` — accept `initialTle`, seed store on mount.
- `components/passes/TlePanel.tsx` — user-edit + epoch guards on fetch apply; seeded status nicety; manual-refresh bypass.

Unchanged: the store (`lib/pass-finder-store.ts`), types (`lib/types.ts`), clock-sync, the scene, and the triangulate page.

---

## Task 1: Pure seed/guard module

**Files:**
- Create: `lib/pass-finder/tle-seed.js`
- Test: `test/tle-seed.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// test/tle-seed.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordToTle, isNewerTle } from '../lib/pass-finder/tle-seed.js';

// Two valid line-1 strings differing only by epoch (cols 18-32 = "YY DDD.ddddddd").
const L1_OLD = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const L1_NEW = '1 25544U 98067A   24002.50000000  .00000000  00000+0  00000+0 0  9991';
const L2     = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';

const REC = { noradId: 25544, name: 'ISS (ZARYA)', line1: L1_OLD, line2: L2, epochMs: 1, source: 'x', fetchedAtMs: 0 };

test('recordToTle maps a valid record to the Tle shape', () => {
  assert.deepEqual(recordToTle(REC), { name: 'ISS (ZARYA)', line1: L1_OLD, line2: L2 });
});

test('recordToTle returns null for missing record', () => {
  assert.equal(recordToTle(null), null);
  assert.equal(recordToTle(undefined), null);
});

test('recordToTle returns null for a malformed record (non-TLE lines)', () => {
  assert.equal(recordToTle({ name: 'x', line1: 'nope', line2: 'nope' }), null);
  assert.equal(recordToTle({ name: 'x', line1: L1_OLD }), null); // missing line2
});

test('recordToTle defaults a missing name to empty string', () => {
  assert.equal(recordToTle({ line1: L1_OLD, line2: L2 }).name, '');
});

test('isNewerTle: strictly-newer fetched epoch wins', () => {
  assert.equal(isNewerTle(L1_OLD, L1_NEW), true);
});

test('isNewerTle: equal or older fetched epoch does not win', () => {
  assert.equal(isNewerTle(L1_OLD, L1_OLD), false);
  assert.equal(isNewerTle(L1_NEW, L1_OLD), false);
});

test('isNewerTle: junk fetched line never wins', () => {
  assert.equal(isNewerTle(L1_OLD, 'garbage'), false);
  assert.equal(isNewerTle(L1_OLD, ''), false);
});

test('isNewerTle: empty/invalid current is replaceable by a valid fetch', () => {
  assert.equal(isNewerTle('', L1_NEW), true);
  assert.equal(isNewerTle('garbage', L1_NEW), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tle-seed.test.mjs`
Expected: FAIL — `Cannot find module '../lib/pass-finder/tle-seed.js'`.

- [ ] **Step 3: Write the implementation**

```javascript
// lib/pass-finder/tle-seed.js — pure helpers for server-seeding the
// pass-finder TLE and guarding the client refresh by epoch. No I/O, no
// React. Reuses the existing parseTleEpoch.

import { parseTleEpoch } from "./tle.js";

// Map an Edge Config TLE record { noradId, name, line1, line2, ... } to
// the store's Tle shape { name, line1, line2 }. Returns null for a
// missing or structurally-invalid record so the seed path degrades to
// "no seed" rather than seeding garbage.
export function recordToTle(record) {
  if (!record) return null;
  const { name, line1, line2 } = record;
  if (typeof line1 !== "string" || typeof line2 !== "string") return null;
  if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) return null;
  return { name: typeof name === "string" ? name : "", line1, line2 };
}

// True iff fetchedLine1's epoch is strictly newer than currentLine1's.
// A non-finite fetched epoch never wins (don't apply junk). A non-finite
// current epoch (empty/invalid store TLE) is always replaceable by a
// valid fetch.
export function isNewerTle(currentLine1, fetchedLine1) {
  const fetchedEpoch = parseTleEpoch(fetchedLine1);
  if (!Number.isFinite(fetchedEpoch)) return false;
  const currentEpoch = parseTleEpoch(currentLine1);
  if (!Number.isFinite(currentEpoch)) return true;
  return fetchedEpoch > currentEpoch;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tle-seed.test.mjs`
Expected: PASS — 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/pass-finder/tle-seed.js test/tle-seed.test.mjs
git commit -m "feat(passes): pure TLE seed mapping + epoch guard"
```

---

## Task 2: Seed the store in `PassFinderApp`

**Files:**
- Modify: `components/PassFinderApp.tsx`

Done before the `app/page.tsx` change so the prop is declared (optional) before anything passes it — each task typechecks independently.

- [ ] **Step 1: Add the `Tle` type import**

At the top of `components/PassFinderApp.tsx`, alongside the existing imports, add:

```typescript
import type { Tle } from "@/lib/types";
```

(The file already imports `useEffect, useRef` from `react` and `usePassFinderStore` from `@/lib/pass-finder-store` — reuse those.)

- [ ] **Step 2: Accept the prop and seed the store on mount**

Change the component signature from:

```typescript
export default function PassFinderApp() {
  const containerRef = useRef<HTMLDivElement>(null);
```

to:

```typescript
export default function PassFinderApp({ initialTle }: { initialTle?: Tle | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const seededRef = useRef(false);

  // Server-seed the store once on mount so the scene (which subscribes to
  // the store) paints the ISS immediately, before the client TlePanel
  // fetch resolves. No-op when there's no seed (e.g. Edge Config unset).
  useEffect(() => {
    if (seededRef.current || !initialTle) return;
    seededRef.current = true;
    const store = usePassFinderStore.getState();
    store.setTle(initialTle);
    store.setTleStatus("ready");
  }, [initialTle]);
```

Leave the rest of the component (the `useCesiumViewer` hook, the store selectors, the scene-init `useEffect`, and all JSX) unchanged.

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both pass. `PassFinderApp` now accepts an optional `initialTle`; `app/page.tsx` not yet passing it is fine (the prop is optional). The home route `/` still builds.

- [ ] **Step 4: Commit**

```bash
git add components/PassFinderApp.tsx
git commit -m "feat(passes): seed store from initialTle prop on mount"
```

---

## Task 3: Server-read the seed in `app/page.tsx`

**Files:**
- Modify: `app/page.tsx`

The current file (for reference):

```typescript
import type { Metadata } from "next";
import PassFinderApp from "@/components/PassFinderApp";
import { ogImageMetadata } from "@/lib/og/og-metadata.mjs";
import "./pass-finder.css";

export async function generateMetadata(
  { searchParams }: { searchParams: Promise<{ s?: string }> },
): Promise<Metadata> {
  const { s } = await searchParams;
  return ogImageMetadata(s);
}

export default function HomePage() {
  return <PassFinderApp />;
}
```

- [ ] **Step 1: Replace the file with the seeded version**

```typescript
import type { Metadata } from "next";
import PassFinderApp from "@/components/PassFinderApp";
import { ogImageMetadata } from "@/lib/og/og-metadata.mjs";
import { createEdgeConfigStore } from "@/lib/mcp/tle-store.mjs";
import { recordToTle } from "@/lib/pass-finder/tle-seed.js";
import "./pass-finder.css";

export async function generateMetadata(
  { searchParams }: { searchParams: Promise<{ s?: string }> },
): Promise<Metadata> {
  const { s } = await searchParams;
  return ogImageMetadata(s);
}

// Read the cron-cached ISS TLE from Edge Config so the globe can render
// immediately. Any failure (Edge Config unset locally, read error,
// missing/malformed record) falls back to null — the page then behaves
// exactly as before and the client fetch fills the globe.
async function readInitialIssTle() {
  try {
    const map = await createEdgeConfigStore().readMap();
    return recordToTle(map["25544"]);
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const initialTle = await readInitialIssTle();
  return <PassFinderApp initialTle={initialTle} />;
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both pass. `recordToTle` comes from a `.js` module (typed `any`), which is assignable to the optional `initialTle: Tle | null` prop declared in Task 2.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(passes): server-read ISS TLE seed from edge config"
```

---

## Task 4: Guard the client fetch in `TlePanel`

**Files:**
- Modify: `components/passes/TlePanel.tsx`

The mount fetch stays (clock-sync depends on it). We add: a `userEditedRef` set on any textarea edit; an `isManual` param so the Refresh button bypasses guards; and the two-part guard (skip on user edit; otherwise apply only if `isNewerTle`). Plus a status nicety so a seeded panel doesn't show the empty "fetching…" message.

- [ ] **Step 1: Add the import and the user-edit ref**

Add to the imports at the top of `components/passes/TlePanel.tsx`:

```typescript
import { isNewerTle } from "@/lib/pass-finder/tle-seed.js";
```

Inside the component, alongside the existing `didFetchRef`/`lastFetchedRef`, add:

```typescript
  const userEditedRef = useRef(false);
```

- [ ] **Step 2: Replace `doFetch` with the guarded version**

Replace the existing `doFetch` (the `const doFetch = async () => { ... }` block) with:

```typescript
  // isManual=true (the Refresh button) bypasses the guards: an explicit
  // user refresh always applies the fetched TLE. The automatic mount
  // fetch (isManual=false) applies its result only when the user hasn't
  // manually edited AND the fetched epoch is strictly newer than what's
  // in the store (so it can't regress a newer server seed). The fetch
  // itself — and its clock-sync side effect inside fetchIssTle — always
  // runs regardless of whether the result is applied.
  const doFetch = async (isManual = false) => {
    setTleStatus("fetching");
    try {
      const t = await fetchIssTle();
      if (t) {
        const currentLine1 = usePassFinderStore.getState().tle.line1;
        const blockedByEdit = userEditedRef.current && !isManual;
        const apply = isManual || (!blockedByEdit && isNewerTle(currentLine1, t.line1));
        if (apply) {
          setTle({ name: t.name, line1: t.line1, line2: t.line2 });
          lastFetchedRef.current = new Date().toUTCString();
        }
        setTleStatus("ready");
      } else {
        setTleStatus("error");
      }
    } catch {
      setTleStatus("error");
    }
  };
```

(The mount `useEffect` calls `doFetch()` with no argument → `isManual` defaults to `false`. Leave that effect unchanged.)

- [ ] **Step 3: Mark manual edits and wire the Refresh button**

In each of the three textarea `onChange` handlers, set the edit ref. Change:

```typescript
        onChange={(e) => setTle({ name: e.target.value })}
```
to:
```typescript
        onChange={(e) => { userEditedRef.current = true; setTle({ name: e.target.value }); }}
```

and likewise for the `line1` and `line2` textareas (`setTle({ line1: ... })` and `setTle({ line2: ... })`).

Change the Refresh button so it passes `isManual=true`:

```typescript
      <button id="tle-refetch" type="button" onClick={() => doFetch(true)} title="Pull a fresh TLE for the ISS">
        Refresh
      </button>
```

- [ ] **Step 4: Add the seeded status nicety**

Replace the `statusText` computation:

```typescript
  const statusText =
    tleStatus === "fetching" ? "fetching latest TLE…"
    : tleStatus === "ready" ? `fetched ${lastFetchedRef.current ?? "recently"}`
    : tleStatus === "error" ? "fetch failed — paste a TLE below."
    : "";
```

with a version that, while fetching, distinguishes "we already have a valid TLE (seeded)" from "we have nothing yet":

```typescript
  const hasValidTle = tle.line1.startsWith("1 ") && tle.line2.startsWith("2 ");
  const statusText =
    tleStatus === "fetching" ? (hasValidTle ? "checking for newer…" : "fetching latest TLE…")
    : tleStatus === "ready" ? `fetched ${lastFetchedRef.current ?? "recently"}`
    : tleStatus === "error" ? "fetch failed — paste a TLE below."
    : "";
```

(Leave `statusClass` and the JSX unchanged.)

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add components/passes/TlePanel.tsx
git commit -m "feat(passes): epoch + user-edit guard on TLE refresh, seeded status"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green — the existing suite plus the new `test/tle-seed.test.mjs` (8 tests). Paste the totals line.

- [ ] **Step 2: Typecheck + build (final)**

Run: `npm run typecheck && npm run build`
Expected: both pass; `/` builds.

- [ ] **Step 3: Manual browser check (document results, no code)**

With Edge Config seeded (or via `EDGE_CONFIG` pointing at a dev store populated by hitting `/api/refresh-tle` once), run `npm run dev` and verify:
- The globe shows the ISS essentially immediately on load (no empty-globe wait), confirming the server seed rendered.
- The TLE panel shows the seeded element set, with a brief "checking for newer…" rather than the empty "fetching latest TLE…".
- Pasting a different TLE into the textareas and leaving it survives the in-flight/just-completed mount fetch (user edit not clobbered).
- Clicking Refresh applies a fresh fetch (bypasses the guard).
- The clock-skew banner still resolves (clock-sync intact).

Without Edge Config (default local dev): the page loads as before (brief empty globe, then the client fetch fills it) — confirming graceful degradation.

If any check fails, treat it as a bug to fix before finishing (re-open the relevant task).

- [ ] **Step 4: (no commit — verification task)**

---

## Self-review notes (for the implementer)

- `app/page.tsx` becoming `async` is fine in the App Router. The Edge Config read happens per request (the page is already dynamic via `searchParams`); Edge Config is designed for sub-ms read-on-every-request, and the try/catch guarantees a slow/failed read can't block render.
- No `Date.now()`/state ordering fragility: the scene and `TlePanel` both subscribe to the store, so whether the seed lands just before or just after scene init, the ISS appears on the next store notification.
- This plan deliberately makes no change to `lib/types.ts` or `lib/pass-finder-store.ts`; the epoch comparison reads `line1` directly via `parseTleEpoch`.
