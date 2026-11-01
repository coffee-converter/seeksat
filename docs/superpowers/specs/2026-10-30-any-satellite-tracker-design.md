# Any-satellite tracker: flat map, satellite pages, honest numbers

Design spec, 2026-10-30

## 1. Why

SeekSat today is a pass finder for five curated satellites on a Cesium
globe. Aaron wants it to become the satellite tracker he and the public
reach for instead of N2YO: for checking numbers and for planning passes.

The moment that started this: looking up a Molniya satellite's speed and
altitude. N2YO shows a speed computed as `sqrt(398600.8 / (alt + 6378.135))`,
a circular-orbit speed, for every satellite (`n2yo4.0.js`, `updatePanel`,
real value commented out). For MOLNIYA 1-91 (NORAD 25485, 1,702 x 33,142 km,
e = 0.660) that is 72% too high near apogee and 22% too low at perigee.
People then compute v²r from N2YO, get GM for every orbit, and conclude
v²r = GM is a law. Getting this right, visibly, is the point.

Aaron uses passes almost daily: recording ISS by radio, Meteor LRPT for
images, and visual passes too. He also wants the public to use it.

## 2. What competitors leave open (survey, 2026-10-29)

N2YO (fake speed, no TLE age, no passes for orbits over 4 h, ad-heavy),
Heavens-Above (great visual passes, no live map, not responsive), Satflare
(dated, no speed), wheretheiss.at (ISS only), KeepTrack (correct but a
2.7 MB 3D app that fails on phones), satellitemap.space (globe only, no
per-satellite pages, no passes), Stuff in Space (down), CelesTrak (data,
not a tracker). Nobody combines a light phone-friendly flat map, crawlable
per-satellite pages, and honest numbers.

## 3. Goals (version one)

Aaron picked these five:

1. **Flat map first, light, phone-friendly.** Replaces the Cesium globe.
2. **A crawlable, shareable page per satellite** with live numbers.
3. **Honest numbers:** real speed, TLE age and source, staleness warning,
   "how we compute this".
4. **Passes for any orbit from your location, no setup**, for radio and
   visual, including HEO and GEO.
5. **Robust data plumbing:** the full catalog mirrored from CelesTrak within
   its usage limits, stored as OMM so 6-digit NORAD IDs work.

Success test: open the MOLNIYA 1-91 page on a phone, see a speed that
agrees with vis-viva at the shown distance from Earth's center to better
than 1%, the TLE's age, and its next passes from EN52ve.

## 4. Non-goals (later, not now)

- Plain-English orbit explainers per satellite (next, likely).
- Public read API / embeds (next, likely).
- Push alerts, rig control or automatic hand-off to recorder software.
- Visual magnitude estimates for arbitrary satellites (curated ones keep
  `standardMag`).
- Accounts or server-side user data.
- A 3D view of any kind.

## 5. Anti-goals (would make this a failure even if it works)

- Any number shown with false confidence. Every value says what it is
  (inertial speed vs ground speed, altitude vs distance from center,
  mean vs osculating) and where it came from.
- A heavy page. The map must open fast on a mid-range phone.
- Ads.
- Getting SeekSat's server blocked by CelesTrak for over-fetching.
- Breaking existing share links (`/?s=...`) or the MCP server.
- Losing the look of the existing polar sky chart and radio chart. Aaron
  loves how they look; they stay as they are.

## 6. Decided

### 6.1 Where it lives

The existing SeekSat repo and deployment (Next.js App Router, React,
Zustand, satellite.js, Vercel). Not a new site.

### 6.2 Home screen

A mix of "next up" and map:

- Search bar pinned on top (any name or NORAD ID).
- Flat map on the top half, showing only the satellites you follow, with
  ground tracks.
- Below it, "Next up" pass cards from your location for the satellites you
  follow, each with its small polar plot (the existing `PolarPlot` look)
  and a countdown, e.g. "ISS in 42 min, max 67°".
- First visit with no location: the cards become a "Use my location"
  prompt plus popular satellites (ISS, Tiangong, a Meteor, a NOAA), so the
  page is never empty.

### 6.2a Map projections

Added 2026-11-01 at Aaron's request. The flat map can switch between five
projections, remembered on the device:

1. **Equirectangular** (default): the familiar latitude/longitude grid,
   ground tracks as sine waves.
2. **Azimuthal equidistant, centered on you:** distance and bearing from
   your location are true, so antenna headings read straight off the map.
3. **Polar, north or south:** for polar orbits, high-latitude passes and
   Molniya apogees.
4. **Winkel tripel:** the low-distortion world view (chosen over Equal
   Earth, since true area does not matter here).
