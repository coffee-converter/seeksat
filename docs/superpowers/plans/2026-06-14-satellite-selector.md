# Satellite Selector + Catalog Tiering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pass-finder's raw TLE textarea panel with a catalog-driven satellite selector (default ISS, 5 satellites, built to scale), backed by a shared `lib/catalog.mjs` with a dormant free/premium tier field.

**Architecture:** `lib/catalog.mjs` becomes the single source of truth (UI + MCP + cron). The page server-seeds every catalog satellite's TLE from Edge Config into a store map; a new `SatellitePanel`/`SatelliteSelector` lets the user switch satellites instantly, firing a per-satellite client refresh that also drives clock-sync. The Cesium scene is untouched — it keeps reacting to the store's `tle`.

**Tech Stack:** Next.js 15 App Router, React 19, Zustand, `node:test` for pure modules (no React test harness — components verified via typecheck + `next build` + manual).

**Spec:** `docs/superpowers/specs/2026-06-14-satellite-selector-design.md`

---

## File Structure

- **Create** `lib/catalog.mjs` — moved from `lib/mcp/catalog.mjs`, enriched schema + 5 sats. Single source of truth.
- **Create** `lib/pass-finder/satellite-seed.js` — pure helpers: `recordsToSatelliteTles`, `selectionUpdate`.
- **Create** `components/passes/SatelliteSelector.tsx` — custom dropdown (current sat + tier badge; popover list).
- **Create** `components/passes/SatellitePanel.tsx` — selector + selected-sat readout + per-selection refresh.
- **Delete** `lib/mcp/catalog.mjs`, `components/passes/TlePanel.tsx`.
- **Modify** `lib/mcp/refresh.mjs`, `lib/mcp/tle-fetch.mjs`, `lib/mcp/tools.mjs`, `app/api/refresh-tle/route.ts`, `scripts/seed-local-tle.mjs` — repoint catalog import.
- **Modify** `lib/pass-finder/tle.js` — `fetchTle(noradId)` + `tleSourcesFor(noradId)`.
- **Modify** `lib/pass-finder-store.ts` — `selectedNoradId`, `satelliteTles`, `setSelectedSatellite`.
- **Modify** `app/page.tsx` — seed whole catalog → `initialSatelliteTles`.
- **Modify** `components/PassFinderApp.tsx` — accept `initialSatelliteTles`, mount `SatellitePanel`.
- **Modify** `app/pass-finder.css` — selector/panel styles.
- **Tests** `test/catalog.test.mjs` (replaces `test/mcp-catalog.test.mjs`), `test/satellite-seed.test.mjs`, `test/tle-sources.test.mjs`.

---

## Task 1: Move + enrich the catalog

**Files:**
- Create: `lib/catalog.mjs`
- Delete: `lib/mcp/catalog.mjs`
- Test: `test/catalog.test.mjs` (replaces `test/mcp-catalog.test.mjs`)

- [ ] **Step 1: Write the failing test**

Create `test/catalog.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, resolveSatellite } from '../lib/catalog.mjs';

test('catalog has the 5 starter satellites', () => {
  assert.equal(CATALOG.length, 5);
  const ids = CATALOG.map(s => s.noradId).sort((a, b) => a - b);
  assert.deepEqual(ids, [20580, 25544, 33591, 48274, 53807]);
});

test('every entry has the enriched, valid shape', () => {
  for (const s of CATALOG) {
    assert.equal(typeof s.noradId, 'number');
    assert.equal(typeof s.name, 'string');
    assert.ok(Array.isArray(s.aliases));
    assert.ok(['free', 'premium'].includes(s.tier), `${s.name} tier`);
    assert.equal(typeof s.inclinationDeg, 'number');
    assert.ok(s.viewingHint === null || typeof s.viewingHint === 'string');
    assert.ok(['visual', 'radio'].includes(s.defaultMode), `${s.name} mode`);
  }
});

test('all starter satellites are free for now', () => {
  assert.ok(CATALOG.every(s => s.tier === 'free'));
});

test('NOAA-19 defaults to radio; ISS to visual', () => {
  assert.equal(resolveSatellite(33591).defaultMode, 'radio');
  assert.equal(resolveSatellite('iss').defaultMode, 'visual');
});

test('resolveSatellite handles new aliases and ids', () => {
  assert.equal(resolveSatellite('bluewalker').noradId, 53807);
  assert.equal(resolveSatellite('noaa-19').noradId, 33591);
  assert.equal(resolveSatellite(20580).name, 'Hubble Space Telescope');
  assert.equal(resolveSatellite('nope'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/catalog.test.mjs`
