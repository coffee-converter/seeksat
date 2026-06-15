# Onboarding Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-visit guided tour (driver.js) over the core flow — pick a satellite → set location → read passes → scrub time — shown once via a `localStorage` flag, replayable from the About pane.

**Architecture:** A pure `lib/onboarding/tour.js` holds the step content + injectable-storage show-once logic (unit-tested). A client `OnboardingTour` component auto-starts the tour once the loader has faded (gated on `firstSearchComplete`, with a fallback timer), dynamically importing driver.js; it also starts on a `seeksat:start-tour` window event. The About pane dispatches that event to replay.

**Tech Stack:** Next.js App Router, React 19, `driver.js` (new dep), `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-14-onboarding-walkthrough-design.md`

---

## File Structure

- **Add** `lib/onboarding/tour.js` — `STORAGE_KEY`, `TOUR_STEPS`, `safeLocalStorage`, `shouldShowTour`, `markTourDone`.
- **Add** `components/OnboardingTour.tsx` — driver.js orchestration (auto-start + replay).
- **Add** `test/onboarding-tour.test.mjs`.
- **Modify** `package.json` (driver.js), `components/PassFinderApp.tsx` (mount), `components/AboutPane.tsx` (replay link), `app/pass-finder.css` (driver dark theme + replay button).

---

## Task 1: Add the driver.js dependency

**Files:** Modify `package.json`, `package-lock.json`.

- [ ] **Step 1: Install**

Run: `npm install driver.js`
Expected: adds `driver.js` to `dependencies` and updates the lockfile.

- [ ] **Step 2: Confirm the import resolves**

Run: `node -e "import('driver.js').then(m => console.log(typeof m.driver))"`
Expected: prints `function`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add driver.js for the onboarding tour"
```

---

## Task 2: `lib/onboarding/tour.js` — content + show-once logic

**Files:** Create `lib/onboarding/tour.js`; Test `test/onboarding-tour.test.mjs`.

- [ ] **Step 1: Write the failing test**

Create `test/onboarding-tour.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, TOUR_STEPS, shouldShowTour, markTourDone } from '../lib/onboarding/tour.js';

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('shouldShowTour: usable storage with key unset -> true', () => {
  assert.equal(shouldShowTour(fakeStorage()), true);
});

test('shouldShowTour: key set -> false', () => {
  assert.equal(shouldShowTour(fakeStorage({ [STORAGE_KEY]: '1' })), false);
});

test('shouldShowTour: null (unusable) storage -> false', () => {
  assert.equal(shouldShowTour(null), false);
});

test('markTourDone sets the key, so shouldShowTour then returns false', () => {
  const s = fakeStorage();
  markTourDone(s);
  assert.equal(s.getItem(STORAGE_KEY), '1');
  assert.equal(shouldShowTour(s), false);
});

test('markTourDone swallows storage errors', () => {
  const throwing = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  assert.doesNotThrow(() => markTourDone(throwing));
});

