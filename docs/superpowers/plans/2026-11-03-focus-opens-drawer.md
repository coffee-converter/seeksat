# Focus Opens the Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Focusing a satellite opens its page in the drawer, and Close goes back to the list.
- On the map, the dots move smoothly, Follow keeps the camera on the satellite, and there are a Satellite's view and a Night side preset.

**Architecture:**
- **Navigation.** Navigation lives in the page publishers:
  - HomeApp's `focusOn` pushes `/sat/<id>`.
  - SatApp's map tap pushes the other satellite's page, and Close goes back or to `/`.
  - A tiny module flag remembers whether this satellite page was opened from the list.
- **Motion.** Motion lives in FlatMap (the shared, persistent map):
  - each `MapSat` carries `positionAt(ms)`;
  - a 200 ms loop moves the dots, the focused circle and a followed or satellite's-view camera;
  - `following` moves out of FlatMap's ref into a small store, so the page's focus bar can show and toggle it.

**Tech Stack:** Next.js App Router, React 19, zustand, MapLibre GL 6.15 (projections `mercator`, `globe`, `vertical-perspective`), node:test, Playwright for browser checks.

**Spec:** `docs/superpowers/specs/2026-11-03-focus-opens-drawer-design.md` (built on `2026-11-03-shared-map-design.md`)

## Global Constraints

- **Network:** never call CelesTrak from Aaron's laptop. Browser checks run against a local `npx next start -p 3461` build, which reads only the snapshot mirror.
- **Copy:** no em dashes in new copy or comments. New copy, verbatim:
  - the buttons are `Follow` and `Following` (the pressed state), `Details` and `Close`, with the accessible name `Close details`;
  - the view menu entry is `Satellite's view`;
  - the preset is `Night side`.
- **Styles:** CSS uses theme tokens only (`test/theme-css.test.mjs`).
- **History:** one history entry per satellite opened, and none for a Close that goes back.
- **Pasted satellites** (`track.record?.source === "pasted"`, or ids in `prefs.custom`) never navigate. They keep home focus.
- **Commits:** conventional prefixes, no AI attribution lines.
- **Checks:** `npm test` and `npx tsc --noEmit` stay green after every task, and `npm run build` passes before every browser check.

## Review Focus

1. **A `/?focus=<id>` link loaded before prefs hydrate.** The redirect must wait for `hydrated`, so a pasted satellite's link stays on home instead of opening a 404 page. This is pinned by Task 5's browser check 3.
2. **Close after a direct load or a shared link** goes to `/` and never leaves the site by going back in history. This is pinned by Task 5 check 4.
3. **The fast loop and React.** The 200 ms loop must not re-render React (no setState per tick), must stop while `document.hidden`, and must stop on unmount. This is pinned by Task 2's test of the pure pieces and by browser check 2's render count.
4. **Satellite's view on very high orbits** (SMILE at about 120,000 km, GEO). The zoom is clamped to the map's minimum zoom, and the view must not throw. This is pinned by Task 1's `zoomForAltitude` tests and Task 3 check 2.
5. **Follow and user gestures.** A drag, a wheel or a pinch turns Follow off. The map's own `jumpTo` calls (which carry no `originalEvent`) must not. This is pinned by Task 2 check 3.

---

### Task 1: Pure helpers

**Files:**
- Modify: `lib/map/view.mjs`
- Modify: `lib/map/basemap.mjs`
- Create: `lib/home/list-origin.mjs`
- Modify: `lib/home/focus.mjs`
- Test: `test/map-view.test.mjs`, `test/map-basemap.test.mjs`, `test/home-focus.test.mjs` (add to the existing file; check its name with `ls test | grep focus`), and new `test/list-origin.test.mjs`

