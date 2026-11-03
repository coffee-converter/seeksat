# Drawer Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the deferred items from the focus-opens-drawer work:
- the list origin moves into browser history;
- the map loop does less work;
- the code tidy-ups.

**Architecture:** No new features. Each task is a self-contained refactor or fix with tests where logic is pure.

**Spec:** `docs/superpowers/specs/2026-11-03-focus-opens-drawer-design.md`. Behaviour must stay as that spec describes, except that Close now also goes back after Forward, which the spec already promises ("so Forward still works").

## Global Constraints

- **Network:** never call CelesTrak from Aaron's laptop. Browser checks run on a local `npx next start -p 3461` build.
- **Copy:** no em dashes in copy or comments.
- **Styles:** CSS tokens only.
- **Commits:** conventional commits, with no AI attribution lines.
- **Checks:** `npx tsc --noEmit && npm test && npm run build` are green after each task.
- **History state:** any `history.replaceState` or `pushState` keeps Next's own state by spreading the existing `history.state`, as `PUSHED_KEY` (HomeApp) and `useBackCloses` already do.

## Review Focus

1. Close after Back then Forward to a satellite page opened from the list goes back to the list. This is Task 1's browser check.
2. A direct load or reload of a satellite page never treats itself as opened from the list, so Close pushes `/` and never leaves the site. This is Task 1's browser check.
3. The map loop with Lock on still keeps the satellite centred, and the dots still move every 200 ms. This is Task 2's browser check.

---

### Task 1: The list origin lives in history state

**Files:** `lib/home/list-origin.mjs`, `components/sat/SatApp.tsx`, `components/home/HomeApp.tsx` (if needed), `test/list-origin.test.mjs`

**Behaviour:**
- **Marking the page.** When a satellite page mounts and the module flag from `markFromList()` is set, it writes `seeksatFromList: true` into its own history entry, `history.replaceState({ ...history.state, seeksatFromList: true }, "", location.href)`, then clears the module flag. The page's "from list" status is that history-state key. The module flag is only the hand-off from home to the next page.
- **Close.** Close is `back` when `history.state?.seeksatFromList` is true, else it pushes `/`.
- **Hops.** A hop (`router.replace` to another satellite) from an entry marked as from the list calls `markFromList()` first, so the new page marks its own entry.
- **Pure helper.** Add `closeTargetFor(state)` to `list-origin.mjs`: it returns `'back'` when `state?.seeksatFromList === true`, else `'home'`. Test it with `null`, `{}`, `{ seeksatFromList: true }` and `{ seeksatFromList: 'yes' }` (which gives `'home'`). Keep `markFromList`, `fromList` and `clearFromList`.
- **Browser check** at 1440:
  - on `/`, click Tiangong's chip, which opens `/sat/48274`;
  - press Back, then Forward, then Close: the URL is `/` and `history.length` is unchanged by the Close;
  - load `/sat/48274` directly, then Close: the URL is `/`;
  - reload `/sat/48274` after reaching it from the list, then Close: the URL is `/` (the entry keeps its state across a reload, so going back is correct here too; either is acceptable as long as it stays on the site, so report which).

### Task 2: Map loop efficiencies

**Files:** `components/home/FlatMap.tsx`

**Changes:**
- **Less data per tick.** Each tick sends only `ss-sats`, plus `ss-footprint` while a satellite is focused. `ss-observer` and an empty footprint are left out, the way `ss-night` already is.
- **One focus position per tick.** Compute the focused satellite's live sub-point once per tick and pass it to the footprint push, the follow jump and the satellite's-view zoom.
- **Keep dots that can't be placed.** `liveSats` keeps a satellite whose `positionAt` returns null at its 1 s `position`, instead of dropping it, so its track key never changes from a failed sample.
- **Drop an unused input.** Remove `selectedSub` from `latest` and from the props-effect dependencies if nothing reads it. Keep the prop on `FlatMapProps` only if a caller still passes it; otherwise remove it from callers too.
- **Skip the redundant redraw while following.** When the only camera move was the loop's own follow or satellite's-view `jumpTo`, skip the full `moveend` push, because the tick already pushed the dots. Use a ref flag set around the jump and checked in the `moveend` handler.
- **Zoom keeps Lock on (Aaron's request).** While Lock on is on, zooming does not release it: wheel, pinch, double-click and the +/- buttons all zoom around the screen centre, which is the locked satellite, whatever the pointer position (MapLibre's `scrollZoom.enable({ around: 'center' })` and `touchZoomRotate.enable({ around: 'center' })`, restored to pointer-anchored zoom when Lock on is off). Only a pan releases the lock: drag (MapLibre `dragstart`) or keyboard panning (arrow keys). Zoom keys (+/-) do not release it. Replace the current rule, under which any movestart with an `originalEvent` turns it off. Browser check: with Lock on, wheel-zoom with the pointer near a corner; the satellite stays centred and Lock on stays pressed; then drag; Lock on turns off.
- **No needless camera maths in Satellite's view.** `syncGestures` computes `homeView(map)` only when not in satview.
- **Browser check:**
  - on `/sat/25544` at zoom 6 on the globe, the ISS dot moves within 400 ms;
  - with Lock on, it stays within 6 px of the centre over 3 s;
  - in Satellite's view the dot stays centred;
  - there are no page errors.

