# UX Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four small, low-risk improvements from the 2026-11-02 UX review:
1. Passes come first on the satellite page.
2. Home cards have fewer buttons.
3. "Up now" shrinks to one line when nothing is up.
4. An accessibility pass covering focus traps, labelled More buttons, azimuth shown on screen, and compass feedback.

**Architecture:**
- **No new physics and no new network calls.**
- One shared `MoreToggle` component replaces the ad hoc More disclosure on satellite-page rows and adds one to home cards.
- One `useFocusTrap` hook backs all three pass dialogs.
- Pure helpers stay in `lib/` with `node --test` coverage.

**Tech Stack:** Next.js 15 App Router, React, `node --test`, Playwright (system Chrome) for the screenshot check.

**Spec:** `docs/superpowers/specs/2026-10-30-any-satellite-tracker-design.md`.
- Aaron approved items 1, 4, 5 and 7 of the UX list on 2026-11-02 ("sounds good").
- Items 6 (limit Centered on you) and 8 (fewer phone city labels) are dropped: the map is moving to MapLibre in a separate plan.

## Global Constraints

- **Copy:** plain language, no em dashes.
- **Theme:** colours come from existing tokens only; `test/theme-css.test.mjs` enforces this.
- **Print:** printed output is unchanged. New on-screen pieces are hidden in print, as the existing `.pass-card__actions` are.
- **No new network calls.** Never call CelesTrak from Aaron's laptop.
- **Tests and commits:** `npm test` and `npx tsc --noEmit`. Conventional commits, with no AI attribution lines.

## Review Focus

1. **The shared pass row:** on a satellite page opened from a share link, the shared row's More panel starts open, as it does today. Pinned in Task 2 (`isRowOpen` is still used, and its test is unchanged).
2. **Keyboard users:** in each dialog (sky, radio, live), Tab from the last control goes to the first, and Shift+Tab from the first goes to the last. On close, focus returns to the button that opened the dialog. Pinned in Task 4 (`nextFocusIndex` tests) and checked in Task 5.
3. **No cards yet** (location just set, passes still computing): "Up now" with nothing up shows "Nothing you follow is up right now." with no "Next:" part, never "Next: null". Pinned in Task 3.
4. **Compass in landscape:** a phone held landscape-left (`screen.orientation.angle` 90) reports the heading the top of the screen faces. Pinned in Task 4.
5. **Narrow phones (360 px):** the cards' action rows and the expanded More panels wrap without horizontal scroll. Checked in Task 5.

---

### Task 1: Passes first on the satellite page

**Files:**
- Modify: `components/sat/SatApp.tsx` (the panel JSX around lines 300-336)

The new panel order is:
1. header;
2. shared banner;
3. `DashboardTiles`;
4. `PassSection`;
5. `ElementsTable`;
6. `OrbitDiagram`;
7. `Downlinks`;
8. `RawElements`;
9. `HowWeCompute`.

When the elements are unusable, `AgeLine` and the "can't be used" note stay where the tiles would be. Nothing else changes: the props are the same and no CSS changes.

- [ ] **Step 1: Move the JSX.** Keep the `usable && liveNow && elementsNow` condition around the tiles. Wrap `ElementsTable` and `OrbitDiagram` in a second block with the same condition, after `PassSection`.
- [ ] **Step 2: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 3: Commit** with `feat: Show passes before the orbit details on satellite pages`.

---

### Task 2: A shared More toggle, and fewer buttons on home cards

**Files:**
- Create: `components/passes/MoreToggle.tsx`
- Modify:
  - `components/sat/PassSection.tsx` (the row actions, about lines 410-445);
  - `components/home/NextUpList.tsx` (the `PassCard` actions, about lines 188-200, plus open state in the list);
  - `app/home.css` and `app/sat.css` (move the `.sat-pass__more` rules to a shared `.more-panel` in `app/home.css`).

