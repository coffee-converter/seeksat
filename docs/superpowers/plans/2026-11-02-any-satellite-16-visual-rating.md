# Visual Pass Rating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In visual mode, rate each pass Good/OK/Low from peak brightness against how dark the sky is (with a sky-type picker) and against the cloud forecast, show the peak magnitude where it is known, and stop the charts inventing magnitudes.

**Architecture:**
- **`lib/sky/visual-rating.mjs`:** pure functions for the limiting magnitude, extinction and the rating.
- **The pass engine:** adds the peak magnitude and Sun altitudes to visual passes.
- **The UI:** passes a context (sky type, cloud) into one shared badge.

**Tech Stack:** Next.js 15, React, `node --test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-visual-rating-design.md`. It is the authority; its numbers are exact.

## Global Constraints

- **Unchanged:** radio mode and the MCP route.
- **Network:** never call CelesTrak.
- **Copy:** plain language, no em dashes. Magnitudes use U+2212 for the minus sign, with one decimal.
- **Colour:** colours come from tokens (`test/theme-css.test.mjs`).
- **Honesty:** no magnitude is ever shown or computed for a satellite without `standardMag`.
- **Tests and commits:** `npm test` and `npx tsc --noEmit`. Conventional commits, with no AI attribution lines.

## Review Focus

See the spec's "Review focus" (items 1-5). Items 1 and 3 are pinned in Tasks 1 and 2, item 2 in Tasks 2 and 3, item 4 in Task 1, and item 5 in Task 1.

---

### Task 1: Rating functions and the sky-type preference

**Files:**
- Create: `lib/sky/visual-rating.mjs`, `test/visual-rating.test.mjs`
- Modify: `lib/home/prefs.mjs`, `test/home-prefs.test.mjs`

**Interfaces:**
- **`SKY_TYPES`:** `[{ id: 'city', label: 'City', limit: 3.5 }, { id: 'suburban', label: 'Suburban', limit: 4.5 }, { id: 'rural', label: 'Rural', limit: 5.5 }, { id: 'dark', label: 'Dark site', limit: 6.5 }]`.
- **`DEFAULT_SKY = 'suburban'`.**
- **`limitingMag(sunAltDeg, skyType) -> number`:** `min(naturalSkyLimMag(sunAltDeg), limit)`.
- **`extinctionMag(elDeg) -> number`:** `0.2 * (1 / sin(max(el, 5°)) - 1)`.
- **`visualQuality(pass, { skyType, cloud }) -> { level: 'good' | 'ok' | 'low', label: 'Good' | 'OK' | 'Low', reason: string }`:**
  - **Inputs:** `pass` may carry `peakMag` (a number, or null when unknown), `peakMagSunAltDeg`, `maxElevDeg` and `peakSunAltDeg`. `cloud` is the badge from `cloudBadge` (`{ level: 'clear' | 'some' | 'cloudy' }`) or null.
  - **Known magnitude:** use the headroom rule from the spec.
  - **Unknown magnitude:** use `passQuality(pass)` (`lib/passes/quality.mjs`), and drop one level when `peakSunAltDeg > -12`.
  - **Cloud:** then apply the cloud cap or step.
  - **Reason text:** as in the spec's examples. Known: `Peak mag −2.1, about N magnitudes brighter than the faintest stars you can see.`, with N rounded to a whole number and the singular form for 1. Unknown: `Brightness unknown, so this is rated on height and sky darkness.` Then add ` Cloudy forecast.` or ` Some cloud forecast.` when it applies.
- **`formatMag(m) -> string`:** for example `−2.1` (U+2212), or `0.5`.
- **Prefs:** `skyType`, defaulting to `'suburban'`. It is sanitised against `SKY_TYPES` ids.

- [ ] **Step 1: Write the failing tests:**
  - **The spec's Review focus item 3:**
    - City, ISS peak -1.8 at full dark: headroom about 5.3, Good.
    - City, Hubble 2.0 at sun -12: `limitingMag(-12, 'city') = 3.5`, headroom 1.5, OK.
  - **Boundaries:** headroom 3.0 is Good, 2.99 is OK, 1.5 is OK, 1.49 is Low.
  - **Unknown magnitude:**
    - max 45° with sun -15 is Good;
    - max 45° with sun -8 is OK;
    - max 15° with sun -8 is Low (it never drops below Low).
  - **Cloud:** Cloudy turns Good into Low; Some cloud turns Good into OK and OK into Low; a null cloud changes nothing.
  - **Reason strings:** exact strings for one known and one unknown case, with and without cloud.
  - **`formatMag`:** -2.1 gives `−2.1` and 0.5 gives `0.5`.
  - **Prefs:** `parsePrefs` with `skyType: 'nonsense'` gives `'suburban'`; `'dark'` stays `'dark'`.
