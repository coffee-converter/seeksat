# Site Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** These are the next improvements Aaron asked for ("enhance the site with any more of those plans"):
- an "Up now" sky view;
- pass alerts;
- install-and-offline support;
- a printable pass sheet;
- more verified downlinks;
- the small leftovers from Plan 6.

**Architecture:**
- **Pure logic:** each feature's logic is a pure, tested module in `lib/`, and components stay thin.
- **No new servers or accounts:** alerts run in the browser while SeekSat is open, or installed and open.
- **Service worker:** it caches only the app shell, static chunks and the last satellite records. It never caches CelesTrak, which the browser never calls anyway.

**Tech Stack:** Next.js 15 App Router (`app/manifest.ts`), a plain service worker in `public/sw.js`, the Notification API, `@media print`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-30-any-satellite-tracker-design.md`. This plan follows its anti-goals: no false confidence, light pages, no ads, and CelesTrak usage limits. Push alerts and rig control are listed as non-goals for version one, so alerts here are in-browser only and their copy says so. Plans 1 to 7 come first.

## Global Constraints

- **Honesty:** every number keeps saying what it is.
  - "Up now" positions are live SGP4 values for your location.
  - Alerts say they work only while SeekSat is open.
  - Offline data says how old it is.
- **Weight:** nothing new loads on first paint unless it is shown on first paint. The `bundle-split` test must stay green.
- **CSP:** unchanged. The service worker is same-origin (`worker-src 'self'`), and notifications need no CSP change.
- **Network:** no CelesTrak from the browser or a developer machine. The service worker caches only same-origin GET requests.
- **Themes:** new UI uses the Plan 7 tokens and works in light and dark.
- **Copy:** plain language, no em dashes. Quoted copy is exact.
- **Tests and commits:** `npm test`, `npx tsc --noEmit`. Conventional commit prefixes, no AI attribution lines.

## Review Focus

1. **Alerts after a reload or a closed tab:** saved alerts are re-armed on load, and alerts for passes already started are dropped, not fired late. Pinned in Task 3.
2. **Notification permission denied or unsupported** (iOS Safari outside an installed app): the bell says why, and nothing throws. Pinned in Task 3.
3. **A stale service worker serving old HTML after a deploy:** navigations are network-first, and a new worker takes over on the next load. Pinned in Task 4 (`strategyFor` tests and a versioned cache name).
4. **"Up now" with no location, or with nothing above the horizon:** a clear message, no empty plot. Pinned in Task 2.
5. **Printing in dark mode:** the sheet prints dark-on-white, without map or controls. Pinned in Task 5 (screenshot of print media emulation).

---

### Task 1: Leftovers from Plan 6

**Files:** `components/home/FocusBar.tsx`, `components/sat/SatApp.tsx`, `app/home.css`, `lib/map/labels.mjs`, `components/home/FlatMap.tsx`, `lib/map/draw.mjs`, their tests

- **Follow buttons:** the FocusBar and SatApp buttons whose label flips ("☆ Follow" / "★ Following") drop `aria-pressed`. Their pressed look moves to a class, `.home-chip--on`.
- **Tick labels in avoid:** the selected satellite's two tick labels (`+10m`, `+20m`, or hours) get boxes in the place-label avoid list. Compute them from the same positions draw uses: export the tick-label geometry from `draw.mjs` or `marks.mjs`.
- **Phone meridian labels:** when a meridian's bottom-edge label box is rejected because it overlaps a control, try the same meridian at the top edge (its smallest-y visible point), still subject to avoid. Test: at 374×480 equirectangular with a zoom-row control box across the bottom left, at least 3 meridians are labelled.
- [ ] Tests first for the tick-label avoid and the top-edge fallback. Implement. Run `npm test` and `npx tsc --noEmit`. Commit with `git commit -m "fix: Label meridians on the top edge when controls block the bottom, and keep tick labels clear"`.

---

### Task 2: "Up now" sky view

**Files:** create `lib/sky/up-now.mjs`, `test/sky-up-now.test.mjs`, `components/home/UpNow.tsx`; modify `components/home/HomeApp.tsx`, `app/home.css`

**Interfaces:**
- `upNow({ tracks, observer, nowMs, minElevDeg = 0 }) -> Array<{ noradId, name, azDeg, elDeg, rising, color? }>`.
  - Each satellite's elevation is apparent elevation via the existing `satAltAzDeg` plus refraction, the same as the engine.
  - `rising` is true when the elevation 30 s later is higher.
  - Results are sorted by elevation, highest first. Values have one decimal.
- `compassName(azDeg)` reuses `compass` from `lib/sat/pass-rows.mjs`.
- **`UpNow` component:**
  - It sits in the home panel above "Next up", only when a location is set.
  - It contains an SVG polar plot (horizon circle, 30° and 60° rings, N/E/S/W) with one dot per satellite in its map colour, and a short list:
    - with satellites above the horizon: `"ISS 34° up, SW, rising"`;
    - with none: the text `"Nothing you follow is above the horizon right now."`.
  - Heading: `"Up now"`. It updates every second from the page clock, reusing the tracks HomeApp already builds.
  - The plot uses theme tokens. It is not one of the protected chart views.
- **Tests:**
  - the ISS fixture from EN52VE at a fixture moment inside a known pass gives one entry with plausible az/el;
  - outside every pass gives `[]`;
  - `rising` flips across the peak;
  - sorting is by elevation.
- [ ] Tests first, implement, run `npm test` and `npx tsc --noEmit`, take a 390 px and 1440 px screenshot at a moment with a satellite up (pick the time from the fixture or wait for one), and commit with `git commit -m "feat: Show what is above your horizon right now"`.

---

### Task 3: Pass alerts

**Files:** create `lib/alerts/alerts.mjs`, `test/alerts.test.mjs`, `components/AlertBell.tsx`, `components/AlertRunner.tsx`; modify `components/home/NextUpList.tsx`, `components/sat/PassSection.tsx`, `components/home/HomeApp.tsx`, `components/sat/SatApp.tsx`, `app/home.css`

**Interfaces:**
- **Storage:** `seeksat.alerts.v1`, a list of `{ id, noradId, name, startMs, peakMs, maxElevDeg, leadMin, url }`. The `id` is `${noradId}:${startMs}`. There are at most 50, oldest dropped.
- **Pure functions:** `parseAlerts`, `addAlert(list, alert)`, `removeAlert(list, id)`, `pruneAlerts(list, nowMs)` (drops `startMs < nowMs`), `nextDue(list, nowMs) -> alert | null` (the smallest `startMs - leadMin` minute that is ≥ nowMs), and `alertText(alert, nowMs)`. Notification body: `"<name> in <countdown>, max <N>°"`, using the existing `countdown`.
- **`AlertBell`:** a 🔔 chip on each pass card and each satellite page pass row (`aria-label="Remind me before this pass"` / `"Cancel reminder"`).
  - **First use:** it asks `Notification.requestPermission()`.
  - **When granted:** it adds the alert with the default lead time, 10 min, shown in its title `"Reminder 10 min before"`.
  - **When denied or unsupported:** it shows the inline note `"Your browser blocked notifications. Allow them for this site to get reminders."`, or `"This browser can't show reminders. On iPhone, add SeekSat to your Home Screen first."`.
- **`AlertRunner`:** mounted once per page.
  - It prunes on load and arms one `setTimeout` for `nextDue`.
  - When the timer fires, it shows `new Notification('SeekSat', { body, tag: id })`. Clicking the notification focuses the tab and navigates to `url`.
  - It re-arms on storage change, on `visibilitychange` and after each fire.
  - A visible note in About and under the bell's first use: `"Reminders work while SeekSat is open in a tab or installed as an app."`.
- **Tests:**
  - parse with junk input;
  - add with the cap;
  - remove;
  - prune drops passes that have started;
  - `nextDue` ordering with mixed lead times;
  - `alertText` copy;
  - a fake timer harness for the runner logic, extracted as a pure `planTimer(list, nowMs) -> { delayMs, alert } | null`.
- [ ] Tests first, implement, run `npm test` and `npx tsc --noEmit`, and commit with `git commit -m "feat: Add pass reminders that notify before a pass while SeekSat is open"`.

---

### Task 4: Install and offline

**Files:** create `app/manifest.ts`, `public/sw.js`, `lib/pwa/strategy.mjs`, `test/pwa-strategy.test.mjs`, `components/SwRegister.tsx`, `components/OfflineBanner.tsx`; modify `app/layout.tsx`, `app/home.css`

**Interfaces:**
- **`app/manifest.ts`:**
  - `name` `"SeekSat"`, `short_name` `"SeekSat"`;
  - `start_url` `"/"`, `display` `"standalone"`;
  - `background_color` and `theme_color` `#0a0e1a`;
  - icons from the existing `app/icon.svg` and `app/apple-icon.png`; add PNG 192 and 512 icons under `public/` generated by `scripts/build-icons.mjs` if it supports that, otherwise report what you used.
