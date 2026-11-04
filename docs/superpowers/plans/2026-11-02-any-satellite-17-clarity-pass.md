# Clarity Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "when and where do I look or tune" faster and remove the UI contradictions found in the 2026-11-02 UX review.

**Architecture:** Pure helpers and engine fields first (Task 1), then the home page (Task 2), first visit plus the map (Task 3), and the satellite page plus polar captions (Task 4). Each UI task ends with screenshots.

**Tech Stack:** Next.js 15, React, `node --test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-clarity-pass-design.md`. It is the authority for copy and behaviour.

## Global Constraints

- **Copy:** plain language, no em dashes. Magnitudes use U+2212. Times are in the observer's zone, in the same format as the cards.
- **Colour:** tokens only (`test/theme-css.test.mjs`).
- **Network:** never call CelesTrak.
- **Scope:** Night vision and the MCP route are unchanged.
- **Tests and commits:** `npm test` and `npx tsc --noEmit`. Conventional commits, with no AI attribution lines.

## Review Focus

See the spec's "Review focus" 1-5:
- items 1-3 are pinned in Task 1;
- item 4 is pinned in Task 3's helper test;
- item 5 is checked in Task 3's screenshots.

---

### Task 1: Helpers and engine fields

**Files:**
- Create: `lib/passes/pass-words.mjs`, `test/pass-words.test.mjs`
- Modify: `lib/passes/engine.mjs`, `test/passes-engine.test.mjs`, `lib/sky/visual-rating.mjs`, `lib/passes/quality.mjs`, and their tests

**Interfaces:**
- **Engine:** every pass gains `startElevDeg` and `endElevDeg` (one decimal). Radio passes gain `msAbove10` and `msAbove30`, sampled every 10 s.
- **`ratingShort(rating, pass, { mode })` gives a string or null:**
  - for the visual rating, it is driven by why `visualQuality` set the level. Extend `visualQuality` so it also returns `cause`, one of `'cloudy' | 'some-cloud' | 'faint' | 'twilight' | 'low' | null`;
  - for the elevation rating (`passQuality`), it is `'N° up'` when the level is below Good.
  - It returns `"cloudy"`, `"some cloud"`, `"faint"`, `"twilight"`, `"N° up"`, or null for Good.
- **`passWords(pass, { timeZone, mode, clock })` gives a string:**
  - the spec's "Rises … · peaks … · fades/sets …" line;
  - "fades" when `endElevDeg > 1`, otherwise "sets";
  - compass words come from `compass()` in `lib/sat/pass-rows.mjs`.
- **`bestPass(cards, { rate })` gives `{ noradId, name, pass, rating } | null`:**
  - it orders by rating level (good, then ok, then low), then by `maxElevDeg`, over every card's `passes`;
  - `rate(card, pass)` gives the rating, so visual and radio can each supply their own;
  - it returns null when there are no passes, or when the best pass is the soonest pass across all cards.
- **`riseDopplerHz(track, observer, pass, freqHz)` gives a number or null:**
  - it takes the range rate at `startMs` (ECEF at `startMs` and `startMs + 1000`), and returns `-rangeRate / c * freqHz`, so an approaching satellite gives a positive value;
  - it uses the existing observer-to-ECEF helper.

- [ ] **Step 1: Write the failing tests:**
  - **Engine fields:** ISS fixture, both modes; the start and end elevations are finite.
  - **Radio time above:** the ISS fixture in radio mode has `msAbove10 >= msAbove30 >= 0`.
  - **Badge words:** a Cloudy-capped visual pass gives `"cloudy"`, an elevation-Low pass at 3.4° gives `"3° up"`, and a Good pass gives null.
  - **Pass words:** `endElevDeg` 20 gives "fades in the …", 0.2 gives "sets …"; the exact string is checked for one fixture with zone `America/Chicago`.
  - **Best pass:** it picks Good over OK, then the higher of two Goods, and returns null when the best pass is the soonest.
  - **Rise Doppler:** it has the right sign for a rising pass (approaching, positive), and its magnitude is under 12 kHz at 437.8 MHz for the ISS.
- [ ] **Step 2: Run** the new and changed test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `feat: Add pass words, badge reasons, best pass and rise Doppler helpers`.

---

### Task 2: Home page