5. **View from the satellite** (near-side perspective): Earth as the
   selected satellite sees it from its altitude; the visible disk's edge is
   its coverage.

Rejected: Mercator (stretches high latitudes and footprints), Lambert
conformal conic (regional only), orthographic (reads as 3D), gnomonic
(under a hemisphere).

### 6.3 Satellite page

One page per NORAD ID at a clean URL (shape left to the builder, e.g.
`/sat/25485` or `/sat/25485-molniya-1-91`). Server-rendered so search
engines and link previews see real content; numbers then go live in the
browser. Contents:

- Name, NORAD ID, international designator if known, status.
- Live numbers (6.4), each with a one-line "how we compute this".
- Small map with the ground track.
- "Where am I in my orbit" diagram: the orbit ellipse in its plane with
  Earth, perigee, apogee and a live dot (vrgm's orbit diagram is the
  reference: `/Users/aaron/work/vrgm/vrgm.py`, `one_orbit` / card diagram).
- Passes from your location (6.5).
- Known downlink frequencies when the catalog has them.
- The raw elements, with copy buttons: 2LE and 3LE (name line plus the
  two TLE lines) when the NORAD ID fits the TLE format, and the OMM for
  every object (the only form for IDs above 99999). Added 2026-10-30 at
  Aaron's request.

### 6.4 Honest numbers

From SGP4 via satellite.js on the current element set:

- Speed: inertial, from the SGP4 TEME velocity vector. Labeled as such.
- Altitude above the WGS84 ellipsoid, and distance from Earth's center.
- Perigee and apogee altitude, eccentricity, period, inclination,
  semi-major axis.
- v²r/GM next to vis-viva's 2 − r/a, the comparison that started this.
- Element set epoch, its age ("TLE is 2.3 days old"), and its source
  (CelesTrak GP, with fetch time).
- Staleness badge when the element set is old (thresholds left to the
  builder; satellitemap.space flags over 7 days and hides over 10).

### 6.5 Passes

- **Location:** browser geolocation, a typed place (existing
  `geocode.js`), or a Maidenhead grid square like EN52ve (new). Saved on
  the device; no account.
- **List:** next 10 days for any satellite. Each row: start, peak and end
  times; max elevation; start and end azimuth; a "visible" tag when the
  satellite is sunlit and the observer's sky is dark.
- **Mode toggle:** radio shows every pass above a minimum elevation
  (default 10°); visual shows only visible passes. The existing
  `ModeToggle` / `MinElevControl` behavior is the model.
- **One pass:** the existing sky chart (polar modal) and radio chart
  (Doppler, angular rate, signal envelope, CSV export, PNG export), using
  the catalog downlink or a typed frequency.
- **Odd orbits:** GEO shows a fixed pointing (azimuth/elevation) or "never
  rises here" instead of a list. Molniya-type passes can last 8+ hours and
  are shown as such. Passes more than a few days out carry an accuracy
  warning tied to element age.
