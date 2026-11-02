# Next 24 Hours Timeline and Cloud Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- A "Next 24 hours" timeline of every followed satellite's passes on the home page.
- A Clear / Some cloud / Cloudy badge on visual passes, fed by a same-origin cloud route.

**Architecture:**
- **Pure helpers** in `lib/`, each tested with `node --test`:
  - timeline rows, ticks and night spans;
  - the cloud badge rule;
  - coordinate rounding.
- **Cards:** `nextUp` keeps every pass within 24 h on each card.
- **Cloud data:** a Next.js route (`/api/clouds`) wraps the existing `fetchCloudForecast` with CDN caching. One client hook fetches it per rounded location, in visual mode only.

**Tech Stack:** Next.js 15 App Router, React, SVG, `node --test`, Playwright (system Chrome) for the screenshot check.

**Spec:** `docs/superpowers/specs/2026-11-02-tonight-and-clouds-design.md`. It is the authority: read it before each task.

## Global Constraints

- **Network:**
  - No new browser origins; `CONNECT_ORIGINS` is unchanged.
  - Weather is fetched server-side only.
  - Never call CelesTrak from the browser or from Aaron's laptop.
- **Upstream calls:**
  - User-Agent `seeksat/1.0 (https://seeksat.app)`.
  - An 8 s `AbortSignal.timeout` on each.
  - The client sends coordinates rounded to 0.1°.
- **Badge words:** exactly `Clear`, `Some cloud` and `Cloudy`, with ` (forecast)` appended for passes 3 or more days out.
- **Cloud is visual-mode only.** The Good/OK/Low rating is unchanged.
- **Copy:** plain language, no em dashes.
- **Theme:** colours come from existing tokens (`--ok`, `--warn`, `--muted`, `--map-*`); `test/theme-css.test.mjs` enforces this.
- **Print:** the timeline and cloud badges are hidden in print.
- **Tests and commits:** `npm test` and `npx tsc --noEmit`. Conventional commits, with no AI attribution lines.

## Review Focus

1. **A pass already in progress at "now"** is drawn from the left edge, clipped, not before it. Pinned in Task 1.
2. **Observer time zone:** ticks and the day change follow the observer's zone, not the browser's. A Tokyo observer gets Tokyo ticks. Pinned in Task 1.
3. **Missing or failed forecast:** no badge and no error text anywhere; the route answers `hours: null`. Pinned in Tasks 3 and 4.
4. **Junk coordinates** get a 400. The client never sends more than 0.1° precision. Pinned in Task 3.
5. **Phones at 360 px:** no horizontal scroll, and bars at least 6 px wide. Checked in Task 4's screenshots.

---

### Task 1: Cards keep 24 hours of passes; timeline helpers

**Files:**
- Modify: `lib/home/next-up.mjs`, `test/home-next-up.test.mjs`
- Create: `lib/home/timeline.mjs`, `test/home-timeline.test.mjs`

**Interfaces:**
- **`nextUp`:** `pass` cards gain `passes`, the passes from that card's `findPasses` result whose `startMs < nowMs + 24 h`, in time order. `pass` stays `passes[0]`. Export `TIMELINE_HOURS = 24`.
- **`timelineRows(cards, nowMs) -> { rows: Array<{ noradId, name, passes }>, leftOut: number }`:**
  - **Rows:** one per `pass` card with at least one pass starting before `nowMs + 24 h`, in card order.
  - **`leftOut`:** cards of kind `none`, plus `pass` cards with no pass in the window.
- **`barSpan(pass, nowMs, hours = 24) -> { x0, x1 } | null`:**
  - Fractions of the window, in [0, 1].
  - `x0 = max(0, (startMs - nowMs) / span)` and `x1 = min(1, (endMs - nowMs) / span)`.
  - Null when the pass is entirely outside the window.
- **`hourTicks(nowMs, timeZone, { every = 3, hours = 24, locale }) -> Array<{ x, label, dayLabel | null }>`:**
  - Ticks fall on whole hours in `timeZone` that are multiples of `every`. `label` is `HH:00` (24-hour).
  - `dayLabel` is a short weekday such as `Tue`, set on the first tick of each new local day after the first.
- **`nightSpans(observer, nowMs, { hours = 24, stepMin = 10, belowDeg = -6 }) -> Array<{ x0, x1 }>`:** the stretches where `sunAltitudeDeg(obs, date) < belowDeg`, from `lib/pass-finder/visibility.js`. Pass `obs` in the shape that function takes; read its source.