- **`lib/pwa/strategy.mjs`:** `strategyFor({ url, method, mode, sameOrigin }) -> 'network-first' | 'cache-first' | 'network-only' | 'passthrough'`.
  - `passthrough`: non-GET or cross-origin.
  - `network-first`: navigations, and `/api/sats`, which falls back to the cache.
  - `cache-first`: `/_next/static/*` and `/assets/*`.
  - `network-only`: `/api/search`, `/api/og*`, `/api/mcp` and `/api/refresh-tle`.
  - `passthrough`: everything else.
- **`public/sw.js`:**
  - It implements those strategies inline. A service worker can't import ESM from `lib/`, so keep the same table and a test that compares `sw.js`'s table to `strategy.mjs` by reading the file text.
  - Cache name: `seeksat-v<n>`, bumped by a `SW_VERSION` constant. On `activate` it deletes other versions and calls `clients.claim()`.
  - The offline navigation fallback is the cached `/`.
- **`SwRegister`:** registers `/sw.js` in production only (`process.env.NODE_ENV === 'production'`), after load.
- **`OfflineBanner`:** shown while `navigator.onLine` is false: `"You're offline. Showing the last saved satellites."`. When the records came from cache, `/api/sats` data shows its `generatedAtMs` age through the existing element-age tags.
- **Tests:** every row of the strategy table, the sw.js table parity, and the manifest fields.
- [ ] Tests first, implement, run `npm test`, `npx tsc --noEmit` and `npm run build`, then verify with `npx next start -p 3458` and Playwright that `/sw.js` registers and that `/` loads offline after one online visit (`context.setOffline(true)`). Commit with `git commit -m "feat: Make SeekSat installable and usable offline with the last saved satellites"`.