**Interfaces (Produces):**
- **`PROJECTIONS` and `migrateProjection`.** `PROJECTIONS` becomes `[{ id: 'globe', label: 'Globe' }, { id: 'flat', label: 'Mercator' }, { id: 'satview', label: "Satellite's view" }]`. `migrateProjection('satview')` returns `'satview'`.
- **`effectiveView(projection, hasFocus)`** returns `'flat' | 'globe' | 'satview'`. `'satview'` becomes `'globe'` without a focused satellite.
- **`zoomForAltitude(altKm, heightPx, fovDeg = 36.87)`** returns a number: the MapLibre zoom whose camera, looking straight down, sits `altKm` above the ground. The formula is `log2((heightPx / 2 / tan(fov / 2)) * 40075016.686 / (altKm * 1000 * 512))`. It is not clamped here; FlatMap clamps it with `limitZoom`.
- **`presetCamera('night', { date, width, height })`** centres on the antisolar point, `[subsolar.lonDeg + 180 (wrapped), -subsolar.latDeg]`, using `subsolarPoint(date)` from `lib/map/geometry.mjs`, at the same whole-Earth zoom as the other presets.
- **`basemapStyle(theme, 'satview')`** sets `projection: { type: 'vertical-perspective' }`.
- **`lib/home/list-origin.mjs`** holds module state:
  - `markFromList()`;
  - `fromList(): boolean`;
  - `clearFromList()`;
  - `closeTarget(fromListFlag: boolean): 'back' | 'home'`, which is `'back'` only when the flag is set.
- **`focusDestination(id, pastedIds)`** in `focus.mjs` returns `string | null`: `satPath(id)`-style `/sat/<id>`, or `null` for a pasted id. `pastedIds` is an iterable of numbers.

- [ ] **Step 1: Write the failing tests.**

```js
// test/map-view.test.mjs (additions)
test('Satellite\'s view is the third view, and falls back to the globe without a focus', () => {
  assert.deepEqual(PROJECTIONS.map((p) => p.id), ['globe', 'flat', 'satview']);
  assert.equal(PROJECTIONS[2].label, "Satellite's view");
  assert.equal(migrateProjection('satview'), 'satview');
  assert.equal(effectiveView('satview', true), 'satview');
  assert.equal(effectiveView('satview', false), 'globe');
  assert.equal(effectiveView('flat', true), 'flat');
});
test('zoomForAltitude puts the camera at the satellite\'s height', () => {
  const z = zoomForAltitude(420, 900);
  // 900 px tall, 36.87 degree field: 1350 px to centre; 1350 * C / (420e3 * 512) = 251.6
  assert.ok(Math.abs(z - Math.log2(1350 * 40075016.686 / (420e3 * 512))) < 1e-9);
  assert.ok(zoomForAltitude(35786, 900) < zoomForAltitude(420, 900));
  assert.ok(Number.isFinite(zoomForAltitude(120000, 900)));
});
test('the Night side preset centres opposite the Sun', () => {
  const date = new Date('2026-06-21T12:00:00Z');
  const cam = presetCamera('night', { date, width: 1000, height: 800 });
  // subsolar is about (0.46 E, 23.44 N) then: antisolar about (-179.5, -23.44)
  assert.ok(Math.abs(cam.center[1] + 23.44) < 0.2);
  assert.ok(Math.abs(Math.abs(cam.center[0]) - 179.5) < 0.6);
  assert.equal(cam.zoom, presetCamera('north', { width: 1000, height: 800 }).zoom);
});

// test/map-basemap.test.mjs (addition)
test('Satellite\'s view uses the vertical-perspective projection', () => {
  assert.deepEqual(basemapStyle('dark', 'satview').projection, { type: 'vertical-perspective' });
});

// test/list-origin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markFromList, fromList, clearFromList, closeTarget } from '../lib/home/list-origin.mjs';
test('Close goes back only when the page was opened from the list', () => {
  clearFromList();
  assert.equal(fromList(), false);
  assert.equal(closeTarget(fromList()), 'home');
  markFromList();
  assert.equal(closeTarget(fromList()), 'back');
  clearFromList();
  assert.equal(fromList(), false);
});

// focus test file (addition)
test('focusDestination opens catalog satellites and keeps pasted ones home', () => {
  assert.equal(focusDestination(25544, []), '/sat/25544');
  assert.equal(focusDestination(90001, [90001]), null);
  assert.equal(focusDestination(90001, new Set([90001])), null);
});
```

- [ ] **Step 2: Run them.** Run `node --test test/map-view.test.mjs test/map-basemap.test.mjs test/list-origin.test.mjs <focus test file>`. Expected: FAIL (missing exports). The old `PROJECTIONS` deepEqual test in map-view must be updated to the three-entry list.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run** the same tests, then `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat: Add the helpers for Satellite's view, Night side and focus navigation`

