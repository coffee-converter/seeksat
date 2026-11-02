# Live Pass View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Live" screen for a pass that is up or about to rise. It shows:
- where to point, with a compass dial and large azimuth and elevation figures;
- how long until the satellite rises, peaks or sets;
- the frequency to tune to right now, with the Doppler correction applied.

**Architecture:**
- **No new physics.** The live view samples the pass once with the existing `radioSeries` (purpose `csv`, 1 s steps), then interpolates those samples at the corrected clock (`trueNow`) four times a second.
- **Pure state:** `lib/live/live-state.mjs` turns the samples and the time into everything shown. `lib/live/heading.mjs` turns a phone's compass heading into a turn hint.
- **Where it lives:** the view is a third mode of `PassChartModals` (`chart === "live"`). It shares the lazy chunk, the subject and the frequency state with the sky and radio charts.
- **How to open it:** a `Live` button on satellite-page rows and home cards, shown when the pass is up or rises within 30 minutes.

**Tech Stack:** React, SVG, Screen Wake Lock API, DeviceOrientation (opt-in), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-30-any-satellite-tracker-design.md`. Aaron approved this on 2026-11-01 ("4 later yes", then "Go"), from a UI review that proposed: "a large compass and elevation pointer showing where to aim, a countdown until it sets, and the live receive frequency, already corrected for Doppler, for whoever is tuning a radio".

## Global Constraints

- **Copy:** plain language, no em dashes.
- **Honest numbers:** the tune frequency is labelled as a prediction, and the satellite's oscillator offset is unknown. The view shows the existing accuracy note when the pass has one.
- **Dial convention (my call):** the dial is a compass seen from above (N up, E right), as when holding a phone flat, and is labelled `Compass view` so it is not confused with the sky charts (looking up, E left).
- **Opt-in sensors:** the phone compass starts only after a tap on `Use phone compass`, which calls `DeviceOrientationEvent.requestPermission` where it exists (iOS). It degrades silently where there is no compass. The view never asks for location.
- **Wake lock:** the screen is kept awake while the view is open, where supported. The lock is released on close, and requested again on `visibilitychange` when the page returns.
- **Theme:** colours come from page tokens. The dial follows the theme; only the sky and radio charts stay dark.
- **No new network calls.** Never call CelesTrak from Aaron's laptop.
- **Tests and commits:** `npm test` and `npx tsc --noEmit`. Conventional commits, no AI attribution lines.

## Review Focus

1. **Azimuth wrapping through north** (359° then 1°): interpolation must not swing through 180°. Pinned in Task 1.
2. **Opened before the satellite rises:** a countdown to rise, with the pointer at the rise azimuth. After it sets: "This pass is over" and no stale numbers. Pinned in Task 1 (phases).
3. **No frequency set** (custom frequency cleared, or a satellite with no downlinks): the radio block says to pick a frequency in the radio chart, never shows NaN. Pinned in Task 1 (`dopplerHz` null) and the Task 3 render.
4. **A compass heading near the wrap** (target 10°, heading 350°): "Turn right 20°", not left 340°. Pinned in Task 2.
5. **Tab hidden and shown again:** the wake lock is requested again, and the clock catches up without drift. Covered by the Task 3 implementation (`visibilitychange`); checked in review.

---

### Task 1: Live pass state

**Files:**
- Create: `lib/live/live-state.mjs`, `test/live-state.test.mjs`

**Interfaces:**
- Produces:
  - **`liveState(samples, nowMs)`:** `samples` are radioPassSamples rows (`tMs`, `azDeg`, `elDeg`, `rangeM`, `dopplerHz` or null, `dopplerRateHzPerSec` or null). It returns:
    `{ phase: 'before'|'during'|'after', azDeg, elDeg, rangeKm, dopplerHz, rateHzPerSec, msToRise, msToSet, msToPeak, peakElDeg, peakAzDeg }`
    - **before:** position fields are the first sample's, and `msToRise` is `samples[0].tMs - nowMs`.
    - **during:** fields are linearly interpolated between the two straddling samples. Azimuth takes the shortest way round. `msToSet` is `last.tMs - nowMs`.
    - **after:** every position field is null.
    - **Peak:** the sample with the highest `elDeg`. `msToPeak` is null once the peak has passed.
  - **`liveAvailable(pass, nowMs) -> boolean`:** true when `nowMs < pass.endMs` and `pass.startMs - nowMs <= 30 * 60_000`.
  - **`clockText(ms) -> string`:** `"0:05"`, `"4:05"`, `"1:02:03"`. Negative counts as 0.

- [ ] **Step 1: Write the failing tests**:
  - **`liveState interpolates during a pass`:** samples at t=0, 1000, 2000 with el 10, 20, 30 and doppler 1000, 0, -1000. At t=500 the result is el 15, doppler 500, phase `during`, msToSet 1500.
  - **`azimuth crosses north the short way`:** az 350 to 10 at t=0 and 1000. At t=500, az is 0, not 180.
  - **`before and after`:** before gives `msToRise` and the rise azimuth; after makes the position fields null.
  - **`peak`:** `peakElDeg` is the highest el. `msToPeak` is null once past it.
  - **`no frequency`:** with `dopplerHz` null on the samples, the result has `dopplerHz` and `rateHzPerSec` null.
  - **`liveAvailable`:** true within 30 min and during a pass; false at 31 min and after the pass ends.
  - **`clockText`:** 5000 gives `"0:05"`, 245000 gives `"4:05"`, 3723000 gives `"1:02:03"`, -1 gives `"0:00"`.
- [ ] **Step 2: Run** `node --test test/live-state.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: Add live pass state from sampled passes`.

---

### Task 2: Phone compass turn hint

**Files:**
- Create: `lib/live/heading.mjs`, `test/live-heading.test.mjs`

**Interfaces:**
- **`turnHint(targetAzDeg, headingDeg) -> { deltaDeg, text }`:** `deltaDeg` is in (-180, 180], positive meaning turn right. The text is one of:
  - `Ahead` when |delta| ≤ 10;
  - `Turn around` when |delta| ≥ 170;
  - otherwise `Turn right N°` or `Turn left N°`, rounded.
- **`headingFromOrientation(e) -> number | null`:**
  - `e.webkitCompassHeading` when it is a finite number (iOS);
  - otherwise `(360 - e.alpha) % 360` when `e.absolute` is true and `alpha` is finite;
  - otherwise null.

- [ ] **Step 1: Write the failing tests**:
  - `turnHint(10, 350)` gives deltaDeg 20, `Turn right 20°`.
  - `turnHint(350, 10)` gives -20, `Turn left 20°`.
  - `turnHint(100, 95)` gives `Ahead`.
  - `turnHint(180, 5)` gives `Turn around`.
  - `headingFromOrientation({ webkitCompassHeading: 42 })` gives 42.
  - `headingFromOrientation({ absolute: true, alpha: 90 })` gives 270.
  - `headingFromOrientation({ absolute: false, alpha: 90 })` gives null.
- [ ] **Step 2: Run** `node --test test/live-heading.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: Add a compass turn hint for the live view`.

---

### Task 3: Live view and entry points

**Files:**
- Create: `components/live/LiveView.tsx`, `components/live/LiveDial.tsx`
- Modify:
  - `components/passes/PassChartModals.tsx`: `chart` gains `"live"` and renders LiveView;
  - `components/sat/PassSection.tsx`: a `Live` button;
  - `components/home/NextUpList.tsx`: a `Live` button;
  - `app/home.css`: live styles.

**Interfaces:**
- Consumes:
  - `liveState`, `liveAvailable` and `clockText` (Task 1);
  - `turnHint` and `headingFromOrientation` (Task 2);
  - `radioSeries` from `lib/passes/charts.js`, with `purpose: "csv"`;
  - `trueNow` from `lib/pass-finder/clock-sync.js`.
- `PassChartModals` props: `chart: "sky" | "radio" | "live" | null`, and `onChartChange` accepts `"live"`.
- **LiveView** props: `{ subject: ChartSubject, freqHz: number | null, downlinkLabel: string | null, onChart(kind: "sky" | "radio"), onClose() }`. It is a full-screen dialog (`role="dialog"`, `aria-modal`, labelled by its title). Esc and the close button call `onClose`.

**Layout,** top to bottom:
1. **Title:** `{shortName} live`, with the observer name under it.
2. **Status line:**
   - before: `Rises in 4:32 in the SW`;
   - during: `Sets in 3:12`, plus `Peak 75° in 1:10` while the peak is ahead;
   - after: `This pass is over.`
3. **`LiveDial`:**
   - an SVG compass, N up and E right, captioned `Compass view`;
   - rings at 0°, 30° and 60° elevation;
   - the pass track in muted colour, with the current position as a dot and an arrow from the centre to it.
   - With the phone compass on, the dial rotates so the top is where the phone points, and the turn hint shows under it.
4. **Large readouts:** `Az 229° SW` and `El 37°`, plus the range in km.
5. **Radio block,** when a frequency is set:
   - `Tune {MHz to 4 decimals}`;
   - `Doppler +6.1 kHz, falling 120 Hz/s`;
   - the downlink label;
   - the note `Predicted. The satellite's own offset is unknown.`

   With no frequency: `Pick a frequency in the radio chart to see where to tune.`
6. **Buttons:** `Use phone compass` (only when DeviceOrientationEvent exists), `Sky chart`, `Radio chart`, `Close`.

**Behaviour:**
- **Samples:** built once per subject and frequency with `radioSeries`.
- **Tick:** every 250 ms, using `trueNow()`.
- **Wake lock:** requested on open, released on close, and requested again on `visibilitychange` when visible.
- **Live button:** shown on a pass row or card when `liveAvailable(pass, nowMs)`, styled as the primary chip. It opens the shared modals with `"live"`.

- [ ] **Step 1: Implement** LiveDial, LiveView, the PassChartModals mode, both entry points and the CSS.
- [ ] **Step 2: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds.
- [ ] **Step 3: Do the screenshot check** with `next start` and Playwright:
  - Open the live view for the soonest pass, at 390 and 1440 px, in light and dark.
  - Confirm the countdown ticks and there is no horizontal scroll.
  - Confirm Esc closes it and focus returns to the Live button.
- [ ] **Step 4: Commit** with `feat: Add a live pass view with pointing, countdowns and tune frequency`.
