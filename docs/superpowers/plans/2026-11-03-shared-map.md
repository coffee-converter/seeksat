# Shared Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One MapLibre map, header and shell stay mounted across `/`, `/sat/<id>` and `/sat/<id>/share/<blob>`, so only the drawer and the map's contents change on navigation.

**Architecture:**
- A route group `app/(map)/` gets a layout that renders `MapShell` once, holding the shared header, one persistent `FlatMap`, and `children` as the panel.
- Each page (HomeApp, SatApp) stops rendering a shell. Instead it publishes a *map scene* each render to a small zustand store: the FlatMap props, the content above the map, the search handlers, a notice and an extra shell class. The layout's map host reads that scene.
- URLs do not change: route groups do not appear in paths.

**Tech Stack:** Next.js App Router (route groups, nested layouts, `usePathname`), React 19, zustand, MapLibre (unchanged), node:test, Playwright for browser checks.

**Spec:** `docs/superpowers/specs/2026-11-03-shared-map-design.md`

## Global Constraints

- **Network:** never call CelesTrak from Aaron's laptop. Browser checks run against `npx next start -p 3461` on a local build, which reads the snapshot mirror only.
- **Copy:** no em dashes in new copy or comments.
- **Hydration:** no hydration mismatch. The scene store starts `null` on the server and the client, and the header clock starts `null` (dashes) until mount.
- **URLs:** every URL, `?focus=`, `?map=all` and the share paths stay the same.
- **Styles:** CSS uses theme tokens only (`test/theme-css.test.mjs`). No new colour literals.
- **Commits:** conventional prefixes, no AI attribution lines (Aaron's CLAUDE.md).
- **Tests and checks:** `npm test` and `npx tsc --noEmit` stay green after every task. `npm run build` must pass before the browser checks.

## Review Focus

1. **Moving between two satellite pages** (`/sat/A` to `/sat/B` through search, or Open page from the focus bar). SatApp must remount with B's data and focus B, not keep A's `focusId` state. Covered by Task 4's browser check 4.
2. **Back from a satellite page to `/?focus=X`** must restore home's focus, chips and Next up, with no camera jump, because X stays selected. Covered by Task 4 check 2.
3. **A direct load of `/sat/X`** (no home visit first) shows the map with X focused, and the server HTML still has the satellite `<h1>` and OG metadata. Covered by Task 4 check 1.
4. **A stale scene between pages.** For one commit the map shows the previous page's scene. A tap in that moment must not throw. The previous page's handlers only call store setters or `router.push`, which are safe after unmount. Task 3's scene hook never clears the scene on unmount, so the map never flashes empty.
5. **Drawer scroll.** On desktop (1100 px and up) the panel scrolls on its own. After navigating it must start at the top, not at the old page's offset. Covered by Task 4 check 5.

---

### Task 1: Route helpers and the scene store

**Files:**
- Create: `lib/map/shell-route.mjs`
- Create: `lib/map/scene-store.ts`
- Test: `test/map-shell-route.test.mjs`

**Interfaces:**
- Produces:
  - `isHomePath(pathname: string): boolean`: true for `/` only.
  - `shellClassFor(pathname: string, extra?: string | null): string | undefined`. It returns `"sat"` for paths starting `/sat/`, then appends `extra` with a space. It returns `undefined` when both are empty.
  - `MapScene`, an interface in `scene-store.ts`, with these fields:
    - **FlatMap props (named as in FlatMap's `Props`):** `sats`, `observer`, `selectedSub`, `projectionId`, `onProjectionChange`, `selectedId`, `minElevDeg`, `onSelect`, `top`, `chips`.
    - **`above?: ReactNode`:** content above the map inside `.map-shell__map`.
    - **`search: { onView(noradId: number): void; onClearFocus(): void }`.**
    - **`notice?: ReactNode`.**
    - **`offlineFromCache?: boolean`.**
    - **`shellClass?: string`:** for example `"home-first-visit"`.
  - `useMapScene`, a zustand store `{ scene: MapScene | null; setScene(s: MapScene): void }`.
  - `usePublishMapScene(scene: MapScene): void`. It calls `setScene(scene)` in a `useEffect` that runs on every render, and never clears the scene on unmount.
- Change `components/home/FlatMap.tsx`: export its `Props` as `FlatMapProps`, so `MapScene` can `Pick` from it.

- [ ] **Step 1: Write the failing test** (`test/map-shell-route.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHomePath, shellClassFor } from '../lib/map/shell-route.mjs';

test('isHomePath is the home page only', () => {
  assert.equal(isHomePath('/'), true);
  assert.equal(isHomePath('/sat/25544'), false);
  assert.equal(isHomePath('/sat/25544/share/abc'), false);
});

test('shellClassFor marks satellite pages and adds the page class', () => {
  assert.equal(shellClassFor('/'), undefined);
  assert.equal(shellClassFor('/', 'home-first-visit'), 'home-first-visit');
  assert.equal(shellClassFor('/sat/25544'), 'sat');
  assert.equal(shellClassFor('/sat/25544/share/abc', null), 'sat');
  assert.equal(shellClassFor('/sat/1', 'x'), 'sat x');
});
```

- [ ] **Step 2: Run it.** Run `node --test test/map-shell-route.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `lib/map/shell-route.mjs`, then `lib/map/scene-store.ts` and the `FlatMapProps` export. The store is `create<...>()` from zustand, as in `lib/home/store.ts`.
- [ ] **Step 4: Run** `node --test test/map-shell-route.test.mjs && npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit.** `feat: Add the map scene store and shell route helpers`

### Task 2: The shared header and the map layout shell (not wired yet)

**Files:**
- Create: `components/map/SiteHeader.tsx`
- Create: `components/map/MapLayoutShell.tsx`
- Modify: `test/csp.test.mjs` (add `components/map/MapLayoutShell.tsx` to `ROOTS`)

**Interfaces:**
- Consumes (Task 1): `useMapScene`, `isHomePath` and `shellClassFor`.
- Produces:
  - `SiteHeader()` renders the same markup HomeApp's and SatApp's `top` render today:
    - the wordmark: `<h1 className="home-wordmark">SeekSat</h1>` when `isHomePath(usePathname())`, else `<Link className="home-wordmark" href="/">SeekSat</Link>`;
    - then `div.map-shell__search` with `<SearchBar>` wired to `scene?.search`. With no scene yet, both handlers do nothing;
    - then `div.map-shell__end` with `<LiveClock nowMs={nowMs} compact />`, `<ThemeToggle />` and `<NightToggle />`.
    - Its `nowMs` is its own: `null` until mount, then `trueNow()` from `@/lib/pass-finder/clock-sync.js` every 1000 ms. The interval stops while `document.hidden`, as HomeApp's clock does.
  - `MapLayoutShell({ children })` renders `<MapShell>` with these props:
    - `className={shellClassFor(pathname, scene?.shellClass)}`;
    - `top={<SiteHeader />}`;
    - `notice={scene?.notice}` and `offlineFromCache={scene?.offlineFromCache ?? false}`;
    - `map={<>{scene?.above}<FlatMap fill … /></>}`. With no scene, pass `sats={[]}`, `observer={null}`, `selectedId={null}`, `minElevDeg={0}`, `projectionId` from `useHomeStore` prefs, no-op handlers, and `top`/`chips` null;
    - `panel={children}`.
    - It imports `@/app/home.css` and `@/app/sat.css` (moved from SatApp and HomeApp in Tasks 3 and 4).
  - **Scroll reset:** on every `pathname` change, `document.querySelector('.map-shell__panel')?.scrollTo(0, 0)` runs in an effect, skipping the first run.

- [ ] **Step 1: Write both components.** These are presentational wiring with no pure logic beyond Task 1, so there is no new unit test. They are proven by Task 3's and Task 4's browser checks.
- [ ] **Step 2: Run** `npx tsc --noEmit && npm test`. Expected: clean, all pass. The CSP test now walks the new root.
- [ ] **Step 3: Commit.** `feat: Add the shared site header and map layout shell`

### Task 3: Home moves under the shared layout

**Files:**
- Create: `app/(map)/layout.tsx`. This server component renders `<MapLayoutShell>{children}</MapLayoutShell>` and nothing else.
- Move: `app/page.tsx` to `app/(map)/page.tsx` (`git mv`; contents unchanged).
- Modify: `components/home/HomeApp.tsx`

**Interfaces:**
- Consumes: `usePublishMapScene` and `MapScene` (Task 1); `MapLayoutShell` (Task 2).
- HomeApp changes:
  - **Panel:** it returns only what is its `panel` today, plus `<Suspense fallback={null}><FocusParam /></Suspense>` moved into that tree.
  - **Scene:** it calls `usePublishMapScene` with:
    - `above`: the `LocationPrompt` and `NextStrip` it renders in `map` today, in the same order and under the same conditions;
    - every FlatMap prop it passes today, with `top` as the FocusBar and `chips` as SatChips;
    - `search: { onView: focusOn, onClearFocus: () => focusOn(null) }`;
    - `notice`, `offlineFromCache` and `shellClass`: `hydrated && !location ? "home-first-visit" : undefined`.
  - **Removed:** `MapShell`, `SearchBar`, `LiveClock`, `ThemeToggle`, `NightToggle` and the wordmark go from HomeApp. Its own `nowMs` stays, because the cards use it.

- [ ] **Step 1: Make the changes** above. Before moving the route, check that `app/page.tsx` has no relative imports (it uses `@/` aliases, so a move is safe).
- [ ] **Step 2: Run** `npx tsc --noEmit && npm test && npm run build`. Expected: clean, all pass. The build lists `/` as before (ISR 15 min).
- [ ] **Step 3: Browser check** (Playwright from `/Users/aaron/work/qrz-swapmeet-watch/node_modules/playwright`, channel `chrome`, server `npx next start -p 3461`):
  1. **Home at 1440 and 390:** the header, map, chips, Next strip and cards show. There is no horizontal overflow, and no `pageerror` or hydration warning in the console.
  2. **Focus round trip:** `/?focus=25544` focuses ISS; tapping its chip again clears it; Back restores it, as before.
  3. **Charts:** opening a sky chart and pressing Back closes it.
- [ ] **Step 4: Commit.** `refactor: Render the home page inside the shared map layout`

### Task 4: Satellite pages move under the shared layout

**Files:**
- Move: `app/sat/` to `app/(map)/sat/` (`git mv`, with `page.tsx`, `not-found.tsx` and `share/[blob]/page.tsx`).
- Modify: `components/sat/SatApp.tsx`
- Modify: `app/(map)/sat/[id]/not-found.tsx`. Its root `<main className="home">` becomes `<section className="home">`, because it now renders inside the shell's `<main>` panel.

**Interfaces:**
- Consumes: Tasks 1 to 3.
- SatApp changes:
  - **Panel:** it returns only its panel content.
  - **Scene:** it publishes a scene with:
    - the FlatMap props it passes today (with `top` as FocusBar and `chips` as SatChips after Show all);
    - `search: { onView: (id) => router.push(satPath(id)), onClearFocus: showAll }`;
    - no `above`, no `notice` and no `shellClass` (the layout adds `sat` from the path).
  - **Removed:** `MapShell`, the header elements and the `home.css`/`sat.css` imports go from SatApp, since the layout imports them.
  - **Kept:** the `?map=all` sync, `leaveShared`, chips and `useBackCloses` (inside `PassChartModals`) stay as they are.
- `app/(map)/sat/[id]/page.tsx` and the share page render `<SatApp key={data.noradId} …>`, so moving from one satellite's page to another always starts SatApp fresh (focus, chips, `?map=all` read), whatever the router reuses.

- [ ] **Step 1: Make the changes** above.
- [ ] **Step 2: Run** `npx tsc --noEmit && npm test && npm run build`. Expected: clean, all pass. The build lists `/sat/[id]` and `/sat/[id]/share/[blob]` as before.
- [ ] **Step 3: Server render check.** `curl -s localhost:3461/sat/25544` contains `<h1` with `ISS`, `og:image` and the canonical link. `curl -s -o /dev/null -w '%{http_code}' localhost:3461/sat/999999999` prints `404`.
- [ ] **Step 4: Browser check** (setup as Task 3):
  1. **Direct load:** `/sat/57166` shows the map with that satellite focused and the focus bar showing its name. There are no console errors.
  2. **The map persists:** on `/` at 1440, set `data-probe="1"` on `.maplibregl-canvas` and record `map.getCenter()` from the canvas container's map. Click a card's Details link, then press Back.
     - The canvas still has `data-probe="1"` on `/sat/<id>` and after Back (same element, so the map was never rebuilt).
     - The centre is unchanged when the opened satellite was already focused.
  3. **Show all:** `?map=all` on a satellite page shows the chips and survives a reload, as before.
  4. **Satellite to satellite:** on `/sat/25544`, search "Tiangong" and pick it. The URL is `/sat/48274`, the drawer title is Tiangong, the focus bar names Tiangong, and `data-probe` is still on the canvas.
  5. **Drawer scroll:** at 1440, scroll the panel of `/sat/25544` down by 800 px, then click "Your satellites". The panel's `scrollTop` is 0 on `/`.
  6. **Not found:** `/sat/999999999` shows "Satellite not found" in the drawer with the map beside it.
- [ ] **Step 5: Commit.** `refactor: Render satellite pages inside the shared map layout, so the map persists`
