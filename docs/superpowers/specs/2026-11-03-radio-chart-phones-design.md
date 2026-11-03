# Radio Chart on Phones Design

**Date:** 2026-11-03
**Status:** Approved direction. This is UX review problem 6 ("the radio chart is unreadable on phones"); Aaron picked it next. The review's fix: under 600 px, show the summary tiles as HTML, draw the chart at phone width, and add "Open full size".

## Why

On a 390 px phone the radio chart is the desktop image (320 viewBox units drawn about 330 px wide), so its text is 2 to 3 px tall. Nothing on it can be read without zooming.

## Phone layout (viewport 600 px wide or less)

The modal keeps its toolbar: Copy, Save PNG, CSV, Sky chart, the frequency picker, Custom and Close. Below the toolbar, in this order:

1. **Heading (HTML).**
   - The first line is `{satellite} · {freq} MHz`. Without a frequency it is just the satellite.
   - The second line is the chart's subtitle: `{downlink} ({duty}) · {observer} · {date}`.
2. **Stat tiles (HTML).** The same `statTiles` values and labels, in a two-column grid.
3. **Tune at (HTML).** Shown only when a frequency is set. It is a small table with one row per moment, in time order:
   - 10° rising, 30° rising, closest approach, 30° setting and 10° setting. An elevation the pass never reaches has no row.
   - The columns are the local time (HH:MM:SS in the observer's zone, UTC when the zone is unknown), the frequency to tune to in MHz (`tuneLabel`), and the Doppler offset (`fmtDopplerLeg`).
   - "Closest approach" uses the TCA time, with a 0.0 kHz offset.
4. **Phone chart (live SVG).** The same panels and data as the full chart:
   - Doppler or range rate, then signal, then angular rate.
   - The TCA rule, the shaded bands, and the approaching and receding labels.
   - The Doppler dots at 10° and 30° are kept, but without their text, because the Tune at table carries it.
   - The right tune axis stays.
   - It is drawn in a narrow viewBox, so at 360 to 390 px the tick text is about 10 px and the panel labels about 11 px.
   - There are 3 time ticks, with local and UTC rows. There is no title, tiles, caption or methods text inside the SVG.
5. **Legend (HTML).** The chart's caption sentence ("Swing is horizon-to-horizon. Shaded: above 10°. …").
6. **Open full size.** This button shows the full desktop image at its natural width (900 px) in a scroll box, so it can be panned and pinch-zoomed. The button then reads "Fit to screen" and toggles back.
7. **About this prediction.** The methods note, in a `<details>` that starts closed.

## Unchanged

- **Exports:** Copy, Save PNG and CSV export exactly the same full chart as today, on every screen size.
- **Desktop:** above 600 px the modal is unchanged.
- **Full painter output:** the full chart's output is unchanged.

## Implementation notes

- **Shared pieces:** the full painter's caption and methods text become pure exported helpers (`radioChartCaption(series, meta)` and `radioMethodsNote(series, meta)`), so the phone HTML and the image say the same thing. The panel drawing is shared too.
- **Render result:** the modal's `render` result gains `series` and `meta`, so the phone view needs no second computation.
- **Phone detection:** `matchMedia('(max-width: 600px)')`, which also tracks rotation.

## Constraints

- **Copy:** plain language, and no em dashes in new copy.
- **Colour:** the modal is always dark, so it uses the chart's own palette.
- **Network:** never call CelesTrak.

## Review focus

1. **No overflow:** on a 360 px and a 390 px phone, no phone-chart text runs off the SVG, and the modal has no horizontal scroll, except inside the full-size box.
2. **Exports unchanged:** Save PNG and Copy on a phone still give the full chart.
3. **Tune at table:** its rows and values match the dots on the full chart.
4. **No frequency:** with "no known downlink", there is no Tune at table, and the phone chart shows range rate.
5. **Changing frequency:** changing the frequency on a phone repaints the phone chart, the tiles and the table.
