# UI Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn SeekSat's home screen into header + map + one compact pass list, with location, settings and map layers behind a pill, a ⋯ sheet and a layers button, and make extra observers unmissable on the satellite page.

**Architecture:** New pure helpers in `lib/` (recent places, pass-list grouping, "both see" copy) carry the logic and the unit tests. New React parts (`PassList`, `LocationSheet`, `SettingsSheet`, `MapLayers`) replace `HomeControls`, `NextUpList`, `UpNow`, `NextStrip` and `SatChips` on home only; the satellite page keeps `HomeControls` and its chips. Sheets are the existing `Modal` with a new `sheet` size.

**Tech Stack:** Next.js 15, React 19, zustand, MapLibre, node:test. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-12-ui-simplification-design.md`

## Global Constraints

- Branch `develop`. Commits use conventional prefixes and **no** Co-Authored-By or AI trailers.
- No new dependencies. (If one is ever needed: pinned, released at least two weeks ago.)
- Reuse `components/ui/*` and design-bible tokens (`app/globals.css`, `app/ui.css`, `lib/ui/classes.mjs`); no one-off colours, radii or font sizes.
- Light, dark and night vision must all work; night vision stays red-only.
- Copy: the projection is "Mercator", never "flat". No em dashes in UI copy.
- Times in the place's zone (`observer.tz` from `usePlaceZone`), never the viewer's.
- Breakpoints: "desktop" is `min-width: 1100px` (the existing docked layout); under it is the phone/stacked layout.
- Old saved prefs in `seeksat.home.v1` must still load.
- Never hit CelesTrak from the laptop; never call `/api/cron/*` or `/api/refresh-tle`.
- Run tests with `npm test`, types with `npm run typecheck`.
- Screenshot checks at 1280 px desktop and 360 and 390 px phone. Playwright lives at `/Users/aaron/work/qrz-swapmeet-watch/node_modules/playwright/index.mjs` (`chromium.launch()`, no executablePath). Serve with `npx next build && npx next start -p 3100 -H 127.0.0.1` and strip the CSP and HSTS response headers in a Playwright route. Seed `localStorage['seeksat.home.v1']` with a location like `{latDeg:41.88, lonDeg:-87.63, name:"Chicago", source:"place"}`.

## Review Focus

1. A place picked twice, or the current place picked again: the recent list never shows duplicates and never lists the current place twice (Task 1 test `withPlace dedupes`).
2. Passes that cross midnight in the place's zone, and a viewer in another zone: day headings follow the place's calendar, not the viewer's (Task 2 test `groups by the place's day`).
3. A pass in progress: it is the first row and reads "Now", even when a later pass started sooner in the list order (Task 2 test `in-progress first`).
4. Twenty followed satellites in radio mode at 0°: the list stops at 12 rows and "Show more" counts the rest (Task 2 test `caps at 12`).
5. A satellite with no passes, a stationary one, and a missing id: none crash the list; they land in "Always up" or the quiet line (Task 2 test `non-pass cards`).

---

### Task 1: Recent places

**Files:**
- Create: `lib/home/places.mjs`
- Modify: `lib/home/prefs.mjs` (add `recent` to `defaultPrefs` and `parsePrefs`)
- Modify: `lib/home/store.ts` (add `choosePlace`)
- Modify: `components/home/LocationPrompt.tsx` (`save` calls `choosePlace`)
- Test: `test/home-places.test.mjs`

**Interfaces:**
- Produces: `RECENT_MAX = 5`; `samePlace(a, b): boolean` (lat and lon equal to 4 decimals); `withPlace(prefs, location): { location, recent }`; `cleanRecent(v): Location[]`; store action `choosePlace(location: HomeLocation): void`; prefs field `recent: HomeLocation[]`.

- [ ] **Step 1: Write the failing tests**

```js
import { withPlace, samePlace, cleanRecent, RECENT_MAX } from '../lib/home/places.mjs';
import { parsePrefs, defaultPrefs } from '../lib/home/prefs.mjs';
const chi = { name: 'Chicago', latDeg: 41.88, lonDeg: -87.63, source: 'place' };
const tok = { name: 'Tokyo', latDeg: 35.68, lonDeg: 139.69, source: 'place' };
test('withPlace moves the old place into recent', () => {
  const r = withPlace({ ...defaultPrefs(), location: chi, recent: [] }, tok);
  assert.deepEqual(r.location, tok);
  assert.deepEqual(r.recent, [chi]);
});
test('withPlace dedupes', () => {
  const r = withPlace({ ...defaultPrefs(), location: tok, recent: [chi] }, chi);
  assert.deepEqual(r.recent.map((p) => p.name), ['Tokyo']);
  const same = withPlace({ ...defaultPrefs(), location: chi, recent: [] }, { ...chi });
  assert.deepEqual(same.recent, []);
});
test('recent keeps the last RECENT_MAX', () => {
  let p = { ...defaultPrefs(), location: null, recent: [] };
  for (let i = 0; i < 8; i++) p = { ...p, ...withPlace(p, { name: `P${i}`, latDeg: i, lonDeg: i, source: 'coords' }) };
  assert.equal(RECENT_MAX, 5);
  assert.equal(p.recent.length, 5);
  assert.equal(p.recent[0].name, 'P6');
});
test('old prefs without recent load with an empty list', () => {
  assert.deepEqual(parsePrefs(JSON.stringify({ location: chi })).recent, []);
});
test('cleanRecent drops bad entries', () => {
  assert.deepEqual(cleanRecent([chi, { latDeg: 99 }, 'x', null]), [chi]);
});
test('samePlace compares to 4 decimals', () => {
  assert.ok(samePlace(chi, { ...chi, latDeg: 41.880001 }));
  assert.ok(!samePlace(chi, tok));
});
```

- [ ] **Step 2: Run** `node --test test/home-places.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `lib/home/places.mjs`. Move `cleanLocation` and `SOURCES` from `prefs.mjs` into `places.mjs` (exported) and import them back into `prefs.mjs`, so there is no import cycle. Newest first in `recent`; the current place is never in `recent`.
- [ ] **Step 4: Add** `recent: []` to `defaultPrefs()`, `recent: cleanRecent(v.recent)` to `parsePrefs`, `recent: HomeLocation[]` to the store's `Prefs` type, and `choosePlace: (loc) => get().setPrefs(withPlace(get().prefs, loc))`. In `LocationPrompt.save`, call `choosePlace(location)` instead of `setPrefs({ location })`.
- [ ] **Step 5: Run** `npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 6: Commit** `feat: Keep the last five places on the device`

### Task 2: Pass-list grouping

**Files:**
- Modify: `lib/home/next-up.mjs` (pass cards also carry `upcoming`: every pass in the 48 h window)
- Create: `lib/home/pass-list.mjs`
- Modify: `components/home/NextUpList.tsx` (add `upcoming?: Pass[]` to the pass `Card` type)
- Test: `test/home-pass-list.test.mjs`, extend `test/home-next-up.test.mjs`

**Interfaces:**
- Consumes: `Card` from `nextUp`; `compass` from `lib/sat/pass-rows.mjs`; `formatPassDuration` from `lib/passes/format.mjs`.
- Produces:
  - `ROW_LIMIT = 12`
  - `passList({ cards, nowMs, timeZone, limit = ROW_LIMIT }) -> { groups: Array<{ key: string, label: string, rows: Row[] }>, more: number, always: StationaryCard[], quiet: string[] }` where `Row = { key: string /* `${noradId}:${startMs}` */, noradId, name, pass, now: boolean }`
  - `dayLabel(ms, nowMs, timeZone) -> "Today" | "Tomorrow" | weekday name ("Friday")`
  - `rowWhen(pass, nowMs, timeZone) -> { time: string, sub: string }`: `sub` is "Now" in progress, "in 42 min" / "in 3 h" on the same day, else the short weekday ("Fri")
  - `rowDetail(pass) -> "54° · 5 min · SW→NE"` (direction omitted when an azimuth is null)
  - `quietLine(names) -> "No passes in the next 48 h: X, Y"` or null

Ruling: day headings are "Today", "Tomorrow", then the weekday. The spec's "Tonight" is an example, and "Tonight" is wrong for a daytime pass.

- [ ] **Step 1: Write failing tests.** Use synthetic cards (no orbit maths) built with a helper `p(startIso, minutes, maxElev, az0, az1, extra)`:
  - `next-up pass cards carry upcoming`: ISS at T0 (existing fixture): `card.upcoming.length >= card.passes.length`, all with `startMs < T0 + 48h`.
  - `rows are sorted by start across satellites`: two cards with interleaved `upcoming`; the rows alternate by `startMs`.
  - `in-progress first`: a pass with `inProgress: true` comes first with `now: true`, and `rowWhen(...).sub === 'Now'`.
  - `groups by the place's day`: a pass at `2026-11-13T04:30:00Z` with `timeZone: 'Asia/Tokyo'` and `nowMs` `2026-11-12T20:00:00Z` lands under "Today"; with `'America/Chicago'` the same pass lands under "Today" too, but a pass at `2026-11-13T07:00:00Z` lands under "Tomorrow" for Chicago.
  - `caps at 12`: 20 cards × 2 passes gives 12 rows across groups and `more === 28`; `limit: Infinity` gives 40.
  - `non-pass cards`: a stationary card goes to `always`; `none`, `unavailable` and `missing` names go to `quiet`; `quietLine(['AO-91','FO-29']) === 'No passes in the next 48 h: AO-91, FO-29'`; `quietLine([]) === null`.
  - `rowDetail`: `{ maxElevDeg: 54.4, durationMs: 5*60e3, startAzDeg: 225, endAzDeg: 45 }` gives `'54° · 5 min · SW→NE'`; with `endAzDeg: null` gives `'54° · 5 min'`.
