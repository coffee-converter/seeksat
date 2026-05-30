// A frozen ISS TLE for deterministic tests (epoch 2026-ish). Values are
// a real historical ISS element set; tests assert geometry, not currency.
export const ISS_TLE = {
  name: "ISS (ZARYA)",
  line1: "1 25544U 98067A   26060.50000000  .00016717  00000-0  10270-3 0  9001",
  line2: "2 25544  51.6400 200.0000 0004700  30.0000 100.0000 15.50000000 10001",
};
// A fixed instant during a window where the ISS is above the horizon for
// the test observer below (precomputed to be > 0° at this epoch+obs).
export const SAMPLE_OBS = { name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 };
