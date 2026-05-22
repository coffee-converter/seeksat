# SeekSat

Satellite pass forecasts for ground stations. Place one or more
observer locations on the globe, pick a satellite + a mode (visual
naked-eye or radio), and SeekSat finds the windows when every
observer can see (or reach) the satellite at once. Click a window to
open a fullscreen polar sky chart showing the trajectory with sun /
moon / planet / star context for that observer.

A private `/triangulate` page is included for multi-observer ray
triangulation against a TLE — useful for verifying the math against
recorded sightings.

Built on Next.js (App Router) + React + Zustand, with CesiumJS
loaded from CDN. SGP4 propagation via `satellite.js`.

## Run

```sh
npm install
npm run dev      # http://localhost:3000
```

Routes:
- `/` — pass finder (default)
- `/triangulate` — multi-observer ray triangulation (private, not linked from nav)

Production build:

```sh
npm run build && npm start
```

## Tests + type check

```sh
npm test         # 270+ Node-native unit tests (no jest)
npm run typecheck
```

Both run on every push + PR via `.github/workflows/ci.yml`.

## Pass-finder math

- Window search bisects observer visibility predicates (per-mode) on
  a coarse grid + refines to <1s resolution.
- Visual rating combines twilight, target altitude, and cloud-cover
  probability with explicit correlation-aware combiners (MIN across
  observers for sky-darkness + clouds, PRODUCT for altitude).
- Radio rating is peak-elevation × duration sigmoid.
- Polar plots draw the trajectory arc with magnitude-derived stroke
  opacity in visual mode, dashed where the satellite would be in
  Earth's shadow or the sky is too bright. Stars from a ~250-entry
  catalog, planets via truncated Keplerian elements, moon via
  low-precision Meeus lunar ephemeris.

## Triangulation math (`/triangulate`)

- Each observation → a ray in ECEF (Earth-Centered, Earth-Fixed).
- RA/Dec ray directions: ECI → ECEF via GMST rotation.
- Alt/Az ray directions: ENU → ECEF via the observer's local frame.
- Bennett refraction correction applied to apparent altitudes.
- Closest point to all rays = least-squares minimizer of
  `Σ ‖(I − dᵢ dᵢᵀ)(x − pᵢ)‖²`, solved via a direct 3×3 inverse.
- Per-ray residuals (meters) reported per observation.
- Optional SGP4-propagated TLE truth comparison with miss-distance.

## Adding observers

The home page accepts:
- **Lat/lon pair** — DMS (`42°09'15.9"N, 88°11'59.9"W`) or decimal
  (`42.1544, -88.1999`)
- **Place name** — any free text; geocoded via the OSM/Nominatim API
- **Use my location** — browser geolocation
- **Click on globe** — toggle the place-by-click mode, then click
  anywhere on the Cesium canvas

Observer set is persisted to localStorage; a Share button copies a
URL that encodes the current set + the selected pass window.

## Architecture

The two routes share the same Cesium viewer setup pattern:

- **Page (`app/[route]/page.tsx`)** — server component, just renders
  the app's client root.
- **App composition root (`components/{Triangulate,PassFinder}App.tsx`)**
  — `"use client"`, owns the container `ref`, calls `useCesiumViewer`,
  dynamically imports the scene module once the viewer is ready, and
  wraps children in `<CesiumViewerProvider>` so descendants can read
  the viewer via `useViewer()` without prop-drilling.
- **Scene module (`lib/{triangulate,pass-finder}-scene.js`)** —
  imperative Cesium island. Builds entities, subscribes to the
  relevant Zustand store, registers a typed `SceneBridge` (see
  `lib/scene-bridge.ts`) so React components can call back into the
  scene for one-shot commands like `addObserver` or
  `renderPolarModal`. Returns a teardown function.
- **Store** — Zustand. Triangulate uses `lib/store.ts`; the pass
  finder uses `lib/pass-finder-store.ts`. Each owns its own slice
  shape; nothing is shared across pages.
- **Pure modules (`lib/pass-finder/*.js`)** — about a dozen files of
  pure math + SVG painters extracted out of what used to be a single
  ~4k-line scene file. All have explicit deps (no scene-state
  reach-throughs); test coverage is in `test/`.

### Cesium loading

The CDN script is loaded by `<CesiumLoader>` (a client-only wrapper
around `next/script`). It fires `onReady` once and resolves a shared
promise in `lib/cesium-loaded.ts`, which `useCesiumViewer` awaits. No
polling. A `<link rel="preload">` in the layout starts the network
fetch in parallel with React hydration so the script lands as fast
as possible.
