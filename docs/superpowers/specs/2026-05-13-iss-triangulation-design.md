# ISS Triangulation Visualization — Design

**Date:** 2026-05-13
**Status:** Approved (brainstorming phase)
**Trigger:** Coffee (Aaron) and SEA FOAM observed the ISS from two ground stations in IL and WI on 2026-05-11 at 10:32:29 CDT (15:32:29 UTC), each logging RA/Dec. We want a 3D web viz that triangulates the ISS position from their sightings and (optionally) overlays the truth from TLE data.

## Goal

A static, single-page CesiumJS webapp that:

1. Accepts N ≥ 2 ground observations (lat/lon/elev + direction as RA/Dec or Alt/Az + a shared timestamp).
2. Triangulates a target's 3D position via least-squares ray intersection.
3. Renders both observers and their sightlines on a photoreal 3D Earth, with the triangulated position highlighted.
4. Optionally accepts a TLE, propagates it via SGP4, and shows the "truth" alongside the triangulated answer with a miss-distance label.

Pre-filled with Monday's observation data so the page opens on the story of that night, but every field is editable so it doubles as a general triangulation tool.

## Non-Goals (YAGNI)

- Animating ISS along its full orbit / scrubbable timeline.
- Per-observation timestamps (single shared moment for now).
- Persisting observations across reloads.
- Server-side anything. No build step. No auth.
- Deploy pipeline — it's a static folder the user can host wherever later.

## Architecture

Static single-page site, CesiumJS via CDN, no build step. Matches the existing
convention in `~/work/artemis-ground-track` and `~/work/analemma-sim` (plain
`index.html` + `.js` + `.css`, CDN libraries).

```
iss-triangulation/
├── index.html         page shell, panels, CDN imports
├── style.css          dark space theme, glass panel layout
├── app.js             wires UI ↔ Cesium ↔ math; pre-fills Monday's data
├── coords.js          RA/Dec ↔ Alt/Az ↔ ECI/ECEF helpers
├── triangulate.js     N-ray least-squares closest point (pure math, no Cesium)
├── truth.js           optional TLE → SGP4 → ECEF (uses satellite.js)
├── data/
│   └── monday.json    Coffee + SEA FOAM observations
└── docs/superpowers/specs/2026-05-13-iss-triangulation-design.md
```

External libs (CDN):

- **CesiumJS** — 3D Earth, entities, coordinate transforms.
- **satellite.js** — SGP4 for the optional TLE truth overlay.

Cesium needs an Ion access token for default world imagery. The library ships
with a default development token that works for personal/local use. `app.js`
surfaces it as a one-liner with a comment so it can be swapped for the user's
own token later.

## UI

Cesium viewer fills the screen. Two floating glass panels matching the existing
`artemis-ground-track` aesthetic (dark `#0a0e1a`, accent `#7eb8ff`,
`backdrop-filter: blur(12px)` info panels).

### Top-left "Observations" panel

- Single shared UTC timestamp at the top (plus a local-tz hint).
- Editable rows of observations, "+ Add observation" / "✕" per row.
- Pre-filled with Coffee + SEA FOAM Monday data.

Observation row fields:

| field | example |
|---|---|
| name | Coffee |
| color | warm orange (defaults rotate through palette) |
| lat | `42°09'15.9"N` (DMS or decimal both accepted) |
| lon | `88°11'59.9"W` |
| elevation (m) | `0` (optional, default 0) |
| direction mode | RA/Dec ▼ or Alt/Az |
| dir value 1 | RA `5h 30m 52.4110s` *or* Az `123.45°` |
| dir value 2 | Dec `41° 51' 10.0489"` *or* Alt `67.89°` |

### Top-right "Result" panel

- Triangulated lat / lon / alt (km above WGS84).
- Per-ray residual perpendicular distances (small = sightlines met cleanly).
- Collapsible TLE input (two lines). When filled, adds:
  - Truth lat / lon / alt.
  - Miss distance in km.

### Camera controls

Bottom-right buttons: `[Frame all]` `[From Coffee]` `[From SeaFoam]` `[Top down]`.

### Reactivity

Any input edit re-runs the pipeline and updates the Cesium entities + result
panel — no "Compute" button.

## Data Model

```js
{
  timestampUTC: "2026-05-11T15:32:29Z",
  observations: [
    {
      id: "coffee",
      name: "Coffee",
      color: "#ff9b54",
      latDeg: 42.154417,
      lonDeg: -88.199972,
      elevM: 0,
      dir: { mode: "radec", raHours: 5.5145586, decDeg: 41.852791 }
      // or { mode: "altaz", azDeg, altDeg }
    },
    { id: "seafoam", ... }
  ],
  tle: null  // or { line1, line2, name: "ISS (ZARYA)" }
}
```

## Math

All triangulation happens in **ECEF** (Earth-centered, Earth-fixed). Cesium
exposes ECEF natively as `Cartesian3`.

### Per observation: build a ray (origin + unit direction) in ECEF