### Task 3: Tidy-ups

**Files:** as listed per item.

**Changes:**
- **Shared clock:** a `useTrueNow(intervalMs = 1000)` hook in `lib/ui/use-true-now.ts`. It is null until mount, aligned to whole seconds, paused while `document.hidden`, and uses `trueNow` from `@/lib/pass-finder/clock-sync.js`. Use it in `components/map/SiteHeader.tsx`, and in HomeApp and SatApp where their clocks match that behaviour. Where a page's clock differs (for example SatApp starting from `data.renderedAtMs`), keep that difference by passing an option, or leave that page's clock alone and say so.
- **Stable search handlers:** SiteHeader stops re-rendering on every scene publish. It reads `scene.search` through `useMapScene.getState()` at call time inside stable handlers, instead of subscribing to it.
- **One focus destination helper:** `focusDestinationFor(id)` in HomeApp and SatApp becomes one helper. Put a store-reading wrapper in `lib/home/focus-nav.ts`, or pass `prefs.custom` explicitly. Pasted-satellite links use `focusHref("/", "", id)` instead of a hand-built string.
- **Dead branches:** remove the unreachable `satPageLayers` branches in `lib/home/focus.mjs` (`focusId == null`, and focus on another satellite), and their tests. Keep the page-focused behaviour and its tests.
- **Next pass time from its source:** `pass-rows.mjs` exports `nextPassWhen(pass, nowMs)`, which returns the short "when" words ("in 27 min", "up now") that `nextPassText` already builds, with a unit test. `NextPassLine.tsx` stops regex-parsing prose and uses it.
- **Accuracy link:** the elements' age line (`AgeLine` in `components/sat/ElementsTable.tsx`) gains a small "How accurate is this?" link to `#how-accuracy`. The other `how-*` ids stay, harmlessly.
- **Close tap target:** `.focus-bar__close` and the title bar's Close get a minimum 40 px tap target.
- **Double-tap guard:** on home, `focusOn` ignores a second navigation to the same destination within 600 ms.
- **Stale comments and tests:**
  - `lib/map/view.mjs`: the header comment says three views, `DEG` is declared before its first use, and the night preset joins the `presetCamera` ternary;
  - the duplicate `PROJECTIONS` test in `test/map-view.test.mjs` goes;
  - `public/sw.js`: the comment no longer cites `/sat/N?focus=`;
  - `components/sat/SatApp.tsx`: the return block is indented consistently.
- **Scroll padding on resize:** `scroll-padding-top` is re-applied to the right scroller when the window crosses 1100 px while the title bar shows.
- **Browser check:**
  - the satellite page shows the accuracy link, which jumps to the row;
  - the focus bar Close is at least 40 px wide;
  - the header clock ticks;
  - search from the header still works on both pages;
  - a fast double click on a home chip adds one history entry.

### Task 4: Per-frame motion for the focused satellite and Lock on

Added at Aaron's request: the focused satellite and Lock on look jumpy, especially at high zoom.

**Files:** `components/home/FlatMap.tsx`, plus a small new layer module if needed (for example `lib/map/focus-dot-layer.mjs`, following how `lib/map/footprint-layer.mjs` builds the globe cap custom layer).

**Causes:**
1. The 200 ms steps are too coarse at high zoom.
2. The camera `jumpTo` is synchronous, but the GeoJSON `setData` that moves the dots is asynchronous (the worker re-tiles), so with Lock on the dot and the camera land on different frames and the dot twitches.

**Behaviour:**
- **The frame loop.** A `requestAnimationFrame` loop runs while a satellite is focused, the tab is visible and the map is mounted. It stops otherwise, and on unmount. Each frame:
  - `t = trueNow()` and the focused position is `positionAt(t)`;
  - with Lock on, or in Satellite's view, the camera `jumpTo`s that sub-point (satview also sets its zoom) in the same frame;
  - the focused satellite's dot and name label are drawn by a layer the map renders synchronously in that frame: a custom WebGL layer, or MapLibre `Marker` DOM elements if they stay correct on the globe (hidden on the far side) and in vertical-perspective. Check both and choose; report the choice and why.
- **No doubles.** The focused satellite is removed from the GeoJSON `ss-sats` data, so it is never drawn twice. Its hit-testing for taps keeps working, either through the new layer or by keeping an invisible GeoJSON point.
- **Other satellites.** They stay on the 200 ms GeoJSON updates.
- **The focus cap and footprint** move with the frame loop only if that stays cheap (the globe cap custom layer can take a new centre per frame). Otherwise they stay on 200 ms.
- **No per-frame React state.** Frame work runs only while needed.
- **Browser checks:**
  - at zoom 12 on the ISS with Lock on, sample the dot's screen position over 2 s from screenshots or the layer's projected point: it stays within 1 px of the centre;
  - without Lock on, consecutive frames move the dot by small, even steps;
  - a far-side satellite on the globe is not drawn through the Earth;
  - there are no page errors, and the HomeApp render count is still about one per second.