Expected: FAIL — cannot find module `../lib/catalog.mjs`.

- [ ] **Step 3: Create `lib/catalog.mjs`**

```js
// lib/catalog.mjs — curated, trackable satellites. Single source of
// truth shared by the webapp selector, the MCP tools, and the cron
// seeder. Pure data; safe to import into client components.
//
// Adding "track any NORAD id" later means relaxing resolveSatellite to
// synthesize an entry for an unknown numeric id.

export const CATALOG = [
  {
    noradId: 25544, name: 'ISS (ZARYA)', aliases: ['iss', 'zarya', 'space station'],
    tier: 'free', inclinationDeg: 51.6, viewingHint: null, defaultMode: 'visual',
  },
  {
    noradId: 48274, name: 'Tiangong (CSS)', aliases: ['tiangong', 'css', 'chinese space station'],
    tier: 'free', inclinationDeg: 41.5, viewingHint: null, defaultMode: 'visual',
  },
  {
    noradId: 53807, name: 'BlueWalker 3', aliases: ['bluewalker', 'bluewalker 3', 'bw3'],
    tier: 'free', inclinationDeg: 53.0,
    viewingHint: 'One of the brightest satellites — easy naked-eye target.',
    defaultMode: 'visual',
  },
  {
    noradId: 20580, name: 'Hubble Space Telescope', aliases: ['hubble', 'hst'],
    tier: 'free', inclinationDeg: 28.5,
    viewingHint: 'Low inclination — best seen from lower latitudes.',
    defaultMode: 'visual',
  },
  {
    noradId: 33591, name: 'NOAA-19', aliases: ['noaa', 'noaa-19', 'noaa19'],
    tier: 'free', inclinationDeg: 99.0,
    viewingHint: 'Polar weather satellite — too dim to see; use radio passes.',
    defaultMode: 'radio',
  },
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

Run: `node --test test/catalog.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Delete the old catalog + its old test**

```bash
git rm lib/mcp/catalog.mjs test/mcp-catalog.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add lib/catalog.mjs test/catalog.test.mjs
git commit -m "feat(catalog): move to lib/catalog.mjs, enrich schema, add BlueWalker 3 + NOAA-19"
```

> **Expected interim breakage:** the MCP modules (`lib/mcp/*.mjs`, the route, the seed script, `test/mcp-*.test.mjs`) still import the deleted `./catalog.mjs`, so the **full** suite (`npm test`) is RED until Task 2 repoints them. Only `test/catalog.test.mjs` is green here. Do Tasks 1 and 2 back-to-back.

---

## Task 2: Repoint every catalog importer

**Files:**
- Modify: `lib/mcp/refresh.mjs`, `lib/mcp/tle-fetch.mjs`, `lib/mcp/tools.mjs`, `app/api/refresh-tle/route.ts`, `scripts/seed-local-tle.mjs`

The old path was `./catalog.mjs` (inside `lib/mcp/`) or `@/lib/mcp/catalog.mjs` (route). New home is `lib/catalog.mjs`.

- [ ] **Step 1: Update the three `lib/mcp/*.mjs` importers**

In `lib/mcp/refresh.mjs`, `lib/mcp/tle-fetch.mjs`, `lib/mcp/tools.mjs`, change:
`from './catalog.mjs'` → `from '../catalog.mjs'`

