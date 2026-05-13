# ISS Triangulation

3D web viz that triangulates a satellite's position from two or more ground
observations and renders the sightlines on a CesiumJS Earth.

Pre-filled with the Coffee + SEA FOAM ISS observation from
2026-05-11 10:32:29 CDT.

## Run
Serve the folder (e.g. `python3 -m http.server 8000`) and open the URL.
No build step.

## Test
`npm test` runs the math/coords unit tests via Node's built-in test runner.
