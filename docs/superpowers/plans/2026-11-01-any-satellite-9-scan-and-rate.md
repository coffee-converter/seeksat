# Scannable Passes, Quality Rating and Next Pass First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "when is the next pass, and is it any good" answerable at a glance: a quality badge on every pass, satellite-page pass rows you can scan, and the next pass shown above the map on phones.

**Architecture:**
- **Pure helpers** go in `lib/`:
  - the quality rating;
  - day grouping of pass rows;
  - the next-pass summary.
- **Display** goes in small components:
  - a `QualityBadge`;
  - the reworked rows in `PassSection`;
  - a `NextStrip` in the home page's map slot.
- **CSS** hides the strip once the panel sits beside the map (1100 px and up).

**Tech Stack:** Next.js 15 App Router, React, `node --test`, Playwright (system Chrome) for the screenshot check.

**Spec:** `docs/superpowers/specs/2026-10-30-any-satellite-tracker-design.md`. Aaron approved these three items on 2026-11-01 from a UI review:
1. Pass rows you can scan.
2. A quality rating.
3. The next pass first on phones.

A live pass view is a later plan.

## Global Constraints

- **Copy:** plain language, no em dashes. Badge labels are exactly `Good`, `OK`, `Low`.
- **Colour is never the only cue:** the badge always shows its word, and contrast stays at AA in both themes. Use the existing `--ok` and `--warn` tokens and `--muted`, with no new literals outside token definitions; `test/theme-css.test.mjs` enforces this.
- **Charts are untouched:** the sky and radio charts are out of scope.
- **Print:** the printed pass table is unchanged. New on-screen pieces are hidden in print, as `#passes` children already are.
- **No new network calls.** Never call CelesTrak from Aaron's laptop: local dev reads the Blob snapshot only.
- **Tests and commits:** `npm test` and `npx tsc --noEmit`. Conventional commit prefixes, no AI attribution lines.

## Review Focus

1. **A pass already in progress:** the strip says "up now", the row says "up now, until HH:MM", and the badge still shows. Pinned in Task 1 (summary test) and Task 2 (grouping keeps it under Today).
2. **Midnight and time zones:** a pass at 23:50 local is "Today" and one at 00:10 is "Tomorrow", in the observer's zone, not UTC. Pinned in Task 2.
3. **A shared pass more than two days out:** it stays visible, its row starts expanded, and it falls under the right day heading. Pinned in Task 2 (shared key opens the row).
4. **No pass cards** (all stationary, none, or missing): the strip renders nothing rather than an empty bar. Pinned in Task 3.
5. **Narrow phones (360 px):** a row's time, badge and direction fit on two lines with no horizontal scroll. Pinned in the Task 3 screenshot check.

---

### Task 1: Pass quality rating and badge

**Files:**
- Create: `lib/passes/quality.mjs`, `test/pass-quality.test.mjs`, `components/passes/QualityBadge.tsx`
- Modify:
  - `components/home/NextUpList.tsx`: the badge in `pass-card__meta`, before the `visible` tag;
  - `app/home.css`: the badge style.

**Interfaces:**
- Produces:
  - `passQuality(pass: { maxElevDeg: number }) -> { level: 'good' | 'ok' | 'low', label: 'Good' | 'OK' | 'Low', reason: string }`.
  - `<QualityBadge pass={pass} />` renders `<span className="quality quality--{level}" title={reason}>{label}</span>`.

**Thresholds (my call; ham convention puts "worth working" around 20 to 30 degrees):**

| Max elevation | Level | Reason |
|---|---|---|
| 40° or more | `good` | `"High pass, well clear of the horizon."` |
| 20° up to 40° | `ok` | `"Medium pass."` |
| Under 20° | `low` | `"Low pass, close to the horizon."` |

- [ ] **Step 1: Write the failing test `passQuality rates by max elevation`.** Assert the level for each of these:
  - `{ maxElevDeg: 75 }` is good;
  - `40` is good;
  - `39.9` is ok;
  - `20` is ok;
  - `19.9` is low;
  - `NaN` is low.

  Then assert the exact labels and reasons in the table above.
