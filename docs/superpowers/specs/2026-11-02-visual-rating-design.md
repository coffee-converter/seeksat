# Visual Pass Rating Design

**Date:** 2026-11-02
**Status:** Approved direction. Aaron asked for magnitude and sky brightness to feed the visual Good/OK/Low rating, with peak magnitude shown. He chose:
- a simple sky-type picker;
- for satellites with no published brightness, rating on geometry and saying so, never guessing a magnitude.

## Why

Today Good/OK/Low is maximum elevation only (40° and 20° thresholds). For watching, what matters is how bright the satellite will look against how dark the sky is, and whether clouds hide it. A high pass at dusk can be invisible, while a medium pass of a bright satellite in a dark sky is great.

## Rating (visual mode only; radio mode unchanged)

### Known brightness

This applies when the satellite has a `standardMag` in the catalogue (ISS -1.8, Tiangong -1.0, BlueWalker 3 0.5, Hubble 2.0, and one at 3.5).

1. **Sampling:** the engine samples each visual pass about every 10 s. At each sample where the satellite is sunlit and the observer's Sun is at or below the existing twilight threshold, it computes:
   - the apparent magnitude, from `magnitudeAt(obs, satEcef, sunDir, standardMag)` in `lib/pass-finder/ratings.js`;
   - plus extinction: `0.2 × (airmass - 1)`, with airmass `1 / sin(max(el, 5°))`.

   The brightest such sample is the pass's **peak magnitude**. Its Sun altitude and elevation are stored with it.
2. **Limiting magnitude:** the faintest star visible at that moment is `min(naturalSkyLimMag(sunAlt), SKY_LIMIT[skyType])`. `naturalSkyLimMag` is in `lib/pass-finder/sky-helpers.js`.

   | Sky type | SKY_LIMIT (full dark) |
   |---|---|
   | City | 3.5 |
   | Suburban (the default) | 4.5 |
   | Rural | 5.5 |
   | Dark site | 6.5 |

3. **Headroom:** limiting magnitude minus peak magnitude. 3.0 or more is **Good**, 1.5 up to 3 is **OK**, and under 1.5 is **Low**.
4. **Tooltip:** for example, "Peak mag −2.1, about 4 magnitudes brighter than the faintest stars you can see."

### Unknown brightness

1. Start from the existing elevation rating (`passQuality`).
2. Drop one level (never below Low) when the sky at the pass's peak is still bright, meaning the Sun is above -12°.
3. **Tooltip:** "Brightness unknown, so this is rated on height and sky darkness."
4. **No magnitude** is shown anywhere for this satellite.

### Cloud (either case)

The cloud badge from `lib/sky/cloud-badge.mjs`, when there is one:
- **Cloudy** caps the rating at **Low**;
- **Some cloud** drops it one level;
- **Clear** leaves it alone.

The tooltip gains, for example, " Some cloud forecast."

## Peak magnitude display

- In visual mode, and only when the brightness is known, home cards and satellite-page rows show `mag −2.1` beside `max 47°`. It uses a true minus sign, one decimal, and tabular figures.
- Timeline bars use the new rating for their opacity, and the brightness goes in the bar's accessible name: "…, mag −2.1".

## Sky-type picker

- **Where:** in the home and satellite-page controls, shown in visual mode only. It is a `<select aria-label="Sky type">` with the options City, Suburban, Rural and Dark site, styled as the input tier (Slate).
- **Storage:** saved in prefs as `skyType`, defaulting to `suburban`. Unknown values fall back to `suburban`.
- Share links do not carry it, because it is personal.

## Honesty fix in the charts

`lib/passes/charts.js` and `lib/passes/card-chart.js` currently fall back to the ISS's -1.8 (`DEFAULT_STD_MAG`) for satellites with no `standardMag`, which draws a faint cubesat as if it were ISS-bright. When the brightness is unknown, they must not compute or show a magnitude. Any magnitude-based styling falls back to the plain, unrated look.

## Constraints

- Radio mode and the MCP route are unchanged. Never call CelesTrak.
- Copy is plain language, with no em dashes. Magnitudes use the true minus sign (U+2212).
- Colours come from tokens.
- Visual-mode badges and the timeline use the same rating everywhere: home cards, satellite rows and the timeline.

## Review focus

1. A pass that starts in daylight twilight and ends in the dark is rated on its best lit, dark moment, not its peak elevation.
2. A satellite with no `standardMag` never shows a magnitude, in rows, cards, charts or tooltips.
3. With the City sky type and ISS at -1.8, a high pass in full dark has headroom 3.5 + 1.8, which is about 5.3 and rates Good. A Hubble pass (2.0) at nautical twilight in a city has headroom 3.5 - 2.0 = 1.5, which rates OK.
4. A Cloudy forecast caps the rating at Low, and when the forecast is missing nothing changes.
5. A saved preference with an unknown `skyType` loads as `suburban` without a crash.
