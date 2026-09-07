import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sat from 'satellite.js';
import {
  makeSatStateAt, observerTemeAt, rangeRateMps, OMEGA_EARTH,
} from '../lib/pass-finder/sat-state.js';
import { geodeticToEcef } from '../lib/coords.js';

// A geostationary satellite is stationary in the Earth-fixed frame, so its
// range rate from any ground station must be ~0. This is the single most
// valuable test in the suite: it catches both a missing "-omega x r" term
// AND a sign error on it. Rotating satellite.js's TEME velocity with
// eciToEcf (a pure Z-rotation) and using it directly yields ~-341 m/s here;
// getting the sign backwards yields ~+680 m/s.
const GEO_L1 = '1 99999U 24001A   24001.50000000  .00000000  00000-0  00000-0 0  9990';
const GEO_L2 = '2 99999   0.0100 100.0000 0001000   0.0000   0.0000  1.00270000    09';

const CHICAGO = geodeticToEcef(41.88, -87.63, 180);

test('OMEGA_EARTH is the sidereal rate, not the solar-day rate', () => {
  assert.ok(Math.abs(OMEGA_EARTH - 7.292115855e-5) < 1e-13);
  // 2*PI/86400 = 7.2722e-5 would be a 0.27% error => up to 1.27 m/s of
  // observer velocity at the equator, 1.9 Hz at 437.8 MHz.
  assert.ok(Math.abs(OMEGA_EARTH - (2 * Math.PI) / 86400) > 1e-7);
});

test('geostationary range rate is ~0 from a ground station', () => {
  const satrec = sat.twoline2satrec(GEO_L1, GEO_L2);
  assert.equal(satrec.error, 0, 'GEO test TLE must parse cleanly');
  const stateAt = makeSatStateAt(sat, satrec);

  for (const hours of [0, 3, 9, 17]) {
    const d = new Date(Date.UTC(2024, 0, 1, hours, 0, 0));
    const st = stateAt(d);
    assert.ok(st, `propagation failed at +${hours}h`);
    const obs = observerTemeAt(CHICAGO, st.gmst);
    const rr = rangeRateMps(st.rTeme, st.vTeme, obs);
    assert.ok(
      Math.abs(rr) < 5,
      `GEO range rate should be ~0, got ${rr.toFixed(1)} m/s at +${hours}h`,
    );
  }
});

test('sat state is in metres, not kilometres', () => {
  const satrec = sat.twoline2satrec(GEO_L1, GEO_L2);
  const st = makeSatStateAt(sat, satrec)(new Date(Date.UTC(2024, 0, 1)));
  const r = Math.hypot(...st.rTeme);
  // Geostationary radius is 42164 km.
  assert.ok(r > 4.2e7 && r < 4.3e7, `expected ~4.2e7 m, got ${r}`);
  const v = Math.hypot(...st.vTeme);
  assert.ok(v > 3000 && v < 3200, `expected ~3075 m/s, got ${v}`);
});

test('observerTemeAt inverts eciToEcf and gives omega x r velocity', () => {
  const gmst = 1.234;
  const obs = observerTemeAt(CHICAGO, gmst);
  // Round-tripping through satellite.js's eciToEcf must return the input.
  const back = sat.eciToEcf({ x: obs.r[0], y: obs.r[1], z: obs.r[2] }, gmst);
  assert.ok(Math.abs(back.x - CHICAGO[0]) < 1e-6);
  assert.ok(Math.abs(back.y - CHICAGO[1]) < 1e-6);
  assert.ok(Math.abs(back.z - CHICAGO[2]) < 1e-6);
  // Velocity is perpendicular to the spin axis and to r's horizontal part.
  assert.equal(obs.v[2], 0);
  const speed = Math.hypot(obs.v[0], obs.v[1]);
  const expected = OMEGA_EARTH * Math.hypot(obs.r[0], obs.r[1]);
  assert.ok(Math.abs(speed - expected) < 1e-9);
});

test('propagation failure returns null rather than throwing', () => {
  // makeSatStateAt takes `sat` injected, so the guard can be exercised
  // directly. Driving a real satrec into an SGP4 error state needs a
  // fixture that decays or goes out of range, which is brittle; a stub
  // tests the contract the module actually documents.
  const stubSat = {
    propagate: () => ({ position: false, velocity: false }),
    gstime: () => 0,
    eciToEcf: () => ({ x: 0, y: 0, z: 0 }),
  };
  assert.equal(makeSatStateAt(stubSat, {})(new Date()), null);
});

test('a missing velocity alone is also treated as failure', () => {
  const stubSat = {
    propagate: () => ({ position: { x: 1, y: 2, z: 3 }, velocity: false }),
    gstime: () => 0,
    eciToEcf: () => ({ x: 1000, y: 2000, z: 3000 }),
  };
  assert.equal(makeSatStateAt(stubSat, {})(new Date()), null);
});
