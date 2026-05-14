# ISS Multi-Observer Pass Finder — Design

**Date:** 2026-05-14
**Status:** Approved (brainstorming phase)
**Trigger:** New tool sibling to the triangulation page. User places multiple ground points (lat/lon or geocoded place name); tool walks forward from "now" on the ISS TLE and finds candidate passes that are simultaneously naked-eye visible from ALL placed points. Optional 3D animation of the ISS over the search horizon, plus a clickable sidebar of detected windows.

## Goal

A static, no-build-step companion page (`pass-finder.html`) that:

1. Lets the user place ≥ 1 ground observer (lat/lon DMS or decimal, geocoded place name, or click-on-globe).
2. Fetches the current ISS TLE from Celestrak on load (editable, with a "Refetch" button; paste fallback if fetch fails).
3. Runs an offline sampler over a user-selected horizon (default 7 days; options 3 / 7 / 14 / 30) to find all simultaneous-visibility windows.
4. Lists windows in a sidebar; clicking a row jumps the Cesium scene to that moment.
5. Optional 3D playback that animates ISS forward at a user-set time multiplier.
6. "Find more" button extends the search another horizon-length forward.

## Non-Goals (YAGNI)

- Predicting passes for non-ISS objects (TLE input is single-satellite for now).
- Solar/lunar visualization for the animation (use what Cesium provides analytically; no separate sun/moon overlay).
- Saving results, sharing URLs, exporting to calendar.
- Server-side anything. No build step. No auth.
- Mobile-first design — desktop layout, scales down passably.

## Architecture

Static single-page sibling to the existing triangulation tool, sharing the same
repo and several modules. CesiumJS + satellite.js via CDN (already loaded by
the triangulation page).

```
iss-triangulation/
├── pass-finder.html         page shell + panels
├── pass-finder.js           main: Cesium scene, UI wiring, animation
├── pass-finder.css          extends shared style.css with pass-finder layout
├── pass-finder/
│   ├── visibility.js        pure math: ISS alt, sun alt, Earth shadow test
│   ├── geocode.js           Nominatim wrapper with debounce + cache
│   └── search.js            walk-forward sampler -> windows
├── test/
│   ├── visibility.test.mjs
│   └── search.test.mjs
└── (shared modules — unchanged)
    ├── coords.js            ECEF, GMST, parsing, ENU rotation
    ├── truth.js             SGP4 propagation
    └── style.css            theme tokens
```

External libs (CDN, all the same as the triangulation page):
- **CesiumJS 1.119** — 3D Earth, entities, animation clock
- **satellite.js 5.0.0** — SGP4

External services:
- **Celestrak** — TLE source via `https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE` (CORS-friendly, no auth)
- **Nominatim** — OSM geocoding via `https://nominatim.openstreetmap.org/search?q=...&format=json&limit=1` (CORS-friendly, polite-use only — debounced + cached + sets a `User-Agent`-style identifying string)

## UI

Cesium viewer fills the screen. Two floating glass panels matching the
triangulation page's aesthetic.

### Top-left: Observers panel

- List of placed observers as cards (same compact chip layout as triangulation
  page). Each card shows: swatch + name (editable) + lat/lon + `[✕ remove]`.
- Below the list, three ways to add a point:
  - `[Add by lat/lon]` — single input accepting DMS or decimal, parsed via
    `parseDmsToDecimal`.
  - `[Geocode]` — text input that hits Nominatim after a 600 ms debounce; the
    first result is added as a new observer with name pulled from the result's
    display name. Cached per query string.
  - `[Click on globe]` toggle — when active, the next click on the Cesium
    globe drops a point at that surface lat/lon. Tooltip names it "Point N";
    user can rename inline.

### Top-right: Search & Windows panel

Top sub-block (search controls):
- TLE display: collapsible `<details>` with `name`, `line1`, `line2`
  textareas. Auto-fetched from Celestrak on load; user can edit; `[Refetch]`
  button re-pulls.
- `Horizon: [7 days ▾]` selector (default 7; options 3 / 7 / 14 / 30 days).
- `Time multiplier: [×4000 ▾]` selector (default 4000× → 7 days plays back
  in ~2.5 min; options 1000 / 4000 / 10000 / 30000).
- `[▶ Play] [⏸ Pause] [⏮ Reset]` playback controls.
- `[Find passes]` runs the search.
- `[Find more]` extends the search window another horizon-length forward.

Bottom sub-block (results):
- Sidebar list of detected simultaneous-visibility windows. Each row:
  `MM-DD HH:MM` start time · `Xm Ys` duration · peak `XX°` (min of
  per-observer peak altitudes). Click → scene jumps to window's start
  (animation paused).

### Bottom-right: Camera presets

`Frame all` / `Top down` / `Auto-rotate` — reused from the triangulation page.

### Cesium scene contents

- Earth with imagery picker (reuse providers + switcher from triangulation page).
- Observer pins on the surface, clamped to the WGS84 ellipsoid.
- ISS entity: pulsing white point + label "ISS @ alt km" updated each frame.
- Faint dashed full-orbit polyline for the current orbit (refreshes as the
  orbit precesses over the days of the search).
- Optional visibility highlight per observer: when ISS is currently above the
  observer's local 10° altitude threshold, the observer dot pulses green;
  when all observers are simultaneously green AND ISS is illuminated AND each
  observer is in twilight, a glowing connecting line links them through the ISS.

## Data Model

```js
{
  observers: [
    { id, name, color, latDeg, lonDeg }
  ],
  tle: { name, line1, line2 } | null,
  horizonDays: 7,
  multiplier: 4000,
  searchStartMs: Date.now(),
  searchEndMs: searchStartMs + horizonDays * 86400_000,
  windows: [
    { startMs, endMs, peakMs, perObserverPeakDeg: [obsIdx -> number] }
  ],
  playing: false,
  clickToPlace: false,
}
```