test('TOUR_STEPS: first is the unanchored welcome; all have title + description', () => {
  assert.ok(TOUR_STEPS.length >= 5);
  assert.equal(TOUR_STEPS[0].element, undefined);
  for (const s of TOUR_STEPS) {
    assert.ok(s.title && s.title.length > 0, 'title');
    assert.ok(s.description && s.description.length > 0, 'description');
    if (s.element !== undefined) {
      assert.ok(typeof s.element === 'string' && s.element.length > 0, 'element selector');
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/onboarding-tour.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `lib/onboarding/tour.js`**

```js
// lib/onboarding/tour.js — onboarding tour content + show-once logic.
// Pure: storage is injectable so the gating is unit-testable without a
// browser, and unavailable storage (private mode / SSR) degrades to
// "don't show" without throwing.

// Versioned: bump the suffix to re-trigger the tour after a material change.
export const STORAGE_KEY = 'seeksat_onboarding_v1';

// Ordered steps. A step with no `element` renders as a centered modal.
// Selectors target existing PassFinderApp anchors.
export const TOUR_STEPS = [
  {
    title: 'Welcome to SeekSat',
    description: 'A 30-second tour of how to see when satellites pass over you.',
  },
  {
    element: '#satellite-details',
    title: 'Pick a satellite',
    description: 'Defaults to the ISS — five to choose from, from bright stations to a polar weather sat.',
  },
  {
    element: '#observers-details',
    title: 'Set your location',
    description: 'Click the globe, or add an observer station, to choose where you are watching from.',
  },
  {
    element: '#windows-section',
    title: 'Your passes',
    description: 'Upcoming passes appear here, each scored by how good a view it is.',
  },
  {
    element: '.passes-controls',
    title: 'Tune the search',
    description: 'Switch between visual and radio passes, and set a minimum elevation.',
  },
  {
    element: '#bottom-controls',
    title: 'Watch it fly',
    description: 'Scrub time to follow a pass across the sky. Building an agent? Query all of this over our MCP — the ⓘ button, top-right.',
  },
];

// window.localStorage when usable, else null. Probes with a write because
// Safari private mode exposes localStorage but throws on setItem.
export function safeLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probe = '__seeksat_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function shouldShowTour(storage = safeLocalStorage()) {
  if (!storage) return false;
  try {
    return storage.getItem(STORAGE_KEY) == null;
  } catch {
    return false;
  }
}

export function markTourDone(storage = safeLocalStorage()) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, '1');
  } catch {
    /* storage full / blocked — silently skip */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/onboarding-tour.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/onboarding/tour.js test/onboarding-tour.test.mjs
git commit -m "feat(onboarding): pure tour steps + show-once storage logic"
```

---

## Task 3: `OnboardingTour` component + mount + theme

**Files:** Create `components/OnboardingTour.tsx`; Modify `components/PassFinderApp.tsx`, `app/pass-finder.css`.

- [ ] **Step 1: Create `components/OnboardingTour.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import { TOUR_STEPS, shouldShowTour, markTourDone } from "@/lib/onboarding/tour.js";
import "driver.js/dist/driver.css";

// Renders nothing; orchestrates the driver.js onboarding tour. Auto-starts
// once on first visit after the page loader has faded, and re-starts on a
// `seeksat:start-tour` window event (the About pane's "Replay" link).
export default function OnboardingTour() {
  const firstSearchComplete = usePassFinderStore((s) => s.firstSearchComplete);
  const startedRef = useRef(false);

  const startTour = useCallback(async () => {
    // Mark done on open: seeing the tour counts, so closing early won't
    // re-trigger it next load. Replay always works via the event.
    markTourDone();
    try {
      const { driver } = await import("driver.js");
      const steps = TOUR_STEPS
        .filter((s) => !s.element || document.querySelector(s.element))
        .map((s) => ({
          element: s.element,
          popover: { title: s.title, description: s.description },
        }));
      if (steps.length === 0) return;
      driver({ showProgress: true, popoverClass: "driverjs-theme", steps }).drive();
    } catch {
      /* driver.js failed to load — no tour, no crash */
    }
  }, []);

  // Auto-start once: when the loader has faded (firstSearchComplete), or
  // after a fallback delay so the tour still appears if no search runs.
  useEffect(() => {
    if (startedRef.current || !shouldShowTour()) return;
    const begin = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      startTour();
    };
    if (firstSearchComplete) {
      begin();
      return;
    }
    const fallback = setTimeout(begin, 6000);
    return () => clearTimeout(fallback);
  }, [firstSearchComplete, startTour]);

  // Replay on demand (About pane dispatches this).
  useEffect(() => {
    const onReplay = () => startTour();
    window.addEventListener("seeksat:start-tour", onReplay);
    return () => window.removeEventListener("seeksat:start-tour", onReplay);
  }, [startTour]);

  return null;
}
```

- [ ] **Step 2: Mount it in `components/PassFinderApp.tsx`**

Add the import with the other component imports (near `import AboutPane from "@/components/AboutPane";`):

```tsx
import OnboardingTour from "@/components/OnboardingTour";
```

Add `<OnboardingTour />` immediately after the existing `<AboutPane />` line (around line 97):

```tsx
      <AboutPane />
      <OnboardingTour />
```

- [ ] **Step 3: Theme driver.js for the dark UI in `app/pass-finder.css`**

Append (driver.js's default popover is light; these overrides match the dark-glass palette):

```css
/* driver.js onboarding tour — dark theme */
.driver-popover.driverjs-theme {
  background: #0c1322; color: #cfe0ff;
  border: 1px solid rgba(255,255,255,0.14); border-radius: 12px;
  box-shadow: 0 18px 60px rgba(0,0,0,0.6);
}
.driver-popover.driverjs-theme .driver-popover-title { color: #eaf1ff; font-size: 16px; }
.driver-popover.driverjs-theme .driver-popover-description { color: #cfe0ff; opacity: 0.9; }
.driver-popover.driverjs-theme .driver-popover-progress-text { color: #9fb4da; }
.driver-popover.driverjs-theme button {
  background: rgba(90,140,255,0.18); color: #dce9ff;
  border: 1px solid rgba(126,184,255,0.4); border-radius: 6px;
  text-shadow: none; font-size: 13px;
}
.driver-popover.driverjs-theme button:hover { background: rgba(90,140,255,0.3); }
.driver-popover.driverjs-theme .driver-popover-arrow { border-color: #0c1322; }
```

(The `driver()` call in Step 1 already sets `popoverClass: "driverjs-theme"`, so these rules apply — no further component edit needed here.)

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add components/OnboardingTour.tsx components/PassFinderApp.tsx app/pass-finder.css
git commit -m "feat(onboarding): driver.js tour component, auto-start + replay"
```

---

## Task 4: Replay link in the About pane

**Files:** Modify `components/AboutPane.tsx`, `app/pass-finder.css`.

- [ ] **Step 1: Add the replay button**

In `components/AboutPane.tsx`, immediately after the `<p className="about-links">…</p>` block (which contains the "Full API docs →" link) and before `<p className="about-stack">…`, add:

```tsx
            <button
              type="button"
              className="about-replay"
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(new Event("seeksat:start-tour"));
              }}
            >
              Replay walkthrough
            </button>
```

(`setOpen` is already in scope in `AboutPane`.) This is decoupled — `AboutPane` does not import `OnboardingTour`; they communicate only via the event.

- [ ] **Step 2: Style it in `app/pass-finder.css`**

Append:

```css
.about-replay {
  display: inline-block; margin: 2px 0 12px; cursor: pointer;
  background: transparent; border: 0; padding: 0;
  color: #7eb8ff; font: inherit; font-size: 13px; text-decoration: underline;
}
.about-replay:focus-visible { outline: 2px solid rgba(126,184,255,0.7); outline-offset: 2px; }
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/AboutPane.tsx app/pass-finder.css
git commit -m "feat(onboarding): replay walkthrough from the About pane"
```

---

## Task 5: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass (including the new `onboarding-tour` suite); typecheck + build clean.

- [ ] **Step 2: Manual smoke (`npm run dev`)**

- Fresh visit (clear `localStorage` or use a private window): after the loader fades, the tour auto-starts at the centered Welcome step, then walks the satellite selector, observers, passes, controls, and playback. Next/Prev/Done and the progress text are dark-themed and readable.
- Reload: the tour does **not** re-appear (flag set).
- Open the **ⓘ** About pane → "Replay walkthrough" closes the pane and restarts the tour.
- Skipping/closing the tour early still prevents auto-show on the next reload.
- `localStorage` key `seeksat_onboarding_v1` is present after the tour opens.

- [ ] **Step 3: Final commit (only if manual fixups were needed)**

```bash
git add -A
git commit -m "chore(onboarding): walkthrough verification fixups"
```

---

## Notes for the implementer

- **No React/route test harness** — the component + driver.js wiring are verified by typecheck + build + the manual smoke; only the pure `lib/onboarding/tour.js` gets `node:test`.
- **CSS import is static, JS import is dynamic.** `import "driver.js/dist/driver.css"` at the top of the component (Next.js resolves CSS at build time; a dynamic CSS import would not inject styles). The driver.js **JS** is dynamically imported inside `startTour` so it stays out of the initial bundle and never runs during SSR.
- **Mark-on-open is intentional** (per spec) — opening the tour calls `markTourDone()` so an early close doesn't re-trigger it; the About-pane replay path ignores the flag.
- **Decoupling:** `AboutPane` and `OnboardingTour` communicate only through the `seeksat:start-tour` window event — neither imports the other.
- **Defensive steps:** steps whose target element isn't in the DOM are filtered out before `drive()`, so a future layout change degrades gracefully instead of erroring.