- [ ] **Step 1: Write the failing tests:**
  - **`nextUp keeps the passes within 24 h on each card`:** an ISS fixture over 48 h. `card.passes` are all before now + 24 h, and `card.pass === card.passes[0]`.
  - **`timelineRows drops satellites with nothing in 24 h and counts them`:**
    - a `none` card counts as left out;
    - a `pass` card whose first pass is 30 h away counts as left out;
    - `stationary`, `unavailable` and `missing` cards are neither rows nor counted.
  - **`barSpan clips a pass in progress at the left edge`:** start 5 min before now gives `x0 = 0`.
  - **`barSpan` is null outside the window.**
  - **`hourTicks follows the observer's zone`:** with `nowMs = 2026-11-02T03:30Z`:
    - Tokyo (`Asia/Tokyo`, local 12:30): the first tick is `15:00` at x = 2.5/24.
    - Chicago (`America/Chicago`, local 21:30 on Nov 1): the first tick is `00:00`, carrying `dayLabel: 'Mon'` (locale `en-GB`).
  - **`nightSpans covers the night`:** Chicago (41.88, -87.63) from `2026-11-02T18:00Z`. One span starts near local dusk (about 23:30Z ± 30 min) and ends near dawn (about 12:00Z next day ± 30 min).
- [ ] **Step 2: Run** `node --test test/home-next-up.test.mjs test/home-timeline.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `feat: Add next 24 hours timeline helpers`.

---

### Task 2: The timeline on the home page

**Files:**
- Create: `components/home/Timeline.tsx`
- Modify:
  - `components/home/HomeApp.tsx`: render it between `UpNow` and `NextUpList`, from the same current cards;
  - `components/home/NextUpList.tsx`: export or lift what is needed to open a chart for a given pass;
  - `app/home.css`.

**Interfaces:**
- **Consumes** Task 1's helpers, `passQuality` (`lib/passes/quality.mjs`), the satellite colours map, the observer (with `tz`), `mode`, and `nowMs`.
- **`<Timeline cards tracks colors observer mode nowMs onOpenPass(noradId, pass, event) cloudFor?(pass) />`:**
  - `cloudFor` is optional and returns a badge or null. Task 4 supplies it. Until then nothing is hatched.

**Rendering:**
- **Section:** `aria-labelledby` an `h2.home-heading` with the text `Next 24 hours`.
- **Rows:** a name column about 96 px wide, ellipsised with a `title`, then an SVG strip.
  - Under 600 px the name sits above its strip instead.
  - The strip's `viewBox` is 0..1000 wide, with `preserveAspectRatio="none"` for the bars only. Text never stretches: tick labels are HTML, positioned by percent.
- **Night:** `nightSpans` as `rect`s filled with `var(--map-night)` or a darker panel token; choose one that passes theme-css.
- **Bars:**
  - In the satellite's colour, with opacity Good 1, OK 0.7, Low 0.45.
  - At least 6 px wide on screen, so short passes are widened symmetrically.
  - Each bar is a `<button>` (or a focusable SVG `<a role="button">`) whose `aria-label` is `"{name}, {HH:MM} to {HH:MM}, max {N}°, {Good|OK|Low}"`, plus `", {cloud word}"` once Task 4 lands.
  - A click calls `onOpenPass`, which opens the sky chart through the same `PassChartModals` path as the cards, with focus returning to the bar.
- **Ticks:** `hourTicks` labels under the strip, and a `now` hairline at x = 0.
- **Footer:** when `leftOut > 0`, a muted line: `1 other has no pass in the next 24 hours.` or `N others have no pass in the next 24 hours.`
- **When empty:** with no rows, the whole section renders nothing.
- **Print:** hidden.

- [ ] **Step 1: Implement** Timeline, the wiring and the CSS.
- [ ] **Step 2: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds.
- [ ] **Step 3: Do the screenshot check** with `npx next start -p 3461` and Playwright (system Chrome).
  - Seed `seeksat.home.v1` with Chicago and `following: [25544, 43017, 33591]`.
  - Capture `/` at 360, 390 and 1440 px, in light and dark.
  - Confirm: no horizontal scroll; a bar opens the sky chart and Esc returns focus to the bar; ticks are local to Chicago.
- [ ] **Step 4: Commit** with `feat: Show every pass in the next 24 hours on one timeline`.

---

### Task 3: Cloud route and badge rule

**Files:**
- Modify: `lib/pass-finder/weather.js`, `test/weather.test.mjs`
- Create:
  - `app/api/clouds/route.ts`;
  - `lib/sky/cloud-badge.mjs`, `test/cloud-badge.test.mjs`;
  - `lib/sky/round-coords.mjs`, tested in the same file.

**Interfaces:**
- **`weather.js`:**
  - Both upstream fetches send `User-Agent: seeksat/1.0 (https://seeksat.app)`, which is ignored in browsers, harmlessly.
  - Both use `signal: AbortSignal.timeout(8000)`.
  - The cache holds at most 200 entries, evicting the oldest first.
  - `fetchCloudForecast` and `cloudAt` keep their signatures.
- **`roundCoord(deg) -> number`:** rounds to 1 decimal place.
- **`cloudBadge(cloudPct, ageDays) -> { level: 'clear' | 'some' | 'cloudy', label, title } | null`:**
  - `null` when `cloudPct == null` or `ageDays > 7`.
  - `p = effectivePClear(cloudPct, ageDays)` from `lib/pass-finder/ratings.js`.
  - `p >= 0.7` is `clear`, `Clear`; `p >= 0.4` is `some`, `Some cloud`; otherwise `cloudy`, `Cloudy`.
  - When `ageDays >= 3`, `label` gets ` (forecast)` appended.
  - `title`: `"{round(cloudPct)}% cloud forecast, {N} days ahead"`, or `"... today"` under one day.
- **`GET /api/clouds?lat&lon`:**
  - Parses both as numbers. Non-finite values, |lat| > 90 or |lon| > 180 give a 400 `{ error }`.
  - Rounds with `roundCoord`, then calls `fetchCloudForecast`.
  - Returns 200 `{ startMs, hours }`, or `{ startMs: null, hours: null }` when the forecast is unavailable.
  - Header `Cache-Control: public, s-maxage=1800, stale-while-revalidate=3600`.
  - It is a Node runtime route; follow the pattern of the existing `app/api/*` routes.

- [ ] **Step 1: Write the failing tests:**
  - **`cloudBadge` thresholds:**
    - `(10, 0.5)` is `clear`;
    - `(50, 0.5)` is `some`;
    - `(90, 0.5)` is `cloudy`;
    - `(10, 4)` has a label ending ` (forecast)`;
    - `(null, 1)` is null;
    - `(10, 8)` is null.
  - **`roundCoord`:** `41.8781` gives `41.9`; `-87.6298` gives `-87.6`.
  - **In `weather.test.mjs`:**
    - with a stubbed global `fetch` that records its options, both calls carry the User-Agent and a `signal`;
    - after 201 distinct keys, the first key's promise is no longer cached (a second call re-fetches).
  - **Route handler test** (import `GET` and call it with a `Request`; stub `fetch` as above): bad input gives 400; good input gives 200 with the cache header; upstream failure gives `hours: null`.
- [ ] **Step 2: Run** `node --test test/cloud-badge.test.mjs test/weather.test.mjs` and the route test. Expected: FAIL. If importing a `.ts` route under `node --test` is not set up in this repo, put the handler logic in `lib/sky/clouds-handler.mjs`, keep `route.ts` a thin wrapper, and test the handler.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `feat: Serve cloud forecasts from our own route`.

---

### Task 4: Cloud badges in the app

**Files:**
- Create: `lib/sky/use-clouds.ts`, `components/passes/CloudBadge.tsx`
- Modify:
  - `components/home/HomeApp.tsx`, `components/home/NextUpList.tsx` and `components/home/Timeline.tsx`;
  - `components/sat/SatApp.tsx` and `components/sat/PassSection.tsx`;
  - `components/home/AboutSection.tsx`;
  - `app/home.css`.

**Interfaces:**
- **`useClouds(observer: { latDeg, lonDeg } | null, enabled: boolean) -> Forecast | null`:**
  - Fetches `/api/clouds?lat={roundCoord}&lon={roundCoord}`.
  - Concurrent calls for the same key share one module-level promise.
  - Refetches every 30 minutes while the document is visible.
  - Returns null when disabled, while loading, or on any failure. It never throws or logs to the console.
  - `enabled` is `mode === 'visual'`.
- **`<CloudBadge forecast pass nowMs />`:**
  - Renders `cloudBadge(cloudAt(forecast, pass.peakMs), (pass.peakMs - nowMs) / 86_400_000)`.
  - The markup is `<span className="cloud cloud--{level}" title>`, or nothing.
- **Placement:** after `QualityBadge` on home cards and on satellite-page rows, in visual mode only.
- **Timeline:** `cloudFor` gives a diagonal hatch on `cloudy` bars (an SVG `pattern`), and the cloud word in the bar's `aria-label`.
- **About:**
  - Append "Cloud forecasts from Open-Meteo and MET Norway." to the About section.
  - Extend the privacy line: "For cloud forecasts, SeekSat's server asks them about your area, rounded to about 11 km."

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds.
- [ ] **Step 3: Do the screenshot check** with `npx next start -p 3461`, Chicago, visual mode, `following: [25544, 43017, 33591]`.
  - **Network:** exactly one `/api/clouds` request per page, with 0.1° coordinates. No browser request leaves for any weather host.
  - **Badges:** they appear on cards and rows. Hatched timeline bars match the `Cloudy` cards.
  - **Failure:** with the route blocked (`page.route` abort), no badges show and the console has no errors.
  - **Radio mode:** no `/api/clouds` request.
  - Capture at 360 and 1440 px, in both themes.
- [ ] **Step 4: Commit** with `feat: Show cloud forecasts on visual passes`.