### Task 2: Smooth dots and Follow, on the map side

**Files:**
- Create: `lib/map/follow-store.ts`, a zustand store `{ following: boolean; setFollowing(on: boolean): void }`.
- Modify: `components/home/useMapSats.ts`. Each `MapSat` gets `positionAt(ms: number): { lonDeg: number; latDeg: number; altKm: number } | null`, built from the track's `ecefAt` and `subpoint`.
- Modify: `components/home/FlatMap.tsx`
- Test: `test/map-overlays.test.mjs` (if a pure dot-only data builder is added) or none. The behaviour is proven in the browser.

**Interfaces:**
- Produces: `useFollow` (the follow store) and `MapSat.positionAt`.
- FlatMap changes:
  - **The loop.** A `DOT_MS = 200` interval runs while the map is loaded and `!document.hidden`, and stops on unmount. Each tick it:
    - rebuilds only the dot sources (`tracks: false`) with each sat's `position` replaced by `positionAt(trueNow())`;
    - pushes the focused footprint from the focused sat's new sub-point (`footprintFeature`, with the `minElevDeg` prop);
    - when `following` (or the effective view is satview), `jumpTo`s the camera centre to the focused sub-point. In satview it also sets `zoom: limitZoom(zoomForAltitude(altKm, canvasHeight))`.

    No React state is set per tick.
  - **Follow moves to the store.** FlatMap's `following` ref becomes the store's `following`. Every place that sets it today (the "On the satellite" preset, the movestart user-gesture handler, the selectedId change, the view change) calls `setFollowing` instead. The 1 s props-driven recentre stays for the non-loop path.