- [ ] **Step 2: Run** `node --test test/home-pass-list.test.mjs test/home-next-up.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `cardFor`, add `upcoming: r.passes`. Day keys use `Intl.DateTimeFormat('en-CA', { timeZone })` as `dayTime` in `NextUpList.tsx` does. Times use the site clock (`clockFormat` from `lib/clock.mjs`) in `timeZone`. A card without `upcoming` (old cache) falls back to `card.passes ?? [card.pass]`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: Group passes into day-headed rows`

### Task 3: "Both see" line on the satellite page

**Files:**
- Create: `lib/sat/places-line.mjs`
- Modify: `lib/home/store.ts` (add `clearObservers(): void`)
- Modify: `components/sat/PassSection.tsx` (render the line at the top of the pass list)
- Modify: `app/sat.css`
- Test: `test/sat-places-line.test.mjs`

**Interfaces:**
- Produces: `placesLine(names: string[]) -> string | null`.

- [ ] **Step 1: Failing tests:**

```js
assert.equal(placesLine(['Chicago']), null);
assert.equal(placesLine(['Chicago', 'Tokyo']), 'Showing passes Chicago and Tokyo can both see');
assert.equal(placesLine(['Chicago', 'Tokyo', 'Paris']), 'Showing passes Chicago, Tokyo and Paris can all see');
assert.equal(placesLine(['', 'Tokyo']), 'Showing passes Your location and Tokyo can both see');
```