---

### Task 5: Printable pass sheet

**Files:** modify `components/sat/PassSection.tsx`, `app/sat.css`, `app/home.css`

- A `Print` chip next to the pass list heading calls `window.print()`.
- `@media print`:
  - hides the top bar, map, controls, chips, chart buttons, bells, dashboard flash and footer links;
  - prints the satellite name, NORAD id, location, mode and minimum elevation;
  - prints the pass rows as a compact table (day, start to end, duration, max elevation, azimuths, visible, accuracy note) and the element age line;
  - uses black on white whatever the theme, at 10-11 pt;
  - avoids page breaks inside rows.
- Footer line on the print only: `"Printed from seeksat.com on <date>. Times are for <location>."`.
- [ ] Implement. Screenshot `/sat/25544` with `page.emulateMedia({ media: 'print' })` in dark mode, and view it. Run `npm test` and `npx tsc --noEmit`. Commit with `git commit -m "feat: Print a clean pass sheet from a satellite page"`.

---

### Task 6: More verified downlinks

**Files:** `lib/catalog.mjs`, `test/catalog.test.mjs`

- Research current, working downlinks for popular amateur and weather satellites. Candidates: RS-44, AO-123, SO-125, ISS SSTV events are already covered, Meteor-M2 4 is already covered, and any active FM birds on the AMSAT status page.
- **Verifying:** each entry needs two current sources (AMSAT status or FM satellites page, SatNOGS DB, the operator's own page) that agree. Do the research with WebSearch and WebFetch. Never call celestrak.org.
- **What to add:**
  - Add an entry only when the satellite is reported active within the last few months and both sources agree on the downlink.
  - Use the existing entry shape, with a source comment in the existing style (`// Verified 2026-11-01 against ...`).
  - Leave out anything uncertain, and list what you left out and why in the report.
- **Tests:** update the counts, and resolve each new entry by alias.
- [ ] Implement, run `npm test`, and commit with `git commit -m "feat: Add verified downlinks for more amateur satellites"`.
