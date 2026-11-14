# SeekSat UI simplification

Date: 2026-11-12. Branch: develop. Mockups (brainstorm companion, not
committed): `.superpowers/brainstorm/91778-1794494509/content/combo-v3.html`
(phone) and `desktop-and-sheets-v2.html` (desktop, location sheet, settings
sheet, layers menu).

## Intent

Aaron opened SeekSat on his phone to see upcoming ISS passes near him, then
for another location. Finding "change location" was clunky, and the pass
list was buried among other things: radio/visual, location, passes,
timeline, Up Now, banners, legend, chips. He felt "assaulted with UI
components."

The reference is astroviewer.net's ISS page: a dead simple pass list. SeekSat
keeps every tool and chart it has today, but the main screen shows only the
map, where you are, and the passes. Everything else sits behind a button, a
sheet or a row that opens.

The map with followed satellites stays the hero. Aaron said so.

## The moment this must nail

1. Open the site on a phone. Without scrolling past anything, see the map and
   the next few passes for the saved place, each on one line.
2. Tap a pass, see where to look and when, in place.
3. Tap the location pill, pick another place (or type one), and see that
   place's passes in that place's local time. Two taps for a recent place.

## Goals

- One clear main screen on phones: header, map, pass list. Nothing else
  competes with the list.
- Desktop uses the same parts with more room, so the two never drift apart.
- Every current feature is still reachable (table below). Nothing is deleted
  that a user could do before, except where the table says so.
- Looks designed: calm, compact rows, consistent spacing, built on the
  design bible's tokens and components (`components/ui/*`,
  `lib/ui/classes.mjs`), in light, dark and night vision.

## Non-goals

- No change to the satellite page body (`/sat/<id>`), except the "other
  places" line below. It picks up the new shared header.
- No new data, prediction or radio features.
- No change to the map renderer itself beyond its overlay buttons.
- No custom gesture code for the phone sheet (see Layout).

## Anti-goals (a failure even if it works)

- The phone main screen grows back: any new always-visible control on it
  needs Aaron's say-so.
- A feature silently disappears because it had no home in the new layout.
- Times shown in the viewer's zone when the place is elsewhere (place-local
  time is already built; keep it everywhere).
- Copy that says "flat" for the map projection. It is "Mercator".
- Em dashes in UI copy.

## Decided with Aaron

### Phone layout (portrait phones)

- **Header bar:** wordmark, then the **📍 location pill** (place name and ▾),
  then search (🔍, expands to the search field), then **⋯**.
- **At rest:** map on top, the pass list right below it.
- **Scrolling:** the list slides up over the map like a sheet, leaving a
  strip of map visible. Scrolling back up brings the map back. This uses
  ordinary page scrolling (sticky/scroll layout), not a custom drag sheet.
- **Map overlay buttons:** layers (◱) and full screen (⤢). Nothing else
  sits on the map besides satellite labels.
- **Default projection:** Globe on portrait phones, Mercator elsewhere. Users
  can switch in the layers menu, and the choice is remembered. (Already how
  `defaultProjectionFor` in `lib/map/view.mjs` works.)

### Pass list (phone and desktop)

- Heading row: **"Passes"** with a small **Visual | Radio** switch on it.
  The switch replaces today's mode control.
- Passes are grouped under day headings ("Tonight", "Friday", ...), in the
  place's zone.
- **One compact row per pass, no wrapping:**
  - left edge: a thin bar in the satellite's map colour;
  - time column: start time in bold, then "in 3 h" (today) or the short day;
  - middle: satellite name, and one detail line: highest elevation ·
    duration · direction (e.g. "54° · 5 min · SW→NE"), ellipsised if it
    would wrap;
  - right: the quality pill (Great / OK / Faint, from the existing visual
    rating). The colour dot does not get its own line.