**Interfaces:**
- **Produces:** `<MoreToggle id open onToggle label>{children}</MoreToggle>`.
  - Props: `id: string`, `open: boolean`, `onToggle(): void`, `label: string` (what the actions are for, such as `"the 14:02 to 14:13 pass"`).
  - It renders a `home-chip` button and then `<div id={id} className="more-panel" hidden={!open}>{children}</div>`. The button has visible text `More` or `Less`, `aria-expanded`, and `aria-controls={id}`.
  - Its `aria-label` is `` `${open ? "Less" : "More"} actions for ${label}` ``. The accessible name starts with the visible word, as WCAG 2.5.3 requires.

**Satellite-page rows:**
- Replace the inline toggle with `MoreToggle`, using `label` = `` `the ${row.timesLabel} pass` ``.
- The open-state logic (`rowOpen`, `toggleRow`, `isRowOpen`, the shared key) is unchanged.

**Home cards:**
- **Visible:** `Live` (when `liveOk`), `Sky chart`, `Details` (when it is not a pasted satellite), and `More`.
- **Inside More:** `Radio chart`, Add to calendar, `AlertBell`, and `FollowChip`.
- **Open state:** a `Set<number>` of card `noradId`s held in `NextUpList`, all closed by default.
- **Label:** `` `the ${card.name} pass` ``.
- The focus headline and the plot are unchanged.

- [ ] **Step 1: Write `MoreToggle`** and switch PassSection's rows to it. Move the CSS to `.more-panel`, which keeps the existing `.sat-pass__more` look (flex wrap, gap), and delete the old rule.
- [ ] **Step 2: Rework the card actions** in `NextUpList.tsx` as above.
- [ ] **Step 3: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean. The existing `isRowOpen` tests in `test/sat-pass-rows.test.mjs` pass unchanged.
- [ ] **Step 4: Commit** with `feat: Put less-used pass actions behind More on home cards`.

---

### Task 3: "Up now" in one line when nothing is up

**Files:**
- Create: `lib/sky/up-now-line.mjs`, `test/up-now-line.test.mjs`
- Modify:
  - `components/home/UpNow.tsx`;
  - `components/home/HomeApp.tsx` (pass `next`);
  - `app/home.css` (`.up-now--empty`).

**Interfaces:**
- **Consumes:** `nextPassSummary(cards, nowMs)` from `lib/home/next-strip.mjs`. HomeApp already calls it for `NextStrip` (as `summarize(cardsNow(cardState, cardKey), nowMs)`). Compute it once and pass it to both.
- **Produces:** `emptyUpNowText(next: { text: string } | null) -> string`.
  - With null: `"Nothing you follow is up right now."`
  - With a summary: `` `Nothing you follow is up right now. Next: ${next.text}.` `` The trailing full stop is not doubled when `text` already ends in one.
- **UpNow props:** gains `next: { text: string } | null`.
  - When `up.length === 0`, the section gets the class `up-now up-now--empty`.
  - The body is a single `<p className="up-now__none">` with `emptyUpNowText(next)`.
  - The `h2` stays, for screen-reader navigation, but `.up-now--empty` lays the heading and text out on one line, inline, with reduced padding.

- [ ] **Step 1: Write the failing tests:**
  - `emptyUpNowText(null)` gives `"Nothing you follow is up right now."`
  - `emptyUpNowText({ text: "ISS in 4h 12m, max 37°" })` gives `"Nothing you follow is up right now. Next: ISS in 4h 12m, max 37°."`
  - `emptyUpNowText({ text: "ISS now." })` ends in `"ISS now."`, not `"ISS now.."`.