1. **Observer origin (ECEF)** — `Cesium.Cartesian3.fromDegrees(lon, lat, elev)`.
2. **Direction vector:**
   - **RA/Dec → ECI unit vector:**
     `d_ECI = (cos(dec)·cos(ra), cos(dec)·sin(ra), sin(dec))`
   - **ECI → ECEF** via `Cesium.Transforms.computeIcrfToFixedMatrix(JulianDate)`
     at the timestamp. Falls back to a simple GMST rotation if ICRF data
     hasn't loaded — good to a few arc-seconds, well below the angular noise
     of an amateur eyeball sighting.
   - **Alt/Az → ENU unit vector:**
     `d_ENU = (sin(az)·cos(alt), cos(az)·cos(alt), sin(alt))`
   - **ENU → ECEF** via `Cesium.Transforms.eastNorthUpToFixedFrame(observerECEF)`,
     using only the 3×3 rotation part.
3. **Ray** = `{ origin: observerECEF, dir: directionECEF (unit) }`.

### Triangulate N rays — least-squares closest point

For each ray with origin pᵢ and unit direction dᵢ, the projection onto the line
is `dᵢdᵢᵀ`, and the orthogonal complement is `Aᵢ = I − dᵢdᵢᵀ`. The closest
point x to all rays minimizes ∑‖Aᵢ(x − pᵢ)‖², giving the 3×3 linear system:

```
(∑ Aᵢ) · x = ∑ Aᵢ pᵢ
```

Solved via direct 3×3 inverse — no linear-algebra library needed. Output
`triangulatedECEF`.

### Residuals

Per-ray perpendicular distance from x to ray i, surfaced in the result panel.
Small numbers (≲ 1 km for a good ISS observation) mean the sightlines actually
met cleanly.

### TLE truth (optional)

- `satellite.js`: `twoline2satrec(line1, line2)` → `propagate(satrec, jsDate)`
  → ECI position → `eciToEcf(eci, gstime(jsDate))`.
- Miss distance = `‖truthECEF − triangulatedECEF‖`.

### Pure math

`triangulate.js` and `coords.js` import nothing Cesium-specific — they take
numbers and return numbers, so they're trivially testable from Node.

## Visual Design

### Scene

- Cesium default Ion world imagery (photoreal Earth).
- Atmosphere and sun lighting at the observation timestamp (Monday's actual
  day/night terminator visible).
- Stars on (this is an astronomy project).
- Default Cesium toolbar/timeline UI chrome hidden; our panels replace them.

### Entities

| entity | style |
|---|---|
| Observer pin | colored billboard, label with name |
| Sightline ray | thick glowing polyline from observer ECEF along dir, length ≈ 2× triangulated range so it visibly passes through the meeting point; per-observer color, additive blend |
| Triangulated ISS | small ISS 3D model (fallback: bright pulsing point), label `Triangulated · 412.3 km` |
| Truth ISS (if TLE) | translucent ghost sphere + label `Truth (TLE)` |
| Miss segment | dashed line between triangulated and truth, midpoint label `Δ 8.4 km` |

### Palette

- Base: `#0a0e1a` (deep space), accents `#7eb8ff`. Matches existing viz projects.
- Coffee → `#ff9b54` (warm orange, fits callsign).
- SEA FOAM → `#7fe5d1` (teal/seafoam, obviously).
- Truth → `#7eb8ff` (cool blue).
- Triangulated → `#ffffff` (bright neutral).

### Camera

- Initial framing: bounding sphere around all observers + triangulated point;
  fly to a 3/4 angle that visibly captures rays converging.
- Buttons: `[Frame all]` `[From Coffee]` `[From SeaFoam]` `[Top down]`.

## Pre-Filled Monday Data

Saved to `data/monday.json` so users see the story on first load:

| field | Coffee | SEA FOAM |
|---|---|---|
| lat | 42°09'15.9"N (42.154417°) | 43°05'33.6"N (43.092667°) |
| lon | 88°11'59.9"W (−88.199972°) | 88°01'18.1"W (−88.021694°) |
| RA | 5h 30m 52.4110s | 5h 48m 47.7690s |
| Dec | 41° 51' 10.0489" | 39° 25' 42.3185" |

Shared timestamp: `2026-05-11T15:32:29Z` (10:32:29 CDT).

## Testing

### Unit tests (Node, run via `node test/triangulate.test.mjs` etc.)

`triangulate.test.mjs`:

1. Two perfectly-aimed rays at a known point → returned point matches within < 1 mm.
2. Two rays at a known point with small angular noise added → returned point within expected noise envelope.
3. Near-parallel rays → result flagged via large per-ray residual.

`coords.test.mjs`:

1. RA/Dec → direction vector → back to RA/Dec round-trips to < 1 µas.
2. ENU → ECEF on a known lat/lon matches a manually-derived rotation.

### Manual smoke test

Open `index.html`, no TLE entered; verify pre-filled Monday data renders a
sensible triangulated point above roughly the IL/WI region, rays visibly meet,
result panel populated.

## Open Items / Future Work

- Per-observation timestamps (multiple moments along an orbit pass).
- Save/share observations via URL fragment.
- Cesium Ion token customization documented in the README.
- Possible expansion: pull a live ISS TLE from Celestrak if user clicks "Use
  current ISS TLE."