- **Tap a row** and it opens in place:
  - a small sky disc (polar plot of the pass);
  - Rises / Highest / Sets with time and direction;
  - brightness (magnitude) and the cloud note;
  - buttons: **Sky chart**, **Remind me**, **Share**, and **Live** when a
    pass is live; then a "**ISS page ›**" link (that satellite's page).
  - In radio mode the open row shows the radio essentials (Doppler and
    frequencies) and its buttons open the radio chart instead of the sky
    chart.
- Opening a row highlights that pass on the map.
- **Phone:** all rows start closed. **Desktop:** the next pass starts open.

### Desktop layout

- **Header:** wordmark, search field, 📍 location pill, the clock (UTC with
  "your time" under it), ⋯.
- **Body:** map on the left with the same two overlay buttons (layers,
  full screen); the pass panel on the right.
- **Panel:** "Passes" heading with the Visual | Radio switch, the **slim
  24-hour strip** (desktop only), then the same day-grouped compact list.

### Location sheet (tap the 📍 pill)

Bottom sheet on phones, a popover/panel on desktop. Title "Passes from".

- A search field: place, "lat, lon", or grid locator (e.g. EN52ve).
- **Use my location** ("Stays on this device").
- **Recent places**, the current one ticked. A place in another zone says so
  ("Times shown in Tokyo time").
- **Picking a place replaces the current place** (Aaron's decision). There is
  one place, as today (`prefs.location`): the pill, the next visit, the
  satellite pages and share links all use it. The previous place stays in
  the recent list, one tap away. No separate "home" place, so the mockup's
  🏠 "Saved" label is dropped.
- (The mockup's "Add a place to compare" row is dropped from home; see
  "My calls".)

### Settings sheet (tap ⋯)

Bottom sheet on phones, a dropdown panel on desktop. Holds everything you set
once and forget:

- Sky where you watch (sky type)
- Lowest pass to show (stepper, degrees)
- Radio bands
- Following (list of followed satellites, manage them)
- Theme
- Night vision
- About SeekSat
- Send feedback

### Layers menu (◱ on the map)

- Map: **Globe | Mercator**.
- "What you see": the legend (today's collapsible legend text and samples).

### Other places on the satellite page (Aaron's decision)

Extra observers stay, on satellite pages only. Aaron had one saved without
realising it, and the pass list silently shrank. So whenever extra places
are on, the satellite page's pass list must say so, unmissably, at the top
of the list: "Showing passes Chicago and Tokyo can both see" (all place
names, "can all see" for three or more) with a **Turn off** button that
removes the extra places. It shows in the pass list itself, not only in
the "other places" box below it. A shared view with places shows the same
line without the button.

### Logo

Two-tone wordmark in the header, same as the charts and share cards. Done
already (c1f5043, ea9c9b8).

## Where every current piece goes

| Today | New home |
|---|---|
| Location card / LocationPrompt row | 📍 pill and location sheet. First-run prompt stays (see below). |
| Visual / Radio control in HomeControls | Switch on the "Passes" heading |
| Sky type, lowest pass (min elevation), radio bands | ⋯ settings |
| Zone note ("Times are Tokyo time (UTC+9).") | Location sheet row, and under the "Passes" heading when the place's clock differs from the viewer's |
| Map legend (collapsible, over the map) | Layers menu |
| Projection switch | Layers menu |
| Next 24 hours Timeline | Desktop: the slim 24-hour strip. Phone: gone. |
| Up Now | Gone from the main screen on both (my call, see below) |
| NextStrip "Next:" banner | Gone. The list's first row is the next pass. |
| NextUpList big cards | Compact rows that open on tap |
| Card extras: follow chip, element tags, best-pass line, cloud badge, Live, alert bell, .ics download, share | Inside the open row (my call on placement, see below) |
| SatChips row (focus / hide) | Home: satellite labels on the map focus a satellite; hide and unfollow live in ⋯ › Following (my call). Satellite page: unchanged. |
| Globe camera presets, Reset view, view Share | Layers menu (my call) |
| Zoom + / − | Desktop only (my call) |
| Extra observers ("compare places") | Satellite page only, plus an unmissable "Showing passes ... can both see · Turn off" line on its pass list (Aaron) |
| FocusBar | Stays, as a slim bar over the map while a satellite is focused (my call) |
| Theme toggle, night toggle in the header | ⋯ settings |
| AboutSection | ⋯ › About SeekSat (see "About and crawlers") |
| SiteFooter (feedback, credit) | Stays at the very end of the page, below the list; feedback also in ⋯ |
| Popular picks (empty state, keep-after-follow) | Unchanged behaviour, shown below the list |
| Shared-view banner, ShareButton | Unchanged |

## My calls (Aaron can overrule)

- **Up Now** leaves the main screen on desktop too. A pass in progress shows
  as the first row with a "Now" state and the Live button instead.
- **Card extras** (follow/unfollow, element tags, .ics, cloud badge) all go
  in the open row, below the main buttons, so the closed row stays one line.
- **SatChips** leave the phone main screen; the map labels and ⋯ › Following
  cover focus, hide and unfollow.
- **Recent places** keeps the last 5 places on the device (a new list in
  `seeksat.home.v1`; old prefs without it load as an empty list).
- **About and crawlers:** the About text moves behind ⋯, but stays in the
  server-rendered HTML (closed sheet or `<details>`), so search engines still
  read it.
- **24-hour strip:** desktop only.
- **Add a place to compare** is not on the home location sheet. Extra
  observers stay on the satellite page as today; making the home list
  multi-observer would be a new prediction feature (non-goal).
- **List length:** rows cover the existing next-up window (48 h). The list
  shows the first 12 rows, then "Show more" reveals the rest.
- **Satellites without a pass row:**
  - Stationary satellites (geosync, e.g. QO-100) get a row in an "Always up"
    group after the passes, with the pointing (azimuth, elevation) as the
    detail line. In radio mode it opens to the radio essentials.
  - "No passes in 48 h", "unavailable" and "missing" collapse into one quiet
    line at the end: "No passes in the next 48 h: X, Y".
  - A focused satellite you don't follow gets a pinned row at the top of the
    list with a Follow button, as its card does today.
- **"Highlights that pass on the map"** means the row's satellite gets the
  existing focus emphasis, without navigating to its page. No new map
  drawing. On phones, opening a row does not scroll the page.
- **Other map controls:**
  - Globe camera presets (On you, Satellite, poles, Night side) and Reset
    view go in the layers menu under "View".
  - The view Share button goes in the layers menu as "Share this view".
  - Zoom + and − stay on desktop only (small, bottom corner). Phones pinch.
- **The satellite page and desktop:** the new map overlays (layers, full
  screen) are one design used on both pages. SatChips leave the home page
  on every screen size; the satellite page keeps its chips.

## Unchanged behaviour to keep

- First visit with no location: the location prompt is the main content,
  with popular picks below, as today.
- Empty following list: popular picks; following one keeps the list visible
  (`keepPopular`).
- Place-local times everywhere (`usePlaceZone`, `observer.tz`).
- Remembered preferences in `seeksat.home.v1`; old saved prefs must load.
- Share links and view links (`lib/share/*`) keep working, including mode and
  projection.

## Constraints

- Next.js app as it stands; reuse `components/ui/*` and design-bible tokens
  rather than restyling locally.
- No new dependencies unless pinned to a version at least two weeks old.
- Sheets and popovers are proper dialogs: focus trapped (`useFocusTrap`),
  Escape closes, focus returns to the button that opened them. Rows that
  open are buttons with `aria-expanded`.
- Light, dark and night vision all work; night vision stays red-only.
- Screenshot checks at desktop 1280 and phone 360 and 390.
- Never hit CelesTrak from a laptop and never call `/api/cron/*` or
  `/api/refresh-tle` while testing.
- Copy: "Mercator", no em dashes.

## Left to the builder

- Exact breakpoints (reuse the existing docked-panel breakpoint), sizes and
  spacing, within the bible's tokens.
- How the scroll-over-map effect is built, as long as it is plain page
  scroll and works on iOS Safari and Android Chrome.
- How the location and settings sheets share code with existing modals.
- Order of the work and how to split it into reviewable steps.
- Search behaviour on phones (expanding field or sheet), as long as it is
  one tap from the header.