- [ ] **Step 2: Run** `node --test test/up-now-line.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the helper, the UpNow change, the HomeApp wiring and the CSS.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `feat: Collapse Up now to one line when nothing is up`.

---

### Task 4: Accessibility pass

**Files:**
- Create:
  - `lib/a11y/focus-trap.mjs`, `test/focus-trap.test.mjs`;
  - `components/passes/useFocusTrap.ts`.
- Modify:
  - `components/passes/SkyChartModalView.tsx`, `components/passes/RadioChartModalView.tsx`, `components/live/LiveView.tsx` (trap and compass);
  - `lib/sat/pass-rows.mjs`, `test/sat-pass-rows.test.mjs` (`directionText`);
  - `components/sat/PassSection.tsx` (show `directionText` in the More panel);
  - `lib/live/heading.mjs`, `test/live-heading.test.mjs` (screen angle).

**Interfaces:**
- **`nextFocusIndex(count: number, current: number, shift: boolean) -> number`:**
  - Tab moves to `current + 1`, wrapping to 0. Shift+Tab moves to `current - 1`, wrapping to `count - 1`.
  - `current` of -1 (focus is outside the dialog) gives 0, or `count - 1` with Shift.
  - `count` of 0 gives -1.
- **`useFocusTrap(ref: RefObject<HTMLElement>, active: boolean): void`:**
  - While active, Tab and Shift+Tab inside `ref` cycle through its enabled, visible focusable elements (`a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])`), using `nextFocusIndex`.
  - On activation it stores `document.activeElement`. On deactivation or unmount it calls `.focus()` on that element if it is still connected.
  - It replaces the per-dialog "focus the close button" effects only where they would conflict. Each dialog still focuses its close button first.
- **`directionText(pass) -> string`:** for example `"Rises in the N at 352°, sets in the SE at 131°"`. It uses `compass()` and `Math.round`.
- **`headingFromOrientation(e, screenAngleDeg = 0)`:** the existing result plus `screenAngleDeg`, normalised to [0, 360). Null stays null.

**Compass feedback in LiveView:**
- When permission is denied, show the status text `Compass permission was denied. Use the dial with north up.`
- When no non-null heading arrives within 3 s of turning the compass on, show `No compass reading. This device may not have one.`
- Both go in the existing status area, as plain text, not as an alert.
- Pass `screen.orientation?.angle ?? 0` to `headingFromOrientation`.

- [ ] **Step 1: Write the failing tests:**
  - `nextFocusIndex(3, 2, false)` gives 0.
  - `nextFocusIndex(3, 0, true)` gives 2.
  - `nextFocusIndex(3, -1, false)` gives 0.
  - `nextFocusIndex(3, -1, true)` gives 2.
  - `nextFocusIndex(0, -1, false)` gives -1.
  - `directionText({ startAzDeg: 352, endAzDeg: 131 })` gives `"Rises in the N at 352°, sets in the SE at 131°"`.
  - `headingFromOrientation({ webkitCompassHeading: 300 }, 90)` gives 30.
  - `headingFromOrientation({ absolute: true, alpha: 90 }, 90)` gives 0.
  - `headingFromOrientation({ absolute: false, alpha: 90 }, 90)` gives null.
- [ ] **Step 2: Run** `node --test test/focus-trap.test.mjs test/sat-pass-rows.test.mjs test/live-heading.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers, the hook, the hook's use in all three dialogs, `directionText` (as the first line of each row's More panel, as `<p className="sat-how">`), and the compass messages.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `feat: Trap focus in pass dialogs and label pass actions`.

---

### Task 5: Screenshot check

**Files:** none, unless fixes are needed.

- [ ] **Step 1: Build and check.** Run `npm run build`, then `npx next start -p 3461`. With Playwright and system Chrome:
  - Capture `/` (with ISS followed) and `/sat/25544` at 360, 390 and 1440 px, in light and dark.
  - Confirm on the satellite page that "Passes" sits above "Orbital elements".
  - Confirm home cards show at most four buttons when closed.
  - Confirm Up now is one line when nothing is up.
  - Confirm there is no horizontal scroll at 360 px.
  - In the sky dialog, press Tab past the last control and confirm focus wraps. Press Esc and confirm focus returns to `Sky chart`.
- [ ] **Step 2: Fix** anything found, rerun the check, and commit any fixes with `fix:` messages.
