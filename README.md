# ISS Triangulation

3D web viz that triangulates a satellite's position from two or more ground
observations and renders the sightlines on a CesiumJS Earth.

Pre-filled with the Coffee + SEA FOAM ISS observation from
**2026-05-11 10:32:29 CDT** (15:32:29 UTC).

## Run

    python3 -m http.server 8000

Then open <http://localhost:8000/>. No build step.

## Inputs

Each observation row: name, lat, lon, elevation (m), direction mode (RA/Dec
or Alt/Az), and two direction values. Lat/lon accept DMS strings
(`40°30'30.0"N`) or decimal. RA accepts `HH MM SS`, `HHh MMm SSs`, or
decimal hours. Dec accepts DMS or decimal.

## Math

- Each observation is converted to a ray in ECEF (Earth-Centered, Earth-Fixed).
- RA/Dec ray directions go ECI → ECEF via GMST rotation.
- Alt/Az ray directions go ENU → ECEF via the observer's local frame.
- Closest point to all rays is the least-squares minimizer of
  `Σ ‖(I − dᵢ dᵢᵀ)(x − pᵢ)‖²`, solved via a direct 3×3 inverse.

## TLE truth (optional)

Paste a two-line element set in the "Compare to TLE truth" panel. The
triangulated point and SGP4-propagated truth are shown together with the
miss distance in km.

## Test

    npm test

Runs pure-math unit tests via Node's built-in test runner (no npm deps).