- [ ] **Step 2: Run** `node --test test/visual-rating.test.mjs test/home-prefs.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `feat: Rate visual passes on brightness, sky darkness and cloud`.

---

### Task 2: Peak magnitude in the pass engine

**Files:**
- Modify: `lib/passes/engine.mjs`, and its test (find the engine test file, such as `test/passes-engine.test.mjs`).

**Interfaces:**
- **Visual-mode passes** gain these fields:
  - `peakMag`: the brightest extinction-corrected magnitude over about 10 s samples where the satellite is sunlit and every observer's Sun is at or below the existing twilight threshold. It is null when `track.standardMag` is null or no sample qualifies.
  - `peakMagSunAltDeg` and `peakMagElDeg`: that sample's Sun altitude and elevation, for observers[0].
  - `peakSunAltDeg`: the observers[0] Sun altitude at `peakMs`.
- **Radio-mode passes:** unchanged. Do not add the fields, or set them to null; pick one and say which.
- **Reuse:** `magnitudeAt` from `lib/pass-finder/ratings.js`, `extinctionMag` from Task 1, and the existing `satIlluminated`, `sunPositionEcef` and `sunAltitudeDeg` helpers already imported by the engine.

- [ ] **Step 1: Write the failing tests:**
  - **ISS fixture, visual mode:** at least one pass, with `peakMag` a finite number between -4 and 3; `peakMagSunAltDeg` at or below the twilight threshold; `peakMagElDeg` between 0 and 90.
  - **A track with `standardMag: null`** (same TLE): `peakMag` is null and the other fields are still present.
  - **Twilight pass:** a pass whose peak elevation happens in sunlit sky but which later runs into darkness gets `peakMag` from the dark part. Build it with a fixture or a stubbed track if the ISS fixture has none, and say how.
- [ ] **Step 2: Run** the engine test. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the extra sampling cost small: only for visual passes, at a 10 s step.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `feat: Find each visible pass's peak magnitude`.

---

### Task 3: UI, sky picker and the chart honesty fix

**Files:**
- Modify:
  - `components/passes/QualityBadge.tsx` (accept an optional rating context);
  - `components/home/NextUpList.tsx`, `components/sat/PassSection.tsx` and `components/home/Timeline.tsx` (use `visualQuality` in visual mode with the sky type and cloud badge; show `mag …` when known);
  - `components/home/HomeControls.tsx` (the sky select, visual mode only);
  - `components/home/HomeApp.tsx` and `components/sat/SatApp.tsx` (prefs wiring);
  - `lib/passes/charts.js` and `lib/passes/card-chart.js` (no `DEFAULT_STD_MAG` fallback);
  - `app/home.css` and `app/sat.css`.

**Interfaces:**
- **`<QualityBadge pass rating? />`:** `rating`, when given (from `visualQuality`), replaces `passQuality(pass)`. Callers pass it in visual mode only.
- **Magnitude text:** `mag {formatMag(pass.peakMag)}` after `max N°`, only when `mode === 'visual' && pass.peakMag != null`.
- **Sky select:**
  - `<select aria-label="Sky type">` with `SKY_TYPES`, input tier, beside Min elevation, shown only in visual mode.
  - It writes prefs `skyType`. The satellite page uses the same pref.
- **Charts:** where they call `magnitudeAt(..., track.standardMag ?? DEFAULT_STD_MAG)`, skip magnitude when `standardMag` is null and fall back to the unrated styling.

- [ ] **Step 1: Write the failing tests:**
  - **A chart test:** for a track with `standardMag: null`, the card-chart or charts magnitude helper returns null, or the code path does not call `magnitudeAt`. Find the smallest testable seam; if there is none, extract a tiny pure helper (`magFor(track, …)`) and test it.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** everything above.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds.
- [ ] **Step 5: Do the screenshot check** with `npx next start -p 3461` and Playwright, in visual mode, Chicago.
  - Follow ISS (known) and NOAA-19 (unknown).
  - **Cards and rows:** ISS shows `mag −…` and NOAA-19 shows none. The badge tooltips read as in the spec.
  - **Sky type:** switching City to Dark site changes at least one rating, or the tooltip headroom.
  - **Radio mode:** unchanged, with no sky select.
  - Capture at 390 and 1440 px.
- [ ] **Step 6: Commit** with `feat: Show peak magnitude and a sky type picker for visual passes`.
