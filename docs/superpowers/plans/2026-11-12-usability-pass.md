# Usability pass Implementation Plan

> For agentic workers: implement the task you are given, one commit per
> numbered item, on branch `develop` in /Users/aaron/work/seeksat.

**Goal:** Fourteen agreed usability and visual changes to the home list,
satellite page, search, map and live view.

**Decisions:** every item below was agreed with the owner one at a time.
The wording in quotes is approved copy; use it exactly.

## Global constraints

- Read `docs/design-system.md` first and follow it: type role classes,
  tokens only (no colour, size, radius or duration literals), `Icon`,
  `Button`, `SettingRow`, `.kv`, `.sat-dot`. Add a token if one is missing.
- Commits: conventional prefix (`feat:`, `fix:`, `refactor:`), a short plain
  English title. No `Co-Authored-By` or any AI attribution lines. Do not push.
- No em dashes anywhere (copy, comments, commit messages).
- Never fetch CelesTrak. Never call `/api/cron/*` or `/api/refresh-tle`. For a
  local server, follow only catalog ids 25544, 48274, 20580 and 27607.
- No new dependencies.
- UI says "Mercator", never "flat".
- `npm run typecheck` clean and `npm test` all passing before each commit.
  Pure logic in `lib/` gets node:test tests in `test/`.
- Browser checks (optional for implementers): `npx next build` then
  `npx next start -p 3100 -H 127.0.0.1`; Playwright from
  `/Users/aaron/work/qrz-swapmeet-watch/node_modules/playwright/index.mjs`
  with `channel: 'chrome'`; in a route handler abort any celestrak URL and
  strip `content-security-policy` and `strict-transport-security` headers.
  Seed `localStorage['seeksat.home.v1']` with
  `{version:1,location:{latDeg:41.88,lonDeg:-87.63,name:"Chicago",source:"place"},following:[25544,48274,20580,27607],mode:'radio'}`.
  Scratch files go in
  `/private/tmp/claude-501/-Users-aaron-work/dcf0ad0a-cde1-49ae-9b16-ce370c6d9034/scratchpad/`.
- Passes already under way: use `lib/passes/under-way.mjs` (`underWay`,
  `notStarted`, `startIsRise`). A pass that was up when its search ran has
  `inProgress` and `startMs` = the search time; home cards add `riseMs` (or
  `riseUnknown`) for its real rise.

## Task A: satellite page rows, one open at a time

1. The satellite page (`components/sat/PassSection.tsx`) lists passes with the
   same compact rows as the home list (`components/home/PassList.tsx`: time,
   satellite, height, duration, direction, rating) under its day headings.
   Tapping a row opens its details in place, holding what a sat page pass shows
   today (stats, path, radio panel, actions such as Radio chart, Remind,
   Calendar, Share). Reuse the home row and open-row components rather than
   copying them. Keep: the shared-view highlighted row (`sharedKey`, scrolled
   into view), "Show all N passes", joint-observer passes, the print stylesheet
   (printing compact rows is fine), desktop and phones.
2. Both lists allow only one open row at a time: opening one closes the other.
   When the closing row is above the tapped one, keep the tapped row's top at
   the same place on screen (measure before and after the close and adjust
   the scroll of the right scroller: the window on phones, `.map-shell__panel`
   when docked at 1100 px and up). Home keeps opening its first row on load.

## Task B: quieter low passes, loading rows

3. Grey Poor badge: the rating pill for the lowest level (`level: 'low'`, shown
   as "Poor" in radio and visual) uses a neutral muted look instead of red.
4. Low pass fold: within each day group, on both the home list and the sat page,
   passes whose `maxElevDeg` is under 5 move into one line at the end of the day:
   "3 low passes (under 5°)" (singular "1 low pass (under 5°)"). Tapping it shows
   them in place. Applies in both modes. The "Lowest pass to show" setting still
   removes passes below it first. A pass under way is never folded.
