# Clarity Pass Design

**Date:** 2026-11-02
**Status:** Approved. Aaron said "sure" to the bundle of problems 1-8 and additions 1-3 from the UX review at `/private/tmp/claude-501/-Users-aaron-work/43ed1f7f-2350-4934-a11b-ef9b444d0e87/scratchpad/ux-review.md` (screenshots `scratchpad/qa/ux-*.png`).

## Why

The aim is to make "when and where do I look or tune" faster, and to remove the places where the screen contradicts itself or hides what matters.

## Changes

### Ratings that explain themselves

- **Visible reason.** The Good/OK/Low badge shows a short reason next to its word, as visible text, when the level is below Good:
  - `Low: cloudy`;
  - `OK: some cloud`;
  - `Low: 3° up`, from the elevation rating;
  - `OK: twilight`, when an unknown-brightness pass was dropped for sky brightness;
  - `Low: faint`, when the headroom rule set it.

  The tooltip keeps the full reason. A pure helper returns `{ level, label, short }`, where `short` is null when there is nothing to add.
- **Visual mode drops the "visible" tag** on cards and rows, because every pass listed in visual mode is visible. Radio mode keeps it.

### Where to look, in words (home cards)

A line under each pass card's meta:
- **Visual:** `Rises NW 6:27 PM · peaks 26° SW 6:29 · fades in the SE 6:31`.
- **Radio:** `Rises NW 6:27 PM · peaks 26° SW 6:29 · sets SE 6:33`.

How the line is built:
- **The last part** says "fades" when the pass ends while the satellite is still above the horizon by more than 1° (it entered Earth's shadow). Otherwise it says "sets".
- **New engine fields:** the engine adds `startElevDeg` and `endElevDeg` to passes. Times are in the observer's time zone, using the same clock format as the cards.
- **Phones:** the line may wrap. It never truncates the times.

### Best in the next 24 hours (home)

- **What it shows:** above Next up, one line: `Best in the next 24 hours: ISS 9:41 PM, Good, max 64°`. It is a button that opens that pass's sky chart.
- **Which pass:** the best pass by rating level, then by maximum elevation, among all followed satellites' passes in the timeline window. In visual mode this uses the visual rating.
- **When it hides:** when that pass is also the soonest pass (it would repeat the first card), or when there are no passes.

### Radio cards: what hams plan around

In radio mode, each pass card's meta gains:
- **Time above 10° and 30°** for that pass, for example `4m10s above 10° · 1m30s above 30°`.
- **Doppler at rise**, for the satellite's first downlink, for example `437.800 MHz, +9.2 kHz at rise`. It is shown only when the satellite has a downlink.

How they are computed:
- The time-above figures come from the engine for radio passes, as `msAbove10` and `msAbove30`, using 10 s sampling.
- The Doppler figure comes from the range rate at the pass start (ECEF at `startMs` and `startMs + 1 s`) times f/c. A pure helper does this, with a test.

### Buttons that follow the mode

- The main card button is **Sky chart** in visual mode and **Radio chart** in radio mode. The other one moves under More.
- The calendar and bell icons get visible words: **Calendar** and **Remind me**.

### Less repetition

- "Up now" is hidden entirely when nothing is up. The Next strip on phones and the first card already say what's next.

### Card plots

- In light theme, the pass card polar plots get a light background from tokens. They are no longer black squares.
- The arcs are drawn at 2 px in the satellite's colour, in both themes.

### First visit

- **Location first on phones.** On phones, until a location is set, the "Where are you?" card comes before the map, and the map is capped at 40vh.
- **Popular satellites.** "Following" uses the pressed "on" look (accent outline), and "Follow" is the filled main button. This is the same rule as the satellite page.
- **Default mode.** New visitors start in **Visual** mode. Saved prefs keep their mode.

### Flat map frames the satellites

- **Opening view.** The Mercator home view is centred on the circular mean longitude of the observer and the satellites' current positions, so their dots are in view.
- **Zoom.** If a satellite would still be off-screen at the normal home zoom, the map zooms out to fit them, but never below the world-across floor.
- **Implementation:** a pure helper `homeCamera('flat', { …, points })` with tests.
- **When it applies:** only to the home view, when there is no focus. A focus still centres on the focused satellite.

### Satellite page on phones

- **Next pass line.** Right under the title and Follow row: `Next pass: Tue 4:12 AM, SW to SE, Low: cloudy`, plus a `Sky chart` button (or `Radio chart`, by mode). It is hidden when there is no upcoming pass.
- **Stat tiles.** On phones (under 600 px) the stat tiles fold into a `<details>` labelled "Live numbers", closed by default. On desktop they stay open.

### East and west

- Every polar view carries a caption: the sky chart and the card thumbnails say `Looking up (east on the left)`, and the live dial says `Compass view (north up)`.
- The card thumbnail gets its caption as its accessible name and title, not as visible text.

## Constraints

- **Copy:** plain language, no em dashes. Magnitudes use U+2212.
- **Colour:** tokens only.
- **Theme:** the Slate tiers apply.
- **Network:** never call CelesTrak.
- **Night vision:** unchanged.

## Review focus

1. **Badge words:** a Cloudy-capped pass reads `Low: cloudy` in visible text on a phone, with no tooltip needed. A Good pass has no extra word.
2. **"Fades" versus "sets":** a pass ending in shadow at 20° says "fades", and one ending at the horizon says "sets".
3. **Best in 24 h:** hidden when the best pass is the soonest one.
4. **Flat map:** with the four default satellites spread around the globe, the opening view shows every dot that the world-across zoom can show. It never zooms below the floor.
5. **First visit at 390 px:** the location card is fully visible without scrolling.