- **Calendar:** "Add to calendar" downloads an .ics for a pass.
- **Joint windows stay as a mode** (Aaron's decision). Your location is the
  default observer; on a satellite's pass list you can add more observers
  and get the windows when all of them can see it, as the existing finder
  does (`window-scoring.js`, `findVisibilityWindows`). One pass engine
  serves both: a single observer is the one-observer case.

### 6.5a Frequencies

Hand-curated, by Aaron's decision. The curated `CATALOG` grows to cover
the satellites he and radio users actually work: Meteor-M LRPT, any NOAA
APT still transmitting, popular amateur satellites. Each frequency is
verified against a current source before it is added, matching the
comments already in `lib/catalog.mjs`. Every other satellite takes a
typed frequency. SatNOGS DB import is a later project.

### 6.6 Reuse the sky chart and radio chart unchanged in look

The painters in `lib/pass-finder/` (polar arc, bodies, stars,
constellations, events, modal frame, PNG export, radio chart, Doppler,
radio optics, radio CSV) are pure modules and stay. Two changes:

1. Their orchestration lives in `lib/pass-finder-scene.js`, which is the
   Cesium scene file. Move it into plain code with no Cesium dependency.
2. They are ISS-specific (about 150 references in that scene file, plus
   names like `issEcefAtFn`, `observerSeesIss`, the `iss-pass` export
   prefix). Parameterize to any satellite.

### 6.7 Data

- **Source:** CelesTrak GP data in OMM (JSON or CSV), fetched by group,
  not per satellite. 5-digit catalog numbers ran out 2026-07-11; TLE text
  cannot carry newer objects, OMM can. satellite.js 6.0.2 (installed)
  parses OMM via `json2satrec`.
- **Objects outside the groups** (dead payloads, rocket bodies, debris,
  possibly MOLNIYA 1-91 itself): Aaron chose an on-demand fetch plus
  Space-Track. In version one, looking up a NORAD ID the mirror lacks
  triggers a single CelesTrak `CATNR` fetch. The result is cached until the
  next refresh and rate-limited globally, so a crawler walking IDs cannot
  turn into a per-satellite download loop. Space-Track (free account, full
  ~30,000 objects) is the second phase, gated on reading its user
  agreement first: its terms restrict passing data to third parties, and
  a public site showing derived positions may need approval. If the terms
  allow it, Space-Track replaces the on-demand fetch as the gap filler.
- **Refresh:** the existing Vercel Cron, about every 4 hours (CelesTrak
  publishes GP updates on roughly a 2-hour cycle and asks not to fetch the
  same data more often than it changes).
- **Storage:** Vercel Blob, the whole catalog as **one compressed file**
  rewritten each refresh (about 5 MB compact, about 2 MB gzipped, about
  180 writes a month). Not one blob per satellite, not bundles. Edge
  Config (now Global Config) is retired as the TLE store because it
  cannot hold this size.
- **Serving:** the server loads the file once per warm instance and keeps
  it in memory. Satellite pages are built on first request and cached
  until the next refresh (no prebuilding 30,000 pages); preview images
  likewise. The sitemap lists every object in the mirror. The map and search call API routes that return only the
  satellites asked for, cached at the CDN. Phones never download the full
  catalog.
- **Positions and passes** are computed in the browser, as today.

## 7. Constraints

- CelesTrak usage policy: group queries, no repeated identical downloads
  within an update cycle, respect blocks. CelesTrak refused connections
  from the survey environment, so its current limits are unverified.
- Vercel Blob's free allowance: unverified for current pricing; confirm
  before relying on it.
- Writing style for all user-facing copy: plain language, no em dashes.
- Existing tests run with `node --test` (`npm test`); new pure modules
  get tests in the same style.

## 8. Open, to verify before or during planning

- **Full catalog availability.** It is not confirmed that CelesTrak serves
  all ~30,000 on-orbit objects (debris included) in one keyless download.
  It may only cover active satellites (over 10,000), with the rest needing
  Space-Track (free account). The on-demand fetch in 6.7 covers the gap
  either way; the builder confirms MOLNIYA 1-91 resolves through one path
  or the other.
- **Space-Track terms.** Read the user agreement before phase two (6.7).
- **Pass search for HEO/GEO.** The existing finder's step sizes and window
  logic assume LEO; the builder must verify it on MOLNIYA 1-91 and a GEO
  satellite.

## 9. My calls (Claude's, not Aaron's; flag any you disagree with)

- The Cesium globe is removed outright, not kept as a toggle. Cesium
  loader, camera controls, cubemap and the globe-tied onboarding tour go
  with it. `legacy/` and the unrouted triangulate code are left alone.
- The flat map is drawn by us on a canvas, not with a tile library, to
  avoid a tile vendor and keep the page light: a bundled Natural Earth
  land file, terminator and footprint drawn by us, modest pan/zoom. The
  projection math comes from `d3-geo` and `d3-geo-projection` (revised
  2026-11-01 for the projections in 6.2a).
- "Following" is a list in local storage, seeded with the popular set.
- Ground speed is shown separately from inertial speed and clearly
  labeled, because that confusion is part of what this fixes.
- The MCP server keeps working and reads from the new store; its tools
  accept any NORAD ID rather than only the curated five.
- The curated `CATALOG` survives as metadata (downlinks, magnitudes,
  aliases, popular set), not as the list of trackable satellites.
- While the new home screen and the Cesium app coexist (until Cesium
  removal), the new home takes `/` and the Cesium app moves to `/classic`;
  `/?s=` links redirect there with their query intact, so they keep
  working. Cesium loads only on `/classic`. (Added 2026-11-01.)
- Old `/?s=` share links carry no satellite ID, so they open the ISS
  satellite page with that pass, mode, frequency and observers restored,
  which is what they show today. New share links are satellite-page URLs
  that carry the satellite; the state blob gains a satellite field.
- Space-Track as phase two rather than in version one, because of its
  redistribution terms.
- Satellite pages get link-preview images (pass chart or a simple card).

## 10. Left to the builder

- URL shape for satellite pages and search.
- Exact staleness thresholds and accuracy-warning horizon.
- Whether pass search runs in a Web Worker.
- File format of the compressed catalog and the API route shapes.
- Build order. Suggested: data mirror and store swap, then any-satellite
  generalization of the pass and chart modules, then satellite pages, then
  the flat map and home screen, then Cesium removal.
- Visual design of the new map and home, within the existing look (dark
  theme, Exo 2).