5. Skeleton rows: while passes are being found, show 3 or 4 placeholder rows the
   same height as real rows, with a slow gentle pulse (no pulse under
   `prefers-reduced-motion`), instead of the "Finding passes..." text. Same on
   the sat page. Keep a visually hidden "Finding passes..." status for screen
   readers.

## Task C: the Best / Up now line

6. A slim line above the home pass list (under the Passes heading row).
   - Normally: "Best tonight: ISS 9:44 PM, 72°, look NW" for the best pass in
     the next 24 hours by the current mode's rating (PassList already works out
     `best`). Use the right day word: "Best tonight" for this evening or night,
     "Best today", "Best tomorrow". Tapping it opens that pass's row and scrolls
     it into view.
   - While a followed pass is under way: "Up now: ISS, look NE, 4 min left" with
     a "Live" button that opens the live view (as the open row's Live button does).
     Use the satellite's current direction if it is easy to get, else where it is
     heading (set direction).
   - Nothing good in the next 24 hours (no pass rated above the lowest level): no
     line.

## Task D: small items

7. Mode hint: under the Visual/Radio switch on the home list, a one-time note,
   "Visual: passes you can see by eye. Radio: passes in range to receive voice, data or images."
   It shows until the person taps either option, then never again (a localStorage
   flag, every access in try/catch; render nothing until hydrated so there is no
   flash).
8. Rating explainer: tapping a rating badge in an open pass row shows a short
   popover saying what the rating is based on, per mode. Derive the factors from
   the real rating code (`lib/passes/quality.mjs` for radio,
   `lib/sky/visual-rating.mjs` for visual); do not invent factors. Approved
   drafts, to be corrected against the code: visual "Based on how high it climbs,
   how dark your sky is, how bright the satellite looks, and cloud."; radio "Based
   on how high it climbs and how long it stays above 10°." Add the same two
   sentences to the About section. Accessible: a button with aria-expanded, Esc
   and outside tap close it.
9. Search: replace the follow star in search results with a small "Follow"
   button that reads "Following" (pressed) once followed, like the sat page's
   follow button. The rest of the row still opens the satellite.
10. Shorter map on phones: under 1100 px the map takes about a third of the
    viewport height instead of about half. Full screen still works.
11. Install prompt: on the second and later visits (count visits in localStorage),
    a small dismissible note under the home pass list: "Add SeekSat to your home
    screen for one-tap access." On Android Chrome use the `beforeinstallprompt`
    event behind an "Install" button; on iPhone Safari show "Tap Share, then Add to
    Home Screen."; hidden when already installed (display-mode standalone or
    `navigator.standalone`), when neither path applies, and forever once dismissed.

## Task E: live view

12. Hide "Use phone compass" unless the device has a compass: show it only on a
    touch device (`pointer: coarse`) with `DeviceOrientationEvent`.
13. Pass progress bar under "Sets in 7:02": Rise, Peak and Set times along a thin
    line with a marker moving in real time; the flown part dim, the part to come
    bright. For a pass that was already up when found, use its `riseMs` when
    known, else start the bar at "Up" without a time.
14. Livelier sky dome (the live view's polar plot): the flown part of the track
    dim and the part to come bright; small ticks every minute along the track with
    the peak and set times labelled; the satellite dot pulses gently (still under
    reduced motion); the 30° and 60° rings labelled. Phone compass rotation keeps
    working.
15. Mode-aware panels: the live view gets the current mode.
    - Visual: instead of the radio frequencies, how bright it is now (magnitude,
      use the existing magnitude code), whether it is sunlit or in Earth's shadow
      now, and "Fades into shadow in 2:10" when it enters shadow before it sets.
    - Radio: keep the frequencies and add a small Doppler curve for the whole pass
      for the chosen downlink with a "now" marker (use the existing Doppler code).

## Task F: live view docked on desktop

16. At 1100 px and up the live view opens in the right-hand panel (where the pass
    list or sat page sits) instead of the full-screen takeover, and the map
    follows the satellite with its footprint (the globe's existing follow mode).
    Closing it returns the panel to what it showed before. Phones keep the
    full-screen view.