- [ ] **Step 2: Update the route importer**

In `app/api/refresh-tle/route.ts`, change:
`from '@/lib/mcp/catalog.mjs'` → `from '@/lib/catalog.mjs'`

- [ ] **Step 3: Update the seed script**

In `scripts/seed-local-tle.mjs`, change its catalog import path to `../lib/catalog.mjs` (verify the relative depth — the file is in `scripts/`, so `../lib/catalog.mjs`).

- [ ] **Step 4: Update tests that import via the old path**

Run: `grep -rln "mcp/catalog" test/`
For each hit (`test/mcp-refresh.test.mjs`, `test/mcp-tools.test.mjs`, and any other), change the import to `../lib/catalog.mjs`.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — no "cannot find module .../catalog.mjs" failures.

- [ ] **Step 6: Typecheck (route import resolves)**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(catalog): repoint all importers to lib/catalog.mjs"
```

---

## Task 3: Generalize `fetchIssTle` → `fetchTle(noradId)`

**Files:**
- Modify: `lib/pass-finder/tle.js`
- Test: `test/tle-sources.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/tle-sources.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tleSourcesFor } from '../lib/pass-finder/tle.js';

test('builds per-source URLs for the ISS', () => {
  const urls = tleSourcesFor(25544).map(s => s.url);
  assert.ok(urls.some(u => u === 'https://api.wheretheiss.at/v1/satellites/25544/tles'));
  assert.ok(urls.some(u => u === 'https://tle.ivanstanojevic.me/api/tle/25544'));
  assert.ok(urls.some(u => u.includes('CATNR=25544')));
});

test('parameterizes by NORAD id for other satellites', () => {
  const urls = tleSourcesFor(33591).map(s => s.url);
  assert.ok(urls.every(u => u.includes('33591')));
  assert.ok(!urls.some(u => u.includes('25544')));
});

