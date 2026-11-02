# Tonight Timeline and Cloud Cover Design

**Date:** 2026-11-02
**Status:** Draft, for Aaron's review
**Parent spec:** `docs/superpowers/specs/2026-10-30-any-satellite-tracker-design.md`

## Why

Two questions take too long to answer today:

- **"Is tonight worth going out, and when?"** Today you read one card per followed satellite, each showing only its next pass, and compare times in your head.
- **"Will I actually see it?"** For a watcher, cloud matters more than anything else, and SeekSat says nothing about it.

On 2026-11-02 Aaron chose these two from the UX list: "2/3". The order of work after this:
1. This design.
2. Magnitude and sky brightness folded into the visual Good/OK/Low rating, with peak magnitude shown. That gets its own design next.
3. Reminders that arrive with the tab closed (web push).

## Goals

1. **A "Next 24 hours" timeline on the home page,** above Next up.
   - One row per followed satellite, in its map colour.
   - A bar for each pass in the next 24 hours.
   - A "now" marker, hour ticks in the observer's time zone, and night shaded across the strip.
2. **A cloud badge on each visual pass** that falls within the forecast range: `Clear`, `Some cloud` or `Cloudy`. It appears on:
   - home cards;
   - satellite-page pass rows;
   - timeline bars, in the bar's label and as a dimmed bar when cloudy.
3. **Cloud data comes through our own server,** so the browser talks only to SeekSat and the CSP is unchanged.

## Non-goals

- **No cloud on radio passes.** Radio does not care.
- **The Good/OK/Low rating stays elevation-only for now.** Cloud, magnitude and sky brightness come together into the rating in the next design, so the rating changes once.
- **No timeline on satellite pages.** Their pass list already is a timeline for one satellite.
- **No forecast beyond what the models give.** Past the horizon the badge says nothing; it is never a guess.

## Anti-goals

- **No pretend precision:** a badge for a pass 6 days out must not look as sure as tomorrow's.
- **No CelesTrak call** from the browser or from Aaron's laptop. Weather calls run on the server only.
- **No new browser origins:** nothing new in `CONNECT_ORIGINS`.
- **No location leak finer than needed:** the client sends coordinates rounded to 0.1° (about 11 km).
- **No timeline that pushes Next up off a phone's first screen** when the timeline has nothing to say.

## The timeline

- **Mode:** the timeline follows the current Radio/Visual mode, like the cards (visual mode lists only visible passes). The cloud hatch shows only in visual mode.
- **Window:** now to now + 24 h. Nothing new is computed for it: `nextUp` (`lib/home/next-up.mjs`) already runs a 48 h `findPasses` per satellite and keeps only the first pass. It now keeps every pass that starts within 24 h on the card, as `passes`, alongside `pass`.
- **Rows:**
  - One row per followed satellite that has at least one pass in the window, in follow order, with its name and colour swatch.
  - Satellites with no pass in 24 h are left out. One muted line says how many were left out ("2 others have no pass in the next 24 hours"). The count is cards of kind `none`, plus `pass` cards whose first pass starts after 24 h. Stationary, unavailable and missing cards are not counted, since their cards explain themselves.
  - When no followed satellite has a pass, the whole timeline is hidden.
- **Bars:**
  - A bar spans the pass from start to end, with a minimum width of 6 px so a short pass stays tappable.
  - Opacity follows the Good/OK/Low rating: Good is full, OK about 0.7, Low about 0.45.
  - In visual mode, a pass forecast `Cloudy` gets a diagonal hatch, so colour is never the only cue.
- **Night shading:** a darker band wherever the Sun is below -6° (civil dusk) at the observer, using the existing Sun position code.
- **Now:** a thin vertical line at the left edge.
- **Hour ticks:** every 3 h, labelled in the observer's time zone (`21:00`), with day changes marked (`Tue`).
- **Tapping a bar** opens that pass's sky chart, the same modal the cards use. Each bar is a button whose accessible name reads like the row text: "ISS, 21:37 to 21:44, max 47°, Good, clear sky".
- **Layout:**
  - Full panel width.
  - Each row is about 18 px tall.
  - Names sit in a left column, about 96 px, truncated with an ellipsis and given a title attribute.
  - On phones (under 600 px) the names move above each row, so the strip keeps its width.