- [ ] **Step 2: Run** `node --test test/pass-quality.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `passQuality`, `QualityBadge` and the CSS.**
  - The badge is a small pill using `--ok`, `--warn` and `--muted`.
  - It appears on home cards here, and on satellite page rows in Task 2.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `feat: Rate each pass Good, OK or Low`.

---

### Task 2: Satellite page pass rows you can scan

**Files:**
- Modify:
  - `lib/sat/pass-rows.mjs`;
  - `components/sat/PassSection.tsx`;
  - `app/sat.css`;
  - `test/sat-pass-rows.test.mjs`.

**Interfaces:**
- Consumes: `QualityBadge` from Task 1, and the existing `initialRowCount`.
- Produces, in `pass-rows.mjs`:
  - `dayHeading(ms, nowMs, timeZone, locale) -> string`. It returns `"Today"` or `"Tomorrow"` by calendar day in `timeZone`, otherwise the row's `dayLabel` style (`"Wed 4 Nov"`).
  - `groupRowsByDay(rows, nowMs, timeZone, locale) -> Array<{ heading: string, rows: Row[] }>`. It keeps row order, and a row in progress belongs to Today.
  - Each row gains `fromLabel` (`compass(startAzDeg)`) and `toLabel` (`compass(endAzDeg)`), with the full `azLabel` kept for the title attribute.

**Row layout:**
- **Line 1:** `HH:MM to HH:MM`, or `up now, until HH:MM`, in bold tabular figures. Then the QualityBadge, then `max 37°`.
- **Line 2,** muted: `13m40s · N → SE`, then the existing tags (visible, shared pass, continues past).
- **Actions:**
  - `Sky chart` stays visible.
  - A `More` button (aria-expanded, aria-controls) reveals Radio chart, Share, Add to calendar and the bell.
  - The shared row starts expanded.
- **Day headings:** each group gets an `h3.sat-day`.
- **Paging:** the existing `Show all N passes` paging still applies across groups.

- [ ] **Step 1: Write the failing tests.**
  - **`dayHeading names today and tomorrow in the observer zone`:** with `now = 2026-11-02T03:00Z` and zone `America/Chicago` (local Nov 1, 21:00):
    - a pass at `2026-11-02T05:50Z` (23:50 local) gives `Today`;
    - `2026-11-02T06:10Z` (00:10 local, Nov 2) gives `Tomorrow`;
    - `2026-11-03T18:00Z` gives `Tue 3 Nov`, in locale `en-GB`.
  - **`groupRowsByDay keeps order and puts an in-progress pass under Today`.**
  - **`passRows adds from and to compass labels`:** an ISS fixture row has `fromLabel` and `toLabel` matching `compass()` of its azimuths.
- [ ] **Step 2: Run** `node --test test/sat-pass-rows.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement the helpers, then rework the row JSX and CSS in `PassSection.tsx` and `app/sat.css`.**
  - The `More` state is a `Set` of open row keys.
  - The shared key is open by default.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `feat: Group passes by day in rows you can scan`.

---

### Task 3: Next pass first on phones

**Files:**
- Create: `lib/home/next-strip.mjs`, `test/home-next-strip.test.mjs`, `components/home/NextStrip.tsx`
- Modify:
  - `components/home/HomeApp.tsx`: the strip goes above `FlatMap` in the `map` slot.
  - `components/home/SearchBar.tsx` and `app/home.css`: the Paste button becomes icon-only under 600 px.

**Interfaces:**
- Consumes: `cardHeadline` and `countdown` from `lib/home/next-up.mjs`, and `passQuality` from Task 1.
- Produces: `nextPassSummary(cards, nowMs) -> null | { noradId, name, text, pass }`.
  - It picks the pass card with the smallest `pass.startMs`.
  - Its `text` is the card headline.
- `<NextStrip summary onFocus />` renders a button reading `Next: {text}` with a QualityBadge.
  - It is hidden from 1100 px up, where the panel sits beside the map.
  - Tapping it calls `onFocus(noradId)` and scrolls `#next-up-title` into view.

**Paste button under 600 px:** the visible text becomes `+`. `aria-label` and `title` are `Paste elements`, so the accessible name is unchanged.

- [ ] **Step 1: Write the failing tests `nextPassSummary picks the soonest pass card` and `nextPassSummary is null with no pass cards`.**
  - The soonest pass wins, whatever the card order.
  - Stationary, none and missing cards are skipped.
  - An in-progress pass wins over a future one, and its text reads `ISS now, max 75°`.
- [ ] **Step 2: Run** `node --test test/home-next-strip.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement the summary, `NextStrip`, the HomeApp wiring, the Paste icon and the CSS.**
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds.
- [ ] **Step 5: Do the screenshot check** with `next start` and Playwright:
  - Capture `/` and `/sat/44909` at 360, 390 and 1440 px, in light and dark.
  - Confirm there is no horizontal scroll at 360, the strip shows on phones only, and the rows read on two lines.
  - Fix anything found, then repeat.
- [ ] **Step 6: Commit** with `feat: Show the next pass above the map on phones`.