test('each source exposes a name and parse fn', () => {
  for (const s of tleSourcesFor(20580)) {
    assert.equal(typeof s.name, 'string');
    assert.equal(typeof s.parse, 'function');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tle-sources.test.mjs`
Expected: FAIL — `tleSourcesFor` is not exported.

- [ ] **Step 3: Refactor `tle.js` to a per-id source builder**

In `lib/pass-finder/tle.js`, replace the module-level `const SOURCES = [...]` array with an exported function that takes a NORAD id and returns the same source objects, parameterized:

```js
export function tleSourcesFor(noradId) {
  const id = String(noradId);
  return [
    {
      name: "wheretheiss",
      url: `https://api.wheretheiss.at/v1/satellites/${id}/tles`,
      parse: async (resp) => {
        const j = await resp.json();
        if (!j.line1 || !j.line2) throw new Error("malformed JSON shape");
        return { name: j.header || j.name || "", line1: j.line1, line2: j.line2 };
      },
    },
    {
      name: "ivanstanojevic",
      url: `https://tle.ivanstanojevic.me/api/tle/${id}`,
      parse: async (resp) => {
        const j = await resp.json();
        if (!j.line1 || !j.line2) throw new Error("malformed JSON shape");
        return { name: j.name || "", line1: j.line1, line2: j.line2 };
      },
    },
    {
      name: "celestrak",
      url: `https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`,
      parse: async (resp) => {
        const text = await resp.text();
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length < 3) throw new Error("unexpected TLE shape");
        return { name: lines[0], line1: lines[1], line2: lines[2] };
      },
    },
  ];
}
```

- [ ] **Step 4: Replace `fetchIssTle` with `fetchTle(noradId)`**

Update the loop in `tle.js` to iterate `tleSourcesFor(noradId)`, and rename the public function. Keep `fetchOne` as-is (it still calls `syncFromResponse(resp)` — clock-sync now follows whatever id is fetched):

```js
export async function fetchTle(noradId) {
  for (const src of tleSourcesFor(noradId)) {
    try {
      return await fetchOne(src);
    } catch (e) {
      console.warn(`TLE source failed: ${e?.message ?? e}`);
    }
  }
  return null;
}
```

- [ ] **Step 5: Run tests + grep for stale callers**

Run: `node --test test/tle-sources.test.mjs` → Expected: PASS.
Run: `grep -rln "fetchIssTle" --include=*.ts --include=*.tsx --include=*.js components app lib`
Expected: only `components/passes/TlePanel.tsx` (deleted in Task 8). If anything else appears, note it for that task. Do NOT keep a `fetchIssTle` alias — callers are updated in later tasks.

- [ ] **Step 6: Commit**

```bash
git add lib/pass-finder/tle.js test/tle-sources.test.mjs
git commit -m "feat(tle): fetchTle(noradId) — generalize the ISS-only fetch"
```

---

## Task 4: Pure seed + selection helpers

**Files:**
- Create: `lib/pass-finder/satellite-seed.js`
- Test: `test/satellite-seed.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/satellite-seed.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../lib/catalog.mjs';
import { recordsToSatelliteTles, selectionUpdate } from '../lib/pass-finder/satellite-seed.js';

const ISS_REC = { noradId: 25544, name: 'ISS (ZARYA)', line1: '1 25544U ...', line2: '2 25544 ...' };

test('recordsToSatelliteTles maps present records, skips missing/invalid', () => {
  const map = { '25544': ISS_REC, '20580': { line1: 'bad', line2: 'bad' } };
  const out = recordsToSatelliteTles(CATALOG, map);
  assert.deepEqual(out[25544], { name: 'ISS (ZARYA)', line1: '1 25544U ...', line2: '2 25544 ...' });
  assert.equal(out[20580], undefined);   // structurally invalid → skipped
  assert.equal(out[53807], undefined);   // absent → skipped
});

test('selectionUpdate pushes the seeded TLE and the default mode', () => {
  const tiles = { 25544: { name: 'ISS (ZARYA)', line1: '1 25544U ...', line2: '2 25544 ...' } };
  const u = selectionUpdate(CATALOG, tiles, 25544);
  assert.equal(u.selectedNoradId, 25544);
  assert.deepEqual(u.tle, tiles[25544]);
  assert.equal(u.mode, 'visual');
});

test('selectionUpdate applies radio mode for NOAA-19', () => {
  const u = selectionUpdate(CATALOG, {}, 33591);
  assert.equal(u.selectedNoradId, 33591);
  assert.equal(u.mode, 'radio');
  assert.equal(u.tle, undefined);   // no seeded TLE → no tle in the patch
});

test('selectionUpdate ignores an unknown id', () => {
  assert.equal(selectionUpdate(CATALOG, {}, 99999), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/satellite-seed.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `satellite-seed.js`**

```js
// lib/pass-finder/satellite-seed.js — pure helpers for seeding the
// per-satellite TLE map from Edge Config records and computing the
// store patch when the user selects a satellite. No I/O, no React.

import { recordToTle } from './tle-seed.js';
import { resolveSatellite } from '../catalog.mjs';

// Build { [noradId]: Tle } from an Edge Config record map, including
// only catalog satellites with a structurally-valid record.
export function recordsToSatelliteTles(catalog, recordMap) {
  const out = {};
  for (const sat of catalog) {
    const tle = recordToTle(recordMap?.[String(sat.noradId)]);
    if (tle) out[sat.noradId] = tle;
  }
  return out;
}

// Compute the store patch for selecting `noradId`: always the new
// selection + the satellite's default pass mode; the seeded TLE too
// when one is cached. Returns null for an unknown id.
export function selectionUpdate(catalog, satelliteTles, noradId) {
  const entry = resolveSatellite(noradId);
  if (!entry) return null;
  const patch = { selectedNoradId: entry.noradId, mode: entry.defaultMode };
  const tle = satelliteTles?.[entry.noradId];
  if (tle) patch.tle = tle;
  return patch;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/satellite-seed.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pass-finder/satellite-seed.js test/satellite-seed.test.mjs
git commit -m "feat(passes): pure seed + selection helpers for the satellite map"
```

---

## Task 5: Store — selection state

**Files:**
- Modify: `lib/pass-finder-store.ts`

- [ ] **Step 1: Add imports + state fields**

At the top of `lib/pass-finder-store.ts`, add:

```ts
import { CATALOG } from "./catalog.mjs";
import { selectionUpdate } from "./pass-finder/satellite-seed.js";
```

In `interface PassFinderState`, after the `tle` / `tleStatus` fields, add:

```ts
  /** NORAD id of the currently selected satellite (default ISS). */
  selectedNoradId: number;
  /** Cached TLEs keyed by NORAD id — server-seeded, refreshed on select. */
  satelliteTles: Record<number, Tle>;
```

In the Actions block, add:

```ts
  setSatelliteTles: (tles: Record<number, Tle>) => void;
  setSelectedSatellite: (noradId: number) => void;
```

- [ ] **Step 2: Add initial values + action implementations**

In the `create(...)` initializer object, add initial values:

```ts
  selectedNoradId: 25544,
  satelliteTles: {},
```

and the actions (note `setSelectedSatellite` reuses the pure `selectionUpdate`, so the store has no branching logic of its own):

```ts
  setSatelliteTles: (satelliteTles) => set({ satelliteTles }),
  setSelectedSatellite: (noradId) =>
    set((s) => {
      const patch = selectionUpdate(CATALOG, s.satelliteTles, noradId);
      return patch ?? {};
    }),
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. (The `.mjs` imports resolve the same way `tle-store.mjs` does in `app/page.tsx`.)

- [ ] **Step 4: Commit**

```bash
git add lib/pass-finder-store.ts
git commit -m "feat(store): selectedNoradId + satelliteTles + setSelectedSatellite"
```

---

## Task 6: Server-seed the whole catalog (`app/page.tsx`)

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace the ISS-only read with a whole-catalog read**

Replace the `readInitialIssTle` helper and its import block. New imports:

```ts
import { createEdgeConfigStore } from "@/lib/mcp/tle-store.mjs";
import { recordsToSatelliteTles } from "@/lib/pass-finder/satellite-seed.js";
import { CATALOG } from "@/lib/catalog.mjs";
import type { Tle } from "@/lib/types";
```

New helper (replaces `readInitialIssTle`):

```ts
// Read the cron-cached TLEs for the whole catalog from Edge Config so
// the globe can paint the default satellite immediately and switch to
// any other without waiting on a client fetch. Any failure (Edge Config
// unset locally, read error) falls back to {} — the page then behaves
// as before and the client fetch fills each satellite on selection.
async function readInitialSatelliteTles(): Promise<Record<number, Tle>> {
  try {
    const map = await createEdgeConfigStore().readMap() as Record<string, unknown>;
    return recordsToSatelliteTles(CATALOG, map);
  } catch {
    return {};
  }
}
```

- [ ] **Step 2: Pass the map to `PassFinderApp`**

```ts
export default async function HomePage() {
  const initialSatelliteTles = await readInitialSatelliteTles();
  return <PassFinderApp initialSatelliteTles={initialSatelliteTles} />;
}
```

- [ ] **Step 3: Typecheck (will fail on the prop until Task 7)**

Run: `npm run typecheck`
Expected: FAIL — `PassFinderApp` still expects `initialTle`. That's fixed in Task 7. (Do not commit yet; Tasks 6–8 land together.)

---

## Task 7: `PassFinderApp` — seed the map, mount the new panel

**Files:**
- Modify: `components/PassFinderApp.tsx`

- [ ] **Step 1: Swap the prop + seeding effect**

Change the signature and the seed effect. Replace `initialTle` with `initialSatelliteTles`, and replace the seeding `useEffect`:

```tsx
import type { Tle } from "@/lib/types";
// ...
export default function PassFinderApp(
  { initialSatelliteTles }: { initialSatelliteTles?: Record<number, Tle> },
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const seededRef = useRef(false);

  // Server-seed the per-satellite TLE map once on mount, then select the
  // default satellite (ISS) so the scene paints immediately. No-op when
  // the map is empty (e.g. Edge Config unset) — selection still sets the
  // default id and the client fetch fills the TLE in.
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const store = usePassFinderStore.getState();
    if (initialSatelliteTles && Object.keys(initialSatelliteTles).length) {
      store.setSatelliteTles(initialSatelliteTles);
    }
    store.setSelectedSatellite(25544);
    if (initialSatelliteTles?.[25544]) store.setTleStatus("ready");
  }, [initialSatelliteTles]);
```

- [ ] **Step 2: Swap the panel import + mount**

Change the import:
`import TlePanel from "@/components/passes/TlePanel";`
→ `import SatellitePanel from "@/components/passes/SatellitePanel";`

In the JSX, change the TLE `<details>` block's heading + body:

```tsx
        <details id="satellite-details" open>
          <summary><h2>Satellite</h2></summary>
          <SatellitePanel />
        </details>
```

(Removes the `id="tle-details"` block and its `<TlePanel />`.)

- [ ] **Step 3: Typecheck still fails until SatellitePanel exists**

Run: `npm run typecheck`
Expected: FAIL — cannot find `SatellitePanel`. Fixed in Task 8.

---

## Task 8: `SatelliteSelector` + `SatellitePanel`, delete `TlePanel`

**Files:**
- Create: `components/passes/SatelliteSelector.tsx`
- Create: `components/passes/SatellitePanel.tsx`
- Delete: `components/passes/TlePanel.tsx`

- [ ] **Step 1: Create `SatelliteSelector.tsx`**

```tsx
"use client";

import { useState } from "react";
import { CATALOG } from "@/lib/catalog.mjs";
import { usePassFinderStore } from "@/lib/pass-finder-store";

// Custom dropdown over the satellite catalog. Trigger shows the current
// satellite + a tier badge; the popover lists every catalog entry.
// Premium entries render disabled with a lock (dormant — none are
// premium yet). Built so a filter <input> can be added when the catalog
// grows; not added now (YAGNI).
export default function SatelliteSelector() {
  const selectedNoradId = usePassFinderStore((s) => s.selectedNoradId);
  const setSelectedSatellite = usePassFinderStore((s) => s.setSelectedSatellite);
  const [open, setOpen] = useState(false);

  const current = CATALOG.find((s) => s.noradId === selectedNoradId) ?? CATALOG[0];

  return (
    <div className="sat-selector">
      <button
        type="button"
        className="sat-selector-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sat-name">{current.name}</span>
        {current.tier === "premium" && <span className="sat-badge pro">PRO</span>}
        <span className="sat-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="sat-selector-list" role="listbox">
          {CATALOG.map((s) => {
            const locked = s.tier === "premium";
            return (
              <li key={s.noradId} role="option" aria-selected={s.noradId === selectedNoradId}>
                <button
                  type="button"
                  className={`sat-option${s.noradId === selectedNoradId ? " active" : ""}${locked ? " locked" : ""}`}
                  disabled={locked}
                  title={locked ? "Premium satellite — upgrade to track" : undefined}
                  onClick={() => { setSelectedSatellite(s.noradId); setOpen(false); }}
                >
                  <span className="sat-name">{s.name}</span>
                  <span className="sat-incl">{s.inclinationDeg}°</span>
                  {locked && <span className="sat-badge pro">PRO</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `SatellitePanel.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { CATALOG } from "@/lib/catalog.mjs";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import { fetchTle } from "@/lib/pass-finder/tle.js";
import { isNewerTle } from "@/lib/pass-finder/tle-seed.js";
import { parseTleEpoch } from "@/lib/pass-finder/tle.js";
import SatelliteSelector from "@/components/passes/SatelliteSelector";

// Format a TLE epoch (from line1) as a relative age string.
function ageText(line1: string): string {
  const epoch = parseTleEpoch(line1);
  if (!Number.isFinite(epoch)) return "unknown";
  const hours = (Date.now() - epoch) / 3_600_000;
  if (hours < 1) return "updated <1h ago";
  if (hours < 48) return `updated ${Math.round(hours)}h ago`;
  return `updated ${Math.round(hours / 24)}d ago`;
}

// Satellite section: selector + a live readout for the selected
// satellite, and a per-selection client refresh that also drives
// clock-sync (via fetchTle → syncFromResponse). Replaces the old raw
// TLE textarea panel.
export default function SatellitePanel() {
  const selectedNoradId = usePassFinderStore((s) => s.selectedNoradId);
  const tle = usePassFinderStore((s) => s.tle);
  const tleStatus = usePassFinderStore((s) => s.tleStatus);

  const entry = CATALOG.find((s) => s.noradId === selectedNoradId) ?? CATALOG[0];
  const sourceRef = useRef<string | null>(null);

  // On every selection change: fetch the freshest elements for that
  // satellite. Apply only if strictly newer than the cached/seeded TLE
  // (epoch guard) so a stale or failed fetch never regresses the seed.
  // The fetch always runs — its clock-sync side effect is the point.
  useEffect(() => {
    let cancelled = false;
    const store = usePassFinderStore.getState();
    store.setTleStatus("fetching");
    fetchTle(selectedNoradId)
      .then((t) => {
        if (cancelled) return;
        if (!t) { store.setTleStatus("error"); return; }
        const currentLine1 = usePassFinderStore.getState().satelliteTles[selectedNoradId]?.line1 ?? "";
        if (isNewerTle(currentLine1, t.line1)) {
          const next = { name: t.name || entry.name, line1: t.line1, line2: t.line2 };
          store.setTle(next);
          store.setSatelliteTles({ ...store.satelliteTles, [selectedNoradId]: next });
        }
        sourceRef.current = t.source ?? null;
        store.setTleStatus("ready");
      })
      .catch(() => { if (!cancelled) store.setTleStatus("error"); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNoradId]);

  const hasTle = tle.line1.startsWith("1 ") && tle.line2.startsWith("2 ");
  const statusText =
    tleStatus === "fetching" ? (hasTle ? "checking for newer…" : "fetching TLE…")
    : tleStatus === "error" ? "fetch failed — using cached element set."
    : "";

  return (
    <div className="satellite-panel">
      <SatelliteSelector />
      <dl className="sat-readout">
        <div><dt>NORAD</dt><dd>{entry.noradId}</dd></div>
        <div><dt>Inclination</dt><dd>{entry.inclinationDeg}°</dd></div>
        <div><dt>Elements</dt><dd>{hasTle ? ageText(tle.line1) : "—"}{sourceRef.current ? ` · ${sourceRef.current}` : ""}</dd></div>
      </dl>
      {entry.viewingHint && <p className="sat-hint">{entry.viewingHint}</p>}
      {statusText && <p className={`hint${tleStatus === "error" ? " error" : ""}`}>{statusText}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Delete `TlePanel`**

```bash
git rm components/passes/TlePanel.tsx
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean — `PassFinderApp` (Task 7), `page.tsx` (Task 6), and the new components all resolve.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: compiles; `/` route builds without error.

- [ ] **Step 6: Commit Tasks 6–8 together**

```bash
git add app/page.tsx components/PassFinderApp.tsx components/passes/SatellitePanel.tsx components/passes/SatelliteSelector.tsx
git commit -m "feat(passes): satellite selector panel replaces raw TLE input"
```

---

## Task 9: Selector styling

**Files:**
- Modify: `app/pass-finder.css`

- [ ] **Step 1: Add styles**

Append to `app/pass-finder.css` (match the existing panel's dark-glass idiom; reuse `.hint` / `.hint.error` already defined for status text):

```css
/* Satellite selector + readout (replaces the TLE textareas) */
.sat-selector { position: relative; }
.sat-selector-trigger {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 10px; cursor: pointer;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px; color: inherit; font: inherit; text-align: left;
}
.sat-selector-trigger .sat-name { flex: 1; }
.sat-caret { opacity: 0.6; }
.sat-selector-list {
  position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; right: 0;
  margin: 0; padding: 4px; list-style: none; max-height: 280px; overflow-y: auto;
  background: #0c1322; border: 1px solid rgba(255,255,255,0.14); border-radius: 6px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.5);
}
.sat-option {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 7px 9px; cursor: pointer; border: 0; border-radius: 4px;
  background: transparent; color: inherit; font: inherit; text-align: left;
}
.sat-option:hover:not(:disabled) { background: rgba(255,255,255,0.07); }
.sat-option.active { background: rgba(90,140,255,0.18); }
.sat-option.locked { opacity: 0.5; cursor: not-allowed; }
.sat-option .sat-name { flex: 1; }
.sat-option .sat-incl { opacity: 0.6; font-variant-numeric: tabular-nums; }
.sat-badge.pro {
  font-size: 10px; letter-spacing: 0.08em; padding: 1px 5px; border-radius: 3px;
  background: linear-gradient(90deg,#caa24a,#e9c45f); color: #1a1205; font-weight: 700;
}
.sat-readout { margin: 10px 0 0; display: grid; gap: 4px; }
.sat-readout div { display: flex; justify-content: space-between; gap: 12px; }
.sat-readout dt { opacity: 0.6; }
.sat-readout dd { margin: 0; font-variant-numeric: tabular-nums; }
.sat-hint { margin: 8px 0 0; font-size: 12px; opacity: 0.7; line-height: 1.4; }
```

- [ ] **Step 2: Build to confirm CSS parses + no unused-import errors**

Run: `npm run build`
Expected: compiles clean.

- [ ] **Step 3: Commit**

```bash
git add app/pass-finder.css
git commit -m "style(passes): satellite selector + readout styling"
```

---

## Task 10: Full verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all PASS, including the new `catalog`, `tle-sources`, `satellite-seed` tests and the existing MCP tests (repointed imports).

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm run dev`, open `/`. Verify:
- Globe paints the ISS immediately (server seed).
- The left panel's **Satellite** section shows the selector defaulting to **ISS (ZARYA)**, with NORAD/inclination/elements readout.
- Opening the selector lists all 5 satellites with inclination labels; none show a PRO lock (all free).
- Selecting **Tiangong** / **BlueWalker 3** / **Hubble** repaints the globe with that satellite; readout updates; Hubble shows its low-latitude hint.
- Selecting **NOAA-19** flips the mode toggle to **Radio** and shows the radio/dim hint.
- No raw TLE textareas remain anywhere.

- [ ] **Step 4: Final commit (if any manual fixups were needed)**

```bash
git add -A
git commit -m "chore(passes): satellite selector verification fixups"
```

---

## Notes for the implementer

- **No React test harness** — do not scaffold one. Components are verified by typecheck + build + the manual smoke in Task 10. All TDD steps target pure `.mjs`/`.js` modules.
- **`.mjs` into `.ts`/`.tsx`** imports already work in this repo (see `app/page.tsx` importing `tle-store.mjs`, and `lib/og/og-metadata.mjs`). The catalog has no `.d.ts`; consumers infer/`any` its shape, which is acceptable for this data module.
- **Clock-sync** is preserved purely because `fetchOne` still calls `syncFromResponse(resp)` and `SatellitePanel` fetches on every selection (default ISS on load). Do not remove that call.
- **Tasks 6–8 are intentionally one commit** — `page.tsx`, `PassFinderApp`, and the new components have circular prop/type dependencies and won't typecheck independently. Implement them together; the per-task typecheck "Expected: FAIL" notes flag this.
