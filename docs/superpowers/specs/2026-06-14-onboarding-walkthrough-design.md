# Onboarding Walkthrough — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)
**Branch:** `seeksat-onboarding-walkthrough`, stacked on `seeksat-discoverability` (the tour references UI from the selector + About-pane work).

## Purpose

A first-visit guided tour that walks a new user through the core flow — pick a satellite → set a viewing location → read the scored passes → scrub time — then never shows again unless replayed. The standard "show once, gated by a `localStorage` flag" onboarding pattern. Lowers the bar for first-time visitors and reviewers landing on a feature-dense globe.

## Background / current state

- `components/PassFinderApp.tsx` is a `"use client"` composition root. Its JSX skeleton renders these anchorable elements immediately on mount (they exist before Cesium finishes loading): `#panel-left`, `#windows-section`, `.passes-controls`, `#satellite-details`, `#observers-details`, `#bottom-controls`, `#panel-toggle`, plus the `.about-button` (Spec C).
- A `PageLoader` (driven by `firstSearchComplete`) covers the scene until the first search completes.
- `components/AboutPane.tsx` (Spec C) is the natural home for a "Replay walkthrough" link.
- No tour/onboarding library is present. The repo prefers minimal dependencies but uses substantial ones where justified (Cesium, satellite.js).
- Tests: `node:test` over pure `.mjs`/`.js`; components via typecheck + build + manual.

## Approach

Use **`driver.js`** (MIT, ~5kb, framework-agnostic) for the spotlight + popover + step navigation + responsive positioning, driven by CSS selectors against the existing element IDs. A hand-rolled tour would re-implement spotlight masking, popover positioning, and resize handling — fiddly and easy to get subtly wrong — so a focused library is the right call here. driver.js ships its own CSS; a small override block themes it to match the dark-glass UI.

## Components

### 1. `lib/onboarding/tour.js` (pure, new)

The tour content + show-once logic, with storage injected so it is unit-testable without a browser.

```
STORAGE_KEY = 'seeksat_onboarding_v1'   // versioned: bump to re-trigger after a material change

TOUR_STEPS = [
  // { element?: cssSelector, title, description }. element omitted => centered modal.
  { title: 'Welcome to SeekSat', description: 'A 30-second tour of how to see when satellites pass over you.' },
  { element: '#satellite-details', title: 'Pick a satellite', description: 'Defaults to the ISS; five to choose from.' },
  { element: '#observers-details', title: 'Set your location', description: 'Click the globe or add an observer station.' },
  { element: '#windows-section', title: 'Your passes', description: 'Upcoming passes, scored by visibility.' },
  { element: '.passes-controls', title: 'Tune the search', description: 'Visual vs radio, and a minimum elevation.' },
  { element: '#bottom-controls', title: 'Watch it fly', description: 'Scrub time to follow a pass. Agents can query all of this via our MCP (the ⓘ button).' },
]

shouldShowTour(storage = safeLocalStorage()) -> boolean   // true iff storage is usable AND key unset
markTourDone(storage = safeLocalStorage()) -> void          // set the key; never throws
```

- `shouldShowTour` returns `false` when storage is unavailable (private mode / SSR) — degrade to "don't show", never throw.
- `markTourDone` writes the key inside try/catch — a storage failure is a silent no-op.
- `safeLocalStorage()` returns `window.localStorage` when available, else `null`; the helpers treat `null` as "unusable".
- `TOUR_STEPS` is exported for both the component and tests.

### 2. `components/OnboardingTour.tsx` (client, new)

Renders nothing visible itself; orchestrates driver.js.

- On mount: if `shouldShowTour()` **and** the page loader has finished (gate on the store's `firstSearchComplete`, or a short fallback timeout if no search runs), start the tour. Starting calls `markTourDone()` immediately (a user who opens the tour has "seen" it; closing/finishing won't re-trigger next load).
- Build the driver with `TOUR_STEPS` mapped to driver.js's step shape (`element`, `popover: { title, description }`); steps whose target element is missing are skipped defensively.
- On destroy/finish/close → ensure `markTourDone()` (idempotent).
- Listens for a `window` event `seeksat:start-tour` → start the tour regardless of the flag (replay). Removes the listener on unmount.
- Dynamic-import `driver.js` inside the start path so its code/CSS aren't in the initial bundle and never run during SSR.
- Mounted once in `PassFinderApp` (e.g. alongside `<AboutPane />`).

### 3. Replay trigger (modify `components/AboutPane.tsx`)

Add a "Replay walkthrough" button/link in the About modal that calls `window.dispatchEvent(new Event('seeksat:start-tour'))` and closes the modal. Decoupled from `OnboardingTour` via the event — neither imports the other.

### 4. Styling

Import driver.js's stylesheet, plus a small override (in `app/pass-finder.css` or a dedicated `app/onboarding.css` imported by the component) theming the popover to the dark-glass palette: dark popover background, light text, accent "Next/Done" buttons matching `.about-copy`, and a readable progress/close affordance.

## Data flow

```
first load → OnboardingTour mount → shouldShowTour() && loader done?
   └ yes → markTourDone() → dynamic import driver.js → run TOUR_STEPS
About pane "Replay" → dispatch 'seeksat:start-tour' → OnboardingTour starts the tour
tour finish/close → (already marked done) → no re-trigger next load
```

## Error handling

- `localStorage` unavailable (private mode, SSR) → `shouldShowTour` false, `markTourDone` no-op; the app behaves exactly as before.
- A target element missing (e.g. layout change) → that step is skipped; the tour continues rather than erroring.
- `driver.js` dynamic import failure → caught and ignored; no tour, no crash.

## Testing

`node:test` (pure, `lib/onboarding/tour.js`):
- `shouldShowTour`: unset key + usable storage → true; set key → false; `null` storage → false.
- `markTourDone`: sets the key; a throwing storage stub does not propagate.
- `TOUR_STEPS`: every step has non-empty `title` + `description`; every `element` (when present) is a non-empty string; the first step is the unanchored welcome.

`OnboardingTour` + driver.js wiring + the About-pane replay link: typecheck + `next build` + manual (fresh load shows the tour once; reload doesn't; "Replay walkthrough" re-runs it; Skip/close sets the flag).

## Out of scope

- Per-step branching / interactive "do this now" gating (the tour is informational, not blocking).
- Special mobile choreography beyond driver.js's responsive positioning.
- A/B copy variants or analytics on tour completion (the usage-logging seam is MCP-only).
- Re-triggering on app updates beyond the manual `STORAGE_KEY` version bump.

## Files affected

- **Add:** `lib/onboarding/tour.js`, `components/OnboardingTour.tsx`, `test/onboarding-tour.test.mjs`. Possibly `app/onboarding.css`.
- **Modify:** `components/PassFinderApp.tsx` (mount `<OnboardingTour />`), `components/AboutPane.tsx` (Replay link), `app/pass-finder.css` (driver theme overrides, if not a separate file), `package.json` (`driver.js` dependency).