Observer schema is shallower than triangulation's (no `dir` field — just a
ground point).

## Math

### Visibility predicate (pure function in `visibility.js`)

For a sample at time `t`:

1. **Sun position** in ECEF.
   - Low-precision solar ephemeris (hand-rolled, ~0.01° accuracy is sufficient):
     given UTC date, compute mean anomaly, ecliptic longitude, RA/Dec → ECI
     unit vector → rotate by GMST to ECEF.
   - Solar distance is irrelevant; only direction is needed for shadow tests.

2. **ISS position** in ECEF.
   - `tlePositionEcef(line1, line2, jsDate)` (existing in `truth.js`).

3. **Per observer:**
   - Observer ECEF via `geodeticToEcef`.
   - Vector ISS−observer, rotated into observer's ENU frame (transpose of
     `enuToEcefRotate`).
   - ISS altitude = `atan2(u, hypot(e, n))` in degrees.
   - Sun's ENU vector at observer → sun altitude.
   - Pass: ISS altitude `> 10°` AND sun altitude `< −6°` (civil twilight).

4. **ISS illuminated (Earth-shadow test):**
   - Let `r` = ISS position (Earth-centered, meters), `ŝ` = unit sun direction.
   - Behind Earth (anti-sun side): `r · (−ŝ) > 0`.
   - Inside cylindrical shadow: `|r − (r · (−ŝ)) · (−ŝ)| < R_earth_mean (≈ 6371 km)`.
   - ISS is illuminated iff NOT (behind AND inside).

A sample passes the predicate iff every observer satisfies (3) AND the ISS is
illuminated.

### Window detection (`search.js`)

```js
findWindows(observers, satrec, startMs, endMs, stepMs = 60_000) -> [
  { startMs, endMs, peakMs, perObserverPeakDeg }
]
```

- Walk forward at 1-minute granularity, evaluate predicate.
- On ON-transition: record candidate window start.
- On OFF-transition: refine both edges via bisection at 1-second resolution.
- Within each window: oversample at 5-second steps to find each observer's
  peak altitude and the overall "best moment" (where the minimum of all
  observer altitudes is maximized).

### Performance note

7 days × 1440 min = 10,080 samples. Per sample: 2 SGP4 evaluations (one for ISS,
sun ephemeris is cheap), 6 transcendental functions per observer. For ≤ 10
observers, well under 1 sec on a modern laptop.

## Animation Engine

Reuses Cesium's clock natively.

- `viewer.clock.startTime = JulianDate.fromDate(searchStartDate)`
- `viewer.clock.stopTime  = JulianDate.fromDate(searchEndDate)`
- `viewer.clock.multiplier = state.multiplier` (4000× default)
- `viewer.clock.clockRange = Cesium.ClockRange.CLAMPED` (don't loop)
- `viewer.clock.shouldAnimate = state.playing`

ISS entity uses a `CallbackProperty` for `position` that calls
`tlePositionEcef` with `viewer.clock.currentTime`, so the ISS position auto-
updates each frame.

Visibility-highlight overlays use `CallbackProperty` similarly: each frame,
check predicate per observer and toggle a `green-pulse` material.

Sidebar row click: `viewer.clock.currentTime = JulianDate.fromDate(window.startMs)`
and set `playing = false`. Optionally `flyTo` the ISS entity if camera should
follow.

## Visual Design

- Same dark palette as triangulation page (`#0a0e1a`, `#7eb8ff` accent).
- Observers get colors from the existing `PALETTE` (`#ff9b54`, `#7fe5d1`, `#c084fc`, `#facc15`, `#f87171`).
- Window-list rows: time + duration in monospace, peak altitude colored by
  quality (white > 50°, gray 20–50°, dim 10–20°).
- Sun/moon: rely on Cesium's analytic `viewer.scene.sun` / `viewer.scene.moon`
  (correct positions because we pin the clock). No custom overlay.

## Testing

### Unit tests (`node --test test/`)

`visibility.test.mjs`:

1. ISS at zenith over observer, sun below horizon, ISS in sunlight → visible.
2. ISS at 5° altitude → fails altitude threshold.
3. Sun above horizon at observer → fails twilight threshold.
4. ISS in Earth's shadow (anti-sun side, inside cylinder) → fails illumination.
5. Sun ephemeris: solar declination on equinox is ≈ 0°, on solstice is ≈ ±23.4°
   (within 0.5° tolerance).

`search.test.mjs`:

1. Synthetic predicate that's true over a known window → returns that window.
2. Two close windows with a brief OFF gap → returns two separate windows (not
   merged).
3. Bisection refinement: window edges accurate to ≤ 1 second.

### Manual smoke test

- Open `pass-finder.html`, allow Nominatim geocode for "Brookfield WI", confirm
  point lands at correct lat/lon.
- Click "Find passes". Verify sidebar shows a small number of windows for the
  next 7 days (single-observer ISS passes are ~3–5/day so several should appear).
- Click "Add by lat/lon" with "42°09'15.9\"N, 88°11'59.9\"W". Verify
  sidebar shrinks (fewer simultaneous passes with two distant points). Click a
  row, verify scene jumps and ISS sits above the two points.
- `[▶ Play]` and watch animation; verify observer dots pulse green during
  visibility windows.

## Open Items / Future Work

- TLE list expansion: pick from multiple satellites (Tiangong, Starlink, etc.)
  via a Celestrak group fetch.
- Pass quality scoring (magnitude / brightness via standard satellite-flux model).
- Export window list as ICS calendar invites.
- Share-by-URL: encode observer list + horizon into the URL fragment.
- Min-altitude threshold made configurable per observer.