- **Heading:** `Next 24 hours`, an `h2` like `Up now` and `Next up`.
- **Order on home:** Up now, then Next 24 hours, then Next up.
- **Print:** hidden.

## Cloud cover

- **Server route:** `GET /api/clouds?lat=<0.1° rounded>&lon=<0.1° rounded>`.
  - It returns `{ startMs, hours: number[] | null }`: hourly combined cloud occlusion in percent, the shape `cloudAt()` already reads.
  - It reuses `fetchCloudForecast` from `lib/pass-finder/weather.js` (Open-Meteo blended with MET Norway, low/mid/high layers weighted 1.0/0.55/0.20).
  - Server fetches send `User-Agent: seeksat/1.0 (https://seeksat.app)`, as the MCP route does for geocoding. MET Norway's terms require an identifying User-Agent, and the current code sends none from the server, so MET Norway is likely being dropped today.
  - **Cache:** `Cache-Control: public, s-maxage=1800, stale-while-revalidate=3600`, keyed by the rounded coordinates.
  - **Bad input:** latitude or longitude out of range, or not finite, gives a 400. Upstream failure gives 200 with `hours: null`, and the badges then stay hidden.
  - **Upstream timeout:** each upstream fetch gets an 8 s `AbortSignal.timeout`, set in `weather.js` so the MCP route benefits too. A timed-out source counts as failed.
  - **In-memory cache:** `weather.js`'s cache is capped at 200 entries, oldest dropped first (my call). The CDN cache does the real work.
- **Client:**
  - **One shared hook:** the home page and satellite page share it. It fetches once per rounded location and dedupes concurrent requests through a module-level promise per key. It refreshes every 30 minutes while visible.
  - Only in visual mode. Radio mode never fetches.
- **Badge rule:** `cloudBadge(cloudPct, ageDays)`.
  - `cloudPct` is `cloudAt(forecast, pass.peakMs)`, which already interpolates between forecast hours, including MET Norway's 6-hourly stretch. When it returns null (past the forecast), there is no badge. `ageDays` is the time from now to the pass peak.
  - `effectivePClear` (`lib/pass-finder/ratings.js`) gives the chance of clear sky, blended toward 0.5 with distance.

  | Effective P(clear) | Badge |
  |---|---|
  | 0.7 or more | `Clear` |
  | 0.4 up to 0.7 | `Some cloud` |
  | Under 0.4 | `Cloudy` |
  | `cloudAt` null, or the pass more than 7 days out | no badge |

  - Distance is shown honestly: from 3 days out the badge text gains `(forecast)`, and its title gives the raw cloud percent and the forecast age.
  - **Style:** a small pill like `QualityBadge`, using the existing `--ok`, `--warn` and `--muted` tokens, with the word always shown.
- **Attribution:** the About section gains "Cloud forecasts from Open-Meteo and MET Norway." MET Norway's licence (CC BY 4.0) requires attribution.
- **Privacy text:** add to the About line that SeekSat's server asks the weather services about your area, rounded to about 11 km.

## Decisions for Aaron

1. **Open-Meteo's free API is for non-commercial use only.** SeekSat has no ads and no accounts, so it should qualify today. If SeekSat ever earns money, we either pay Open-Meteo or switch to MET Norway alone; MET Norway is free for commercial use too. Proceeding on that basis.

## Left to the builder

- **Drawing:** the timeline's internals, with the choice of SVG or HTML left open (SVG is likely simpler for ticks and hatching).
- **Sun position:** the exact Sun-altitude sampling for night shading, with a step of 10 minutes or finer.
- **Fetch timing:** how the client staggers the refresh.

## Review focus for the plan

1. **A pass already in progress at "now"** draws from the left edge, not before it.
2. **Time zone and midnight:** ticks and the day change are right for the observer's zone, not the browser's. Test with an observer in Tokyo viewed from a Chicago browser.
3. **Cloud forecast missing or failed:** no badge and no error text. The rest of the page is unaffected.
4. **Coordinates:** the server rejects junk input. The client never sends more than 0.1° precision.
5. **Phones at 360 px:** the timeline fits with no horizontal scroll, and its bars stay at least 6 px wide.