- [ ] **Step 2: Run** and see it FAIL.
- [ ] **Step 3: Implement** `placesLine`. In `PassSection`, when `observers.length > 1`, render `<p className="sat-places-line" role="status">` with the text, plus `<Button size="sm" onClick={clearObservers}>Turn off</Button>` unless `shared`. Place it directly above the pass rows, after the "Finding passes..." note and before the rows, so it is visible wherever the list is. Style: a `Surface`-like band using the `--warn` token for the left border and text weight semibold; it must stand out in light, dark and night.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Then screenshot `/sat/25544` at 390 px with one extra observer seeded (`observers: [{ id: 'obs-1', name: 'Tokyo', latDeg: 35.68, lonDeg: 139.69 }]`): the line shows above the first row. Tap Turn off: the line goes and the list refills.
- [ ] **Step 5: Commit** `feat: Say when the pass list needs every place to see it`

### Task 4: Sheet-size Modal

**Files:**
- Modify: `lib/ui/classes.mjs` (`modalClass` accepts `size: 'sheet'` → class `modal--sheet`)
- Modify: `components/ui/Modal.tsx` (`size?: "dialog" | "full" | "sheet"`)
- Modify: `app/ui.css`
- Test: `test/ui-classes.test.mjs`

- [ ] **Step 1: Failing test:** `assert.equal(modalClass({ size: 'sheet' }), 'modal modal--sheet')`.
- [ ] **Step 2: Run** and see it FAIL.
- [ ] **Step 3: Implement.** Under 1100 px a sheet is pinned to the bottom, full width, top corners `--radius-lg`, a 40×5 grab bar drawn with `::before` on the panel, max height 85svh with its body scrolling. From 1100 px a sheet is a 360 px panel under the header at the top right (`top: var(--header-h)` or the header's measured height, `right: var(--sp-16)`), with a light backdrop. Respect `prefers-reduced-motion` (slide-up only without it).
- [ ] **Step 4: Run** `npm test`.
- [ ] **Step 5: Commit** `feat: Add a sheet size to the dialog`

### Task 5: Map layers menu and overlay buttons

**Files:**
- Create: `components/map/MapLayers.tsx`
- Modify: `components/home/FlatMap.tsx` (replace the chip-row projection switch, the presets group, the legend box and the share slots with two buttons: layers ◱ and full screen ⛶; keep zoom +/− in the bottom corner)
- Modify: `app/home.css`

**Interfaces:**
- Produces: `MapLayers({ view, onViewChange, presets, onPreset, followOn, onReset, share, legend }: { view: "flat" | "globe"; onViewChange(id: string): void; presets: Array<{ id: Preset; label: string }>; onPreset(id: Preset): void; followOn: boolean; onReset(): void; share: ReactNode; legend: ReactNode })`: a button with `aria-expanded` and a popover (`role="dialog"`, Escape and outside click close, focus returns to the button).

Popover content, top to bottom:
1. "Map": `Segmented` with `PROJECTIONS` (labels Globe | Mercator).
2. "View": the globe presets as buttons (Satellite pressed while followed), or "Reset view" on Mercator.
3. The `share` node, labelled "Share this view".
4. "What you see": the existing `legendList`.

- [ ] **Step 1: Build `MapLayers`** with the content above. The `chips` prop stays: the satellite page still passes chips, which keep their place at the top left.
- [ ] **Step 2: In FlatMap**, put the layers and full-screen buttons at the top right of the map (`variant="overlay" iconOnly`, labels "Map layers" and "Full screen"/"Exit full screen"). Show zoom +/− only from 1100 px (CSS). Remove the legend box under the map, the View toggle row and `flat-map__share--row`.
- [ ] **Step 3: Run** `npm run typecheck && npm test`. Expected: pass. If `test/map-legend.test.mjs` or `test/home-css.test.mjs` assert removed markup, update those assertions to the new location and say so in the commit body.
- [ ] **Step 4: Screenshots** at 1280 and 390 on `/` and `/sat/25544`, layers menu closed and open, Globe and Mercator. Legend samples must draw.
- [ ] **Step 5: Commit** `feat: Move map view, presets, share and legend into a layers menu`

### Task 6: Header, location pill and location sheet

**Files:**
- Create: `components/map/LocationSheet.tsx`
- Create: `components/map/LocationPill.tsx`
- Modify: `components/map/SiteHeader.tsx`
- Modify: `components/home/LocationPrompt.tsx` (add `variant?: "card" | "sheet"`: the sheet variant drops the card heading and the popular list)
- Modify: `app/home.css`

**Interfaces:**
- Consumes: `choosePlace`, `prefs.location`, `prefs.recent` (Task 1); `usePlaceZone`, `viewerZone` (`components/usePlaceZone.ts`); `zoneNote`, `sameClock` (`lib/time/zone.mjs`); `Modal size="sheet"` (Task 4).
- Produces: `LocationPill({ onOpen })` showing "📍 {name} ▾", or "📍 Set location" when there is none.

- [ ] **Step 1: LocationSheet.** `Modal size="sheet" title="Passes from"`. Body: `LocationPrompt variant="sheet"` (search field with placeholder `Place, "lat, lon" or grid (EN52ve)`, then "Use my location" with the sub-line "Stays on this device"), then the current place ticked, then each `recent` place as a button that calls `choosePlace` and closes. A row whose zone's clock differs from the viewer's (`!sameClock`) shows "Times shown in {city} time" (reuse `zoneNote`'s city wording). Saving from the prompt closes the sheet.
- [ ] **Step 2: Header.** Phone (<1100): wordmark, pill, a search icon button that reveals the existing `SearchBar` in a row under the header (Escape or blur with an empty field hides it), then ⋯. Desktop: wordmark, `SearchBar`, pill, `LiveClock`, ⋯. Remove `ThemeToggle` and `NightToggle` from the header (Task 7 moves them). ⋯ is a placeholder button in this task, wired in Task 7.
- [ ] **Step 3: Run** `npm run typecheck && npm test`.
- [ ] **Step 4: Screenshots** at 360, 390 and 1280: header fits on one row at 360 with "Chicago"; the sheet opens from the pill; picking Tokyo changes the pill and the times; Chicago is then in the recent list.
- [ ] **Step 5: Commit** `feat: Put the location behind a pill and sheet`

### Task 7: Settings sheet

**Files:**
- Create: `components/map/SettingsSheet.tsx`
- Create: `components/home/BandPicker.tsx` (moved out of `HomeControls.tsx`, which imports it back)
- Modify: `components/map/SiteHeader.tsx` (⋯ opens the sheet)
- Modify: `components/home/HomeApp.tsx` (About goes into a closed `<details id="about">` before the footer)

Rows in this order, with these labels:

| Label | Control |
|---|---|
| Sky where you watch | the sky-type `select` (visual rating) |
| Lowest pass to show | − {n}° + stepper (`stepMinElev`, `MIN_ELEV_MAX` from HomeControls' imports) |
| Radio bands | `BandPicker` |
| Following | each followed satellite: name, a Show/Hide on map toggle (`toggleHidden`), Unfollow (`unfollow`) |
| Theme | `ThemeToggle` |
| Night vision | `NightToggle` |
| About SeekSat › | closes the sheet, opens `details#about` and scrolls it into view |
| Send feedback › | `mailto:` `FEEDBACK_EMAIL` (`lib/site/feedback.mjs`) |

Names in Following come from `CATALOG` shortName, then the store's records, then `prefs.custom`, then `NORAD {id}`, as `nameOf` in HomeApp does. Move that lookup into `lib/home/names.mjs` as `satName(id, { records, custom }) -> string` with a unit test, and use it from both places.

- [ ] **Step 1: Failing test** `test/home-names.test.mjs`: `satName(25544, …) === 'ISS'`; an unknown id gives `'NORAD 99999'`; a custom id gives its custom name.
- [ ] **Step 2: Run**, see it FAIL, implement `satName`, run again: PASS.
- [ ] **Step 3: Build** `SettingsSheet` (`Modal size="sheet" title="Settings"`) and wire ⋯.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Screenshot the sheet at 390 and 1280 in light, dark and night vision.
- [ ] **Step 5: Commit** `feat: Gather settings, theme and about behind the menu button`

### Task 8: Pass list component

**Files:**
- Create: `components/home/PassList.tsx`
- Create: `components/home/PassRowOpen.tsx`
- Modify: `components/home/NextUpList.tsx` (export `ElementTags`, `FollowChip`, `usePassCharts` for reuse; the default export stays until Task 9 removes it)
- Modify: `app/home.css`

**Interfaces:**
- Consumes: `passList`, `rowWhen`, `rowDetail`, `quietLine`, `ROW_LIMIT` (Task 2); `OpenChart` from `NextUpList`.
- Produces: `PassList({ cards, viewingCard, tracks, colors, observer, mode, minElevDeg, nowMs, onModeChange, zoneNote, strip, onUnfollow, onFollow, followBlocked, openChart, clouds, skyType, onOpenRow }: …)`, where `strip?: ReactNode` is rendered under the heading (desktop strip) and `onOpenRow(noradId: number | null)` reports the most recently opened row's satellite (null when all are closed).

Markup and behaviour:
- Heading row: `<h2>Passes</h2>` and `Segmented label="Pass mode" size="sm"` with Visual | Radio. `zoneNote`, when given, sits under the heading in muted small text.
- A pinned row for `viewingCard` (a focused satellite you don't follow) comes first, with the Follow button inside it, closed.
- Groups: an `<h3>` day heading, then a `<ul>` of rows. Each row is a `<button aria-expanded aria-controls>` laid out in a three-column grid: time column (bold `time`, muted `sub`), name plus `rowDetail` (single line, ellipsis), quality pill on the right (`QualityBadge pill` with the visual rating in visual mode, the elevation rating in radio mode). A 3 px left bar in the satellite colour (`--sat-color`). No colour dot on its own line.
- Open rows: a `Set<string>` of row keys. From 1100 px the first row starts open (read `matchMedia('(min-width: 1100px)')` once on mount); under it all start closed.
- `PassRowOpen` (inside the `<li>`, below the button):
  - `PolarPlotSvg` painted with `paintPassCard`, 80 px, repainting as `PassCard` does today (`LIVE_LEAD_MS`, `IDLE_PAINT_MS`);
  - Rises / Highest / Sets: time and compass point, from `pass.startMs/startAzDeg`, `peakMs/peakAzDeg/maxElevDeg`, `endMs/endAzDeg`;
  - visual mode: `peakMagText` and `CloudBadge`; radio mode: `RadioPanel`;
  - main buttons: Live (when `liveAvailable`), Sky chart (visual) or Radio chart (radio), Remind me (`AlertBell`), Share (`ShareButton` with the `shareUrl` the calendar export builds today), then a "{name} page ›" link to `/sat/{id}` (not for pasted satellites, with `markFromList`);
  - a quiet second line: the other chart, Calendar (the `.ics` download from `PassCard`), `ElementTags`, `FollowChip`, and "Best pass in the next 24 hours" when `bestPass` picks this pass.
- After the groups: "Show more ({more})" reveals all rows (`limit: Infinity`). Then the "Always up" group: a row per stationary card with "Az {az}° · El {el}°" as its detail, opening to `RadioPanel` in radio mode. Then the `quietLine`.

- [ ] **Step 1: Build** both components. Keep `PassCard`'s chart, ICS and share logic by moving shared pieces into small exported functions in `NextUpList.tsx` rather than copying them.
- [ ] **Step 2: Run** `npm run typecheck && npm test`. Expected: pass.
- [ ] **Step 3: Commit** `feat: Add the compact pass list`

### Task 9: Rewire home

**Files:**
- Modify: `components/home/HomeApp.tsx`
- Delete: `components/home/UpNow.tsx`, `components/home/NextStrip.tsx`, `lib/home/next-strip.mjs`, `test/home-next-strip.test.mjs`, and the default `NextUpList` export plus its `PassCard` (keep the exported helpers), once nothing imports them (`grep -rn` to confirm).
- Modify: `components/home/Timeline.tsx` (a `slim` presentation: one 16 px track with tick labels, rendered only from 1100 px)
- Modify: `lib/home/focus.mjs` (`mapLayers` gains `highlightId = null`: when `focusId` is null and `highlightId` is set, that satellite gets `'focus'` and the others `'ghost'`)
- Test: `test/home-focus.test.mjs`

- [ ] **Step 1: Failing test** in `test/home-focus.test.mjs`: `mapLayers({ followed: [1, 2], highlightId: 2 })` gives `[{1,'ghost'},{2,'focus'}]`; with `focusId: 1, highlightId: 2` the focus wins (`1` focus, `2` ghost).
- [ ] **Step 2: Run**, see FAIL, implement, see PASS.
- [ ] **Step 3: HomeApp:**
  - Remove `HomeControls`, `UpNow`, `NextStrip` (and `nextSummary`), and the `chips` scene entry.
  - Render `PassList` where `NextUpList` was, with `zoneNote`, `onModeChange={(mode) => setPrefs({ mode })}`, and `strip={<Timeline slim … />}`.
  - Keep `highlightId` state from `onOpenRow` and pass it to `layersOf`, not to `selectedId`, so the camera doesn't move.
  - Keep: `LocationPrompt` as the main content on a first visit (no location) with `PopularList` below it; `keepPopular`; the error banner; `ClockSkewBanner`; `FocusBar`; `chartModals`; `SiteFooter` last; the closed `details#about` from Task 7.
  - The empty-following note becomes "You aren't following any satellites. Search to add one."
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: pass, with the deleted test gone.
- [ ] **Step 5: Commit** `feat: Show home as map and one pass list`

### Task 10: Phone layout and scroll-over-map

**Files:**
- Modify: `app/home.css`

Rules under 1100 px:
- The header stays sticky as now.
- `.map-shell__map` becomes `position: sticky` with `top: calc(var(--header-h) - var(--map-h) + 72px)` (define `--map-h`, the map's resting height, and `--header-h`), so scrolling lifts the map until a 72 px strip remains.
- `.map-shell__panel` sits after it with `position: relative; z-index: 1`, the page background, top corners `--radius-lg` and `--shadow-popover`, so the list reads as a sheet sliding up.
- No JS scroll handlers. It must work in iOS Safari and Android Chrome. Check `svh` units and the first-visit height rules (`html[data-first-visit]`) still apply.
- [ ] **Step 1: Write the CSS.**
- [ ] **Step 2: Screenshots** at 360 and 390: at rest (map and at least three pass rows visible without scrolling), scrolled 400 px (map strip visible, list over it), a row opened. Also at 1280 to confirm desktop is untouched by these rules.
- [ ] **Step 3: Commit** `feat: Slide the pass list over the map on phones`

### Task 11: Final pass

- [ ] **Step 1: Run** `npm test`, `npm run typecheck` and `npx next build`. Report the actual counts.
- [ ] **Step 2: The moment check** at 390 px, as a script that saves screenshots to the scratchpad. Open `/` with Chicago seeded: no scrolling needed to see the map and the next passes. Tap the first row: details open in place. Tap the pill, then Tokyo: the times change to Tokyo time, and the pill reads Tokyo. Tap the pill, then Chicago: back in two taps.
- [ ] **Step 3: Check every row of the spec's "Where every current piece goes" table** is reachable at 390 and 1280 (map layers, ⋯ settings, open row extras). List any gap and fix it before finishing.
- [ ] **Step 4: Check copy:** grep the changed TSX for an em dash (`—`) and for `"Flat"`/`flat map` in visible strings. Expected: none.
- [ ] **Step 5: Commit** any fixes as `fix: …`.