**Files:**
- Modify:
  - `components/passes/QualityBadge.tsx`;
  - `components/home/NextUpList.tsx`;
  - `components/home/HomeApp.tsx`;
  - `components/home/UpNow.tsx` (or its use in HomeApp);
  - `lib/passes/card-chart.js`;
  - `app/home.css`.

**What to build (spec sections "Ratings that explain themselves" through "Card plots"):**
- **Badge:** shows `{label}: {short}` when `short` is set.
- **Visual mode:** no "visible" tag.
- **Card text:** the pass words line goes on every pass card.
- **Best pass:** the "Best in the next 24 hours" button line sits above Next up and opens the sky chart through `usePassCharts`.
- **Radio facts:** the time above 10° and 30° and the rise Doppler for the first downlink go on radio cards.
- **Buttons:** the main button follows the mode, and the icons are labelled "Calendar" and "Remind me".
- **Up now:** hidden when nothing is up.
- **Card plots:** a light-theme background and 2 px satellite-colour arcs.

- [ ] **Step 1: Implement** the above.
- [ ] **Step 2: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds.
- [ ] **Step 3: Do the screenshot check:** home at 360, 390 and 1440 px, light and dark, visual and radio, following `[25544, 43017, 33591, 57166]`. Confirm review focus items 1 and 3, and that there is no horizontal scroll.
- [ ] **Step 4: Commit** with `feat: Make home pass cards say why, where and what to tune`.

---

### Task 3: First visit and the flat map's opening view

**Files:**
- Modify:
  - `components/home/HomeApp.tsx`;
  - `components/home/LocationPrompt.tsx` (PopularList button tiers);
  - `lib/home/prefs.mjs` (the default mode becomes `'visual'`);
  - `lib/map/view.mjs` (`homeCamera` flat with `points`);
  - `components/home/FlatMap.tsx` (passes current positions as `points`);
  - `app/home.css`;
  - tests.

**Interfaces:**
- **`homeCamera('flat', { observer, focus, width, height, points })`:** `points` is an array of `{ lonDeg, latDeg }` for the current satellite positions.
  - With no focus, the centre longitude is the circular mean of the observer and `points`.
  - The zoom is the current rule, lowered just enough that every point's longitude falls inside the view width (with a 5% margin), and never below `log2(width / 512)`. Latitude stays at the current home latitude.
  - With a focus, it behaves as today.

- [ ] **Step 1: Write the failing tests:**
  - **`homeCamera` flat:**
    - two points at lon -170 and 170 give a centre near ±180, not 0;
    - points spread 300° apart give a zoom equal to the floor;
    - no points behaves as today.
  - **Prefs:** `defaultPrefs().mode` is `'visual'`, and a saved `'radio'` stays radio.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement**, including the phone first-visit layout (location card before the map, map capped at 40vh while there is no location) and the PopularList tiers.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds.
- [ ] **Step 5: Do the screenshot check:**
  - a first visit with no localStorage at 360 and 390 px: the location card is fully visible without scrolling;
  - home at 1440 px with the four default satellites: their dots are visible.
- [ ] **Step 6: Commit** with `feat: Put location first for new visitors and frame the satellites on the map`.

---

### Task 4: Satellite page and polar captions

**Files:**
- Modify:
  - `components/sat/SatApp.tsx`;
  - `components/sat/PassSection.tsx` (or a new small `NextPassLine` component);
  - `app/sat.css`;
  - `components/passes/SkyChartModalView.tsx` (the caption);
  - `components/live/LiveDial.tsx` (the caption);
  - `components/passes/PolarPlotSvg.tsx` (the accessible name and title).

**What to build (spec "Satellite page on phones" and "East and west"):**
- **Next pass line:** under the title, with a chart button that follows the mode.
- **Stat tiles:** a `<details>` labelled "Live numbers" under 600 px, closed by default.
- **Polar captions:** "Looking up (east on the left)" on the sky chart and card plots, and "Compass view (north up)" on the live dial.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds.
- [ ] **Step 3: Do the screenshot check:**
  - `/sat/25544` at 390 px: the next pass line is on the first screen;
  - the sky chart and live view captions are present;
  - both themes.
- [ ] **Step 4: Commit** with `feat: Lead satellite pages with the next pass and label polar views`.
