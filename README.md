# ISS Triangulation

3D web viz of the International Space Station with two tools:

- **`/`** — Triangulate the ISS from ground observations. Each observer
  supplies a location + direction (RA/Dec or Alt/Az); the least-squares
  closest-point of the resulting ECEF rays is the inferred satellite
  position. Optional TLE-truth comparison via SGP4.
- **`/passes`** — Multi-observer pass finder. Place several stations,
  pick visual or radio mode, get a sortable table of windows when every
  observer can see (or reach) the ISS at once. Click a row to open a
  fullscreen polar sky chart with the pass trajectory + sun/moon/planet
  context for that observer.

Built on Next.js (App Router) + React + Zustand, with CesiumJS loaded
from CDN. SGP4 propagation via `satellite.js`.

## Run

```sh
npm install
npm run dev      # http://localhost:3000
```

Routes:
- `/` — triangulate
- `/passes` — pass finder

Production build:

```sh
npm run build && npm start
```

## Tests + type check

```sh
npm test         # 260+ Node-native unit tests (no jest)
npm run typecheck
```

Both run on every push + PR via `.github/workflows/ci.yml`.

## Triangulation inputs

Each observation row: name, lat, lon, elevation (m), direction mode
(RA/Dec or Alt/Az), and two direction values. Lat/lon accept DMS
strings (`42°09'15.9"N`) or decimal. RA accepts `HH MM SS`,
`HHh MMm SSs`, or decimal hours. Dec accepts DMS or decimal.

## Triangulation math

- Each observation → a ray in ECEF (Earth-Centered, Earth-Fixed).
- RA/Dec ray directions: ECI → ECEF via GMST rotation.
- Alt/Az ray directions: ENU → ECEF via the observer's local frame.
- Bennett refraction correction applied to apparent altitudes.
- Closest point to all rays = least-squares minimizer of
  `Σ ‖(I − dᵢ dᵢᵀ)(x − pᵢ)‖²`, solved via a direct 3×3 inverse.
- Per-ray residuals (meters) reported per observation.

## Pass-finder math

- Window search bisects observer visibility predicates (per-mode) on
  a coarse grid + refines to <1s resolution.
- Visual rating combines twilight, ISS altitude, and cloud-cover
  probability with explicit correlation-aware combiners (MIN across
  observers for sky-darkness + clouds, PRODUCT for altitude).
- Radio rating is peak-elevation × duration sigmoid.
- Polar plots draw the ISS arc with magnitude-derived stroke opacity
  in visual mode, dashed where the ISS would be in Earth's shadow or
  the sky is too bright. Stars from a ~250-entry catalog, planets via
  truncated Keplerian elements, moon via low-precision Meeus lunar
  ephemeris.

## TLE truth (triangulate page)

Paste a two-line element set in the right-side TLE panel. The
triangulated point and SGP4-propagated truth render together with the
miss distance.

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
fetch in parallel with React hydration so the script lands as fast as
possible.