- [ ] **Step 1: Implement** the follow store and `positionAt`, then the FlatMap loop and the move of Follow into the store.
- [ ] **Step 2: Run** `npx tsc --noEmit && npm test && npm run build`. Expected: clean.
- [ ] **Step 3: Browser check** (Playwright from `/Users/aaron/work/qrz-swapmeet-watch/node_modules/playwright`, channel `chrome`, server on 3461):
  1. **Smooth dots:** on `/` with ISS followed, read the ISS dot's screen position from the `ss-sats` source through two `.maplibregl-canvas` screenshots 400 ms apart at zoom 6 on ISS ("On the satellite" on the globe). They differ, so the dot moved inside one second.
  2. **No per-tick renders:** count React renders of HomeApp with a temporary `console.count` you remove before commit. Over 3 s it renders about 3 times (the 1 s clock), not about 15.
  3. **Follow:** click "On the satellite" on the globe and wait 3 s. The ISS dot stays at the canvas centre (within 6 px). Then drag the map 200 px and wait 1 s. The dot is no longer centred, and `useFollow` is false (read through a temporary `window.__follow` you remove before commit, or through Task 4's button when it exists).
- [ ] **Step 4: Commit.** `feat: Move map dots five times a second and keep Follow in a shared store`

### Task 3: Satellite's view and Night side in the map

**Files:**
- Modify: `components/home/FlatMap.tsx`

**Interfaces:**
- Consumes (Task 1): `PROJECTIONS`, `effectiveView`, `zoomForAltitude`, `presetCamera('night', …)` and `basemapStyle(theme, 'satview')`. Consumes (Task 2): the loop.
- FlatMap changes:
  - **Choosing the view.** FlatMap derives its view as `effectiveView(projectionId, selectedId != null && a focused sat exists)`. A view change restyles as today, with `basemapStyle(theme, view)`.
  - **In satview:** drag pan, rotate and pitch are disabled (`syncGestures`), and the globe preset bar is hidden.
  - **Leaving satview:** gestures return, and the camera stays where it is.
  - **Night side:** `PRESETS` gains `{ id: "night", label: "Night side" }` after "South pole". It calls `presetCamera('night', { date: new Date(trueNow()), width, height })`.
  - The view `<select>` lists the three `PROJECTIONS` in order.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npx tsc --noEmit && npm test && npm run build`. Expected: clean.
- [ ] **Step 3: Browser check:**
  1. **ISS:** on `/sat/25544` choose "Satellite's view". The projection is vertical-perspective (`map.getProjection().type` through a temporary hook, or visually: a disc filling the frame around ISS). The ISS dot stays centred over 3 s. With min elevation 0, the footprint circle sits at the visible edge of the Earth (screenshot).
  2. **SMILE:** on `/sat/69123` (SMILE, about 120,000 km), choose "Satellite's view". There are no page errors, and nearly a hemisphere is visible.
  3. **Night side:** on the globe on `/`, click "Night side". The centre is on the night side (the screenshot shows the darkest shading centred).
  4. **Reload:** reload `/` with no focus while "Satellite's view" is saved. It shows the globe, and the select still reads "Satellite's view".
- [ ] **Step 4: Commit.** `feat: Add Satellite's view and a Night side preset to the map`

### Task 4: The focus bar: Follow, Close, Details

**Files:**
- Modify: `components/home/FocusBar.tsx`, `lib/home/focus.mjs` (`focusBarText`), `app/home.css`
- Test: the focus test file (`focusBarText` copy)

**Interfaces:**
- New `FocusBar` props:

  ```ts
  {
    name: string;
    followed: boolean;
    blocked: string | null;
    onToggleFollow(): void;
    mode: "page" | "home";
    onClose(): void;
    total?: number;
    onShowAll?(): void;
  }
  ```

  - `mode: "page"`, on a satellite page: buttons are ☆/★ Follow(ing) the satellite (the existing follow-the-satellite toggle), then the camera `Follow` toggle, then `Details` (only under 1100 px), then a `Close` button (×, `aria-label="Close details"`).
  - `mode: "home"`, for a pasted satellite on home: as today, with Show all (`total`, `onShowAll`) and no Close.
- **Naming clash.** The existing "☆ Follow" means following the satellite (the chips list), so the camera toggle needs a distinct label. The camera toggle's copy is `Lock on` / `Locked on` (`aria-pressed`). Ruling recorded here: the spec's "Follow" toggle is labelled "Lock on" in the UI, because "Follow" already names the star button. The cost if wrong is one label change.
- The camera toggle reads and sets `useFollow` from Task 2.
- `Details` calls `document.querySelector('.sat-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' })`. Use `block: 'start'` without `smooth` under `prefers-reduced-motion`.
- `Open page` and `pageHref` are removed.
- `focusBarText(name, isFollowed, total)` keeps its fields and gains `lock: { off: 'Lock on', on: 'Locked on' }`.

- [ ] **Step 1: Write the failing test** for `focusBarText(...).lock`, run it (FAIL), implement it, and run it again (PASS).
- [ ] **Step 2: Implement** FocusBar and its CSS. The Close button is a `home-chip` with an × glyph, and the camera toggle is a `home-chip`, with `home-chip--on` when pressed. Update the two callers (HomeApp and SatApp) to the new props, still with today's behaviour. SatApp passes `mode: "page"`, with `onClose` doing its current Show all for now (Task 5 changes it).
- [ ] **Step 3: Run** `npx tsc --noEmit && npm test && npm run build`. Expected: clean. Then the browser check: at 390 px on `/sat/25544` the focus bar shows Lock on, Details and Close, with no overflow, and Details scrolls the drawer title into view. At 1440 px there is no Details.
- [ ] **Step 4: Commit.** `feat: Give the focus bar Lock on, Details and Close`

### Task 5: Focus opens the drawer

**Files:**
- Modify: `components/home/HomeApp.tsx`, `components/sat/SatApp.tsx`, `components/home/NextUpList.tsx` (only if its headline focus needs the new handler)
- Delete: `lib/sat/map-param.mjs` and `test/sat-map-param.test.mjs`. Before deleting, keep a one-line `?map=` strip in SatApp, or keep `mapAllHref` if it is simpler; the rule is only that `?map=all` is dropped from the URL.

**Interfaces:**
- Consumes: `focusDestination`, `markFromList`, `fromList`, `clearFromList`, `closeTarget` (Task 1), and FocusBar `mode` and `onClose` (Task 4).
- **HomeApp:**
  - `focusOn(id)` covers the map, chips, search, the Next strip and card headlines:
    - with `id != null` and `focusDestination(id, prefs.custom.map(c => c.noradId))` not null, it calls `markFromList()` then `router.push(dest)`;
    - otherwise it keeps today's home-focus behaviour, which is used for pasted satellites and for clearing.
  - FocusParam: once `hydrated`, if `?focus=<id>` resolves to a destination, it calls `router.replace(dest)` (no history entry). Otherwise it syncs the focus as today.
- **SatApp:**
  - The map is always focused on the page's satellite. Followed others are ghosts, which is `satPageLayers` with `focusId = data.noradId`. `loadRecords()` runs on mount, so the ghosts and chips can draw.
  - The chips always show.
  - A map tap or chip on another catalog satellite calls `router.replace(dest)`. It does not change the flag, so the list stays one step back and Close (back) returns to it.
  - A tap on a pasted satellite pushes `/?focus=<id>`.
  - `onClose` does `closeTarget(fromList()) === 'back' ? router.back() : router.push('/')`, then `clearFromList()`. Esc (outside inputs) calls `onClose`.
  - `?map=all` is stripped on mount with `history.replaceState`. The `othersShown` state and Show all on satellite pages are removed.
- `clearFromList()` also runs when HomeApp mounts, so the flag never survives a return to the list.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npx tsc --noEmit && npm test && npm run build`. Expected: clean.
- [ ] **Step 3: Browser check** (1440, then the key ones at 390):
  1. **Opening from home:** on `/` (ISS, Tiangong and Meteor-M2 3 followed), click Tiangong's chip. The URL is `/sat/48274`, the drawer title is Tiangong, `history.length` grew by 1, and the `.maplibregl-canvas` probe survives. Close returns to `/` with `history.length` unchanged from before the click, and Forward returns to `/sat/48274`.
  2. **Search:** on `/`, search "Meteor" and pick Meteor-M2 3. The URL is `/sat/57166`.
  3. **Old focus links:** load `/?focus=25544` directly. The URL is replaced with `/sat/25544` (Back leaves the site, with no extra entry). Add a pasted satellite (paste elements from `test/fixtures` ISS lines under a custom id, or skip and say so). Its `/?focus=<id>` stays on home with the focus bar.
  4. **Close on a direct load:** load `/sat/25544` directly and click Close. The URL is `/`.
  5. **Hopping between satellites:** on `/sat/25544` reached from the list, click Tiangong's chip. The URL is `/sat/48274` (replace). Close returns to `/`.
  6. **Old map=all links:** `/sat/25544?map=all` loads as `/sat/25544`.
  7. **Esc** on a satellite page goes to the list.
- [ ] **Step 4: Commit.** `feat: Open a satellite's page when it is focused, and close back to the list`

### Task 6: A sticky title bar in the satellite drawer

Added at Aaron's request: the satellite drawer is long, and getting back to the top to go back is tedious.

**Files:** `components/sat/SatApp.tsx` (the `.sat-top` block), `app/sat.css`

**Behaviour:**
- **The bar.** Once the drawer's title block scrolls out of view, a slim bar sticks to the top of the drawer. It holds:
  - the Close control from Task 5 (×, `aria-label="Close details"`), with the same behaviour;
  - the satellite's name, one line with an ellipsis;
  - the next pass in short form (the Next pass line's time words, for example "in 27 min"), if any.

  The bar is hidden while the full title block is on screen: an `IntersectionObserver` on `.sat-top` toggles a class, and the bar never duplicates the title in view.
- **Desktop** (1100 px and up): it sticks to the top of the scrolling panel, `.map-shell__panel`.
- **Phones:** the window scrolls. The bar sticks under the pinned search row of the header, so its `top` equals the sticky header's visible height (use the existing header height, or a CSS custom property set by MapShell if one exists; check before adding one).
- **Print:** hidden.
- **Styles:** theme tokens only, and no layout shift when it appears (it is positioned over the content, or reserves no space).

- [ ] **Step 1: Implement.** Run `npx tsc --noEmit && npm test && npm run build`.
- [ ] **Step 2: Browser check** at 1440 and 390 on `/sat/48274`:
  - the bar is absent at the top;
  - after scrolling the drawer 800 px, the bar is visible at the drawer's top and shows "Tiangong";
  - its Close does what Task 5's Close does;
  - there is no horizontal overflow.
- [ ] **Step 3: Commit.** `feat: Keep a slim title bar at the top of the satellite drawer`
