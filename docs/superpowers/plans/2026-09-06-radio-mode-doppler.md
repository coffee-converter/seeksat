# Radio Mode Doppler Prediction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-observer radio-pass chart to SeekSat showing predicted Doppler, angular rate, and received-signal envelope on a shared time axis, plus a CSV export for driving a rig or camera.

**Architecture:** A pure sampler (`radio-pass.js`) is the single source of physics; a pure painter, a React modal mirroring `PolarModal.tsx`, and a CSV formatter all consume its output and never recompute. Doppler is computed entirely in the TEME frame so that satellite velocity is never rotated — this makes the 459 Hz `eciToEcf`-on-velocity trap structurally impossible.

**Tech Stack:** Next.js App Router, React 19, Zustand 5, satellite.js 6.0.2, hand-painted SVG, Node's built-in test runner (`node --test`, no jest).

**Spec:** `docs/superpowers/specs/2026-09-06-radio-mode-doppler-design.md`

## Global Constraints

- **Never `git push`, open a PR, or deploy.** Local commits only. seeksat.com is live and the user validates locally first.
- **Test runner:** `npm test` runs `node --test test/*.{mjs,js} test/og/*.{mjs,js}`. Single file: `node --test test/<name>.test.mjs`.
- **Test style:** `import { test } from 'node:test'; import assert from 'node:assert/strict';` — no jest, no describe blocks.
- **Pure modules** live in `lib/pass-finder/` with no React, no Cesium, no I/O. Imperative scene code stays in `lib/pass-finder-scene.js`.
- **Earth rotation rate is sidereal:** `7.292115855e-5` rad/s. Using `2π/86400` is a 2.0 Hz error.
- **Speed of light:** `299792458` m/s exactly.
- **satellite.js returns km and km/s.** Convert once, at the boundary in `sat-state.js`. Never convert twice.
- **JS `Date` is integer milliseconds.** All sample times are on a 1 ms grid.
- **Commit after every task** with a conventional-commit prefix (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`). No `Co-Authored-By` lines.
- Do not run `npm run build` or `npm test` beyond the specific test file for the task unless a step says to.

---

### Task 1: Satellite state sampler (position + velocity) with the GEO regression test

The existing `issEcefAt` (`lib/pass-finder-scene.js:879`) discards SGP4's velocity output. Doppler needs it. This task extracts a pure, testable state sampler and rewires the scene to use it, so there is exactly one propagation path.

**Files:**
- Create: `lib/pass-finder/sat-state.js`
- Create: `test/sat-state.test.mjs`
- Modify: `lib/pass-finder-scene.js:879-886`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `makeSatStateAt(sat, satrec) -> (jsDate: Date) => SatState | null`
  - `SatState = { rTeme: [number,number,number], vTeme: [...], rEcef: [...], gmst: number }` — metres and m/s.
  - `observerTemeAt(obsEcef: number[], gmst: number) -> { r: number[], v: number[] }`
  - `rangeRateMps(satTeme: number[], satVTeme: number[], obsTeme: {r,v}) -> number`
  - `OMEGA_EARTH: number`

- [ ] **Step 1: Write the failing test**

Create `test/sat-state.test.mjs`:

```javascript
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
  // 2*PI/86400 = 7.2722e-5 would be a 0.27% error => 2.0 Hz at 437.8 MHz.
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
  const satrec = sat.twoline2satrec(GEO_L1, GEO_L2);
  const stateAt = makeSatStateAt(sat, satrec);
  // Year 2400 is far enough past epoch that SGP4 reports an error.
  const st = stateAt(new Date(Date.UTC(2400, 0, 1)));
  assert.ok(st === null || Array.isArray(st.rTeme));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sat-state.test.mjs`
Expected: FAIL — `Cannot find module '../lib/pass-finder/sat-state.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/pass-finder/sat-state.js`:

```javascript
// lib/pass-finder/sat-state.js - satellite state (position AND velocity)
// sampler. Pure given an injected satellite.js module + satrec, so it is
// testable in node without Cesium or the scene.
//
// FRAME DISCIPLINE - read this before changing anything here.
//
// satellite.js's `propagate` returns position and velocity in TEME
// (km, km/s). Its `eciToEcf` is a PURE Z-ROTATION - correct for a
// position, WRONG for a velocity, because the Earth-fixed velocity is
// R(theta)*v_teme - omega x r_ecef and the omitted term is 495 m/s. Using
// eciToEcf on the velocity produces a range-rate error of 314 m/s, which
// is 459 Hz at 437.8 MHz, on a curve that still looks like a clean
// S-shape crossing zero at the right time.
//
// So: we never rotate a velocity. Doppler is computed entirely in TEME,
// where the satellite's state needs no conversion at all and the observer
// is a point fixed to a rotating Earth. Elevation/azimuth keep using the
// ECEF position, via the existing visibility helpers.

/** Earth's SIDEREAL rotation rate (rad/s), consistent with gstime.
 *  Using 2*PI/86400 (the solar day) instead is a 0.27% error - 1.35 m/s
 *  of observer velocity, 2.0 Hz at 437.8 MHz. */
export const OMEGA_EARTH = 7.292115855e-5;

/** Build a sampler returning the satellite's TEME position + velocity and
 *  its ECEF position, all in metres / metres per second. Returns null when
 *  SGP4 reports an error (decayed object, elements out of range, ...). */
export function makeSatStateAt(sat, satrec) {
  return function satStateAt(jsDate) {
    const pv = sat.propagate(satrec, jsDate);
    if (!pv || !pv.position || !pv.velocity) return null;
    const gmst = sat.gstime(jsDate);
    const ecf = sat.eciToEcf(pv.position, gmst); // position only - never velocity
    return {
      rTeme: [pv.position.x * 1000, pv.position.y * 1000, pv.position.z * 1000],
      vTeme: [pv.velocity.x * 1000, pv.velocity.y * 1000, pv.velocity.z * 1000],
      rEcef: [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000],
      gmst,
    };
  };
}

/** Rotate an Earth-fixed observer position into TEME and give it the
 *  velocity of a point carried by the rotating Earth. This is the exact
 *  inverse of satellite.js's eciToEcf rotation. */
export function observerTemeAt(obsEcef, gmst) {
  const c = Math.cos(gmst), s = Math.sin(gmst);
  const r = [
    obsEcef[0] * c - obsEcef[1] * s,
    obsEcef[0] * s + obsEcef[1] * c,
    obsEcef[2],
  ];
  // omega x r with omega = (0, 0, OMEGA_EARTH)
  return { r, v: [-OMEGA_EARTH * r[1], OMEGA_EARTH * r[0], 0] };
}

/** Analytic range rate. Positive = receding.
 *
 *  Do NOT replace this with a central difference of the range: satellite.js
 *  computes minutes-since-epoch as (jday(date) - satrec.jdsatepoch) * 1440
 *  from two Julian dates near 2.46e6, each carrying ~47 us of double
 *  representation error. That is ~0.36 m of along-track position noise, so
 *  differencing has a floor of ~0.2 m/s (0.3 Hz) at h = 1 s and gets WORSE
 *  as h shrinks - 131 Hz at h = 1 ms. This form is ~100x better. */
export function rangeRateMps(satRTeme, satVTeme, obsTeme) {
  const dx = satRTeme[0] - obsTeme.r[0];
  const dy = satRTeme[1] - obsTeme.r[1];
  const dz = satRTeme[2] - obsTeme.r[2];
  const range = Math.hypot(dx, dy, dz);
  if (range <= 0) return 0;
  const dvx = satVTeme[0] - obsTeme.v[0];
  const dvy = satVTeme[1] - obsTeme.v[1];
  const dvz = satVTeme[2] - obsTeme.v[2];
  return (dx * dvx + dy * dvy + dz * dvz) / range;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sat-state.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Rewire the scene to the shared sampler**

In `lib/pass-finder-scene.js`, add to the imports near line 8:

```javascript
import { makeSatStateAt } from "./pass-finder/sat-state.js";
```

Replace the body of `issEcefAt` (lines 879-886) with a delegation, keeping the existing exported name and signature so every current caller is untouched:

```javascript
// Cached state sampler, rebuilt whenever satrec changes.
let _satStateAt = null;
let _satStateFor = null;

function satStateAt(jsDate) {
  if (!satrec) return null;
  if (_satStateFor !== satrec) {
    _satStateAt = makeSatStateAt(sat, satrec);
    _satStateFor = satrec;
  }
  return _satStateAt(jsDate);
}

function issEcefAt(jsDate) {
  const st = satStateAt(jsDate);
  return st ? st.rEcef : null;
}
```

- [ ] **Step 6: Verify nothing regressed**

Run: `npm test`
Expected: PASS — all existing tests plus the 5 new ones. `issEcefAt` returns identical values, so `visibility`, `search`, `observer-pass`, and `scoring` tests are unaffected.

- [ ] **Step 7: Commit**

```bash
git add lib/pass-finder/sat-state.js test/sat-state.test.mjs lib/pass-finder-scene.js
git commit -m "feat: extract satellite state sampler with position and velocity"
```

---

### Task 2: Doppler with light-time correction and the exact relativistic ratio

**Files:**
- Create: `lib/pass-finder/doppler.js`
- Create: `test/doppler.test.mjs`

This refines spec §3, which folded this into `radio-pass.js`. Splitting keeps each file to one physics domain and under 150 lines, matching the codebase norm.

**Interfaces:**
- Consumes: `SatState`, `observerTemeAt`, `rangeRateMps` from Task 1.
- Produces:
  - `C_LIGHT: number`
  - `retardedState(satStateAt, tMs, obsTemeR, seedTauSec) -> { rTeme, vTeme, tauSec } | null`
  - `dopplerHz(satRTeme, satVTeme, obsTeme, freqHz) -> number`

- [ ] **Step 1: Write the failing test**

Create `test/doppler.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C_LIGHT, retardedState, dopplerHz } from '../lib/pass-finder/doppler.js';
import { observerTemeAt } from '../lib/pass-finder/sat-state.js';

const F = 437.8e6;
const OBS = { r: [6378137, 0, 0], v: [0, 465.1, 0] };

test('approaching satellite gives a HIGHER received frequency', () => {
  // Satellite directly overhead, moving straight at the observer.
  const r = [6378137 + 420000, 0, 0];
  const v = [-7500, 0, 0];
  const d = dopplerHz(r, v, { r: [6378137, 0, 0], v: [0, 0, 0] }, F);
  assert.ok(d > 0, `approaching must be positive, got ${d}`);
  // f * v / c = 437.8e6 * 7500 / 299792458 = 10953 Hz
  assert.ok(Math.abs(d - 10953) < 30, `expected ~10953 Hz, got ${d.toFixed(0)}`);
});

test('receding satellite gives a LOWER received frequency', () => {
  const r = [6378137 + 420000, 0, 0];
  const v = [7500, 0, 0];
  const d = dopplerHz(r, v, { r: [6378137, 0, 0], v: [0, 0, 0] }, F);
  assert.ok(d < 0, `receding must be negative, got ${d}`);
});

test('zero range rate still shows the constant relativistic offset', () => {
  // Purely transverse motion: no first-order Doppler, but time dilation
  // and gravitational potential remain. Net is a small redshift for LEO.
  const r = [6378137 + 420000, 0, 0];
  const v = [0, 7660, 0];
  const d = dopplerHz(r, v, { r: [6378137, 0, 0], v: [0, 0, 0] }, F);
  assert.ok(Math.abs(d) < 1, `should be sub-Hz, got ${d}`);
  assert.ok(d < 0, `LEO net relativistic term is a redshift, got ${d}`);
});

test('exact ratio differs from the first-order linear form by ~0.2 Hz', () => {
  const r = [6378137 + 420000, 0, 0];
  const v = [-7500, 0, 0];
  const exact = dopplerHz(r, v, { r: [6378137, 0, 0], v: [0, 0, 0] }, F);
  const linear = F * (7500 / C_LIGHT);
  const diff = Math.abs(exact - linear);
  assert.ok(diff > 0.05 && diff < 1.0, `expected ~0.2-0.3 Hz, got ${diff}`);
});

test('retardedState converges and returns a light time of the right order', () => {
  // Fake sampler: satellite moving at constant velocity in a straight line.
  const R0 = [6378137 + 420000, 0, 0];
  const V = [0, 7500, 0];
  const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);
  const stateAt = (d) => {
    const dt = (d.getTime() - T0) / 1000;
    return {
      rTeme: [R0[0] + V[0] * dt, R0[1] + V[1] * dt, R0[2] + V[2] * dt],
      vTeme: [...V],
    };
  };
  const out = retardedState(stateAt, T0, [6378137, 0, 0], 0);
  assert.ok(out, 'retardedState returned null');
  // 420 km / c = 1.401 ms
  assert.ok(
    Math.abs(out.tauSec - 420000 / C_LIGHT) < 2e-6,
    `expected ~1.401 ms, got ${(out.tauSec * 1000).toFixed(4)} ms`,
  );
  // The retarded position is BEHIND the instantaneous one along the track.
  assert.ok(out.rTeme[1] < R0[1] + 1e-9, 'retarded position must lag');
});

test('retardedState is not defeated by integer-millisecond Date rounding', () => {
  // JS Date is integer ms, but light time is ~1.4 ms. Naively doing
  // new Date(tMs - tau*1000) truncates 1.4 ms to 1 ms - a 0.4 ms epoch
  // error, ~0.065 m/s of range rate, ~0.095 Hz. The implementation must
  // sample on the ms grid and correct the sub-ms remainder with velocity.
  const R0 = [6378137 + 420000, 0, 0];
  const V = [0, 7500, 0];
  const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);
  const calls = [];
  const stateAt = (d) => {
    calls.push(d.getTime());
    const dt = (d.getTime() - T0) / 1000;
    return {
      rTeme: [R0[0], R0[1] + V[1] * dt, R0[2]],
      vTeme: [...V],
    };
  };
  const out = retardedState(stateAt, T0, [6378137, 0, 0], 0);
  assert.ok(calls.every(Number.isInteger), 'must only sample integer ms');
  // Exact answer: y = -7500 * 1.401e-3 = -10.507 m
  const expectedY = -V[1] * (420000 / C_LIGHT);
  assert.ok(
    Math.abs(out.rTeme[1] - expectedY) < 0.01,
    `sub-ms correction missing: expected y=${expectedY.toFixed(3)}, got ${out.rTeme[1].toFixed(3)}`,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/doppler.test.mjs`
Expected: FAIL — `Cannot find module '../lib/pass-finder/doppler.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/pass-finder/doppler.js`:

```javascript
// lib/pass-finder/doppler.js - one-way Doppler for a satellite-generated
// carrier, with light-time retardation and the exact frequency ratio.
//
// VALID FOR: beacons, and FM repeater downlinks (an FM repeater demodulates
// and re-modulates onto its own local oscillator, so the uplink's Doppler
// does not carry through).
// NOT VALID FOR: signals heard through a LINEAR TRANSPONDER, which
// frequency-translates the whole passband - there the observed Doppler is
// the sum of downlink and uplink Doppler and needs the uplink station's
// position.
//
// All vectors are TEME, metres and m/s. See sat-state.js for why.

export const C_LIGHT = 299792458;
const GM_EARTH = 3.986004418e14;

/** Satellite state at the retarded (emission) epoch for a signal received
 *  at `tMs`, by fixed-point iteration on tau = range/c.
 *
 *  JS Date is integer milliseconds and the light time is only ~1.4-8 ms, so
 *  sampling at `new Date(tMs - tau*1000)` truncates up to 0.5 ms of the
 *  correction - about 0.095 Hz, which would eat a third of the very effect
 *  we are correcting for. Instead we sample on the millisecond grid and
 *  carry the sub-millisecond remainder forward linearly using the velocity
 *  we already have. Residual position error is 0.5*a*dt^2 ~ 1e-6 m.
 *
 *  Pass `seedTauSec` from the previous sample to converge in one iteration. */
export function retardedState(satStateAt, tMs, obsTemeR, seedTauSec = 0) {
  let tau = seedTauSec;
  for (let i = 0; i < 3; i++) {
    const tRetMs = tMs - tau * 1000;
    const tGrid = Math.round(tRetMs);
    const remSec = (tRetMs - tGrid) / 1000; // |remSec| <= 0.0005
    const st = satStateAt(new Date(tGrid));
    if (!st) return null;
    const r = [
      st.rTeme[0] + st.vTeme[0] * remSec,
      st.rTeme[1] + st.vTeme[1] * remSec,
      st.rTeme[2] + st.vTeme[2] * remSec,
    ];
    tau = Math.hypot(
      r[0] - obsTemeR[0], r[1] - obsTemeR[1], r[2] - obsTemeR[2],
    ) / C_LIGHT;
    if (i === 2) return { rTeme: r, vTeme: [...st.vTeme], tauSec: tau };
  }
  return null;
}

/** Received-minus-transmitted frequency, in Hz.
 *
 *  Uses the EXACT ratio, not the first-order `-f * rdot / c`. The linear
 *  form carries 0.242 Hz of its own error - larger than the light-time term
 *  it sits beside - and total avoidable error from the naive formulation is
 *  0.419 Hz, comparable to the ionosphere.
 *
 *  The gamma and gravitational factors are included for completeness. Note
 *  they are CONSTANT across a pass to within 0.0074 mHz, and the
 *  transmitter's oscillator offset is unknown and constant at +/-1.1 kHz,
 *  so they are perfectly degenerate with it and unobservable in a single
 *  recording. They are here because they are free, not because they can be
 *  measured. */
export function dopplerHz(satRTeme, satVTeme, obsTeme, freqHz) {
  const px = obsTeme.r[0] - satRTeme[0];
  const py = obsTeme.r[1] - satRTeme[1];
  const pz = obsTeme.r[2] - satRTeme[2];
  const p = Math.hypot(px, py, pz);
  if (p <= 0) return 0;
  // Unit vector along the photon path, satellite -> observer.
  const nx = px / p, ny = py / p, nz = pz / p;

  const a = (nx * obsTeme.v[0] + ny * obsTeme.v[1] + nz * obsTeme.v[2]) / C_LIGHT;
  const b = (nx * satVTeme[0] + ny * satVTeme[1] + nz * satVTeme[2]) / C_LIGHT;
  const kinematic = (1 - a) / (1 - b);

  const vs2 = satVTeme[0] ** 2 + satVTeme[1] ** 2 + satVTeme[2] ** 2;
  const vo2 = obsTeme.v[0] ** 2 + obsTeme.v[1] ** 2 + obsTeme.v[2] ** 2;
  const gammaRatio = Math.sqrt((1 - vs2 / (C_LIGHT * C_LIGHT)) /
                               (1 - vo2 / (C_LIGHT * C_LIGHT)));

  const rSat = Math.hypot(...satRTeme);
  const rObs = Math.hypot(...obsTeme.r);
  const potential = (GM_EARTH / rObs - GM_EARTH / rSat) / (C_LIGHT * C_LIGHT);

  return freqHz * (kinematic * gammaRatio * (1 + potential) - 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/doppler.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/pass-finder/doppler.js test/doppler.test.mjs
git commit -m "feat: exact one-way Doppler with light-time retardation"
```

---

### Task 3: Angular rate and signal envelope

**Files:**
- Create: `lib/pass-finder/radio-optics.js`
- Create: `test/radio-optics.test.mjs`

**Interfaces:**
- Consumes: `apparentAltDeg` from `lib/refraction.js`.
- Produces:
  - `angularRateDegPerSec(u1: number[], u2: number[], dtSec: number) -> number`
  - `apparentDirEcef(dirEcef: number[], upEcef: number[]) -> number[]`
  - `relSignalDb(rangeM: number, rangeMinM: number) -> number`
  - `absoluteFsplDb(rangeM: number, freqHz: number) -> number`

- [ ] **Step 1: Write the failing test**

Create `test/radio-optics.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  angularRateDegPerSec, apparentDirEcef, relSignalDb, absoluteFsplDb,
} from '../lib/pass-finder/radio-optics.js';

const unit = (v) => { const n = Math.hypot(...v); return [v[0]/n, v[1]/n, v[2]/n]; };

test('angular rate is non-zero through the exact zenith', () => {
  // THE regression test for this module. Decomposing angular rate into
  // alt/az components returns 0.0000 deg/s at the zenith because azimuth is
  // singular there - on a perfect overhead pass, which is the single most
  // interesting pass. Unit vectors have no such singularity.
  const up = [1, 0, 0];
  const eps = 0.00894; // ~0.512 deg of travel
  const u1 = unit([1, -eps, 0]);
  const u2 = unit([1, +eps, 0]);
  const w = angularRateDegPerSec(u1, u2, 1.0);
  assert.ok(w > 0.5, `zenith angular rate must be non-zero, got ${w}`);
  assert.ok(Math.abs(w - 1.024) < 0.02, `expected ~1.024 deg/s, got ${w}`);
  // Sanity: the pair straddles the zenith.
  assert.ok(Math.abs(u1[0] - up[0]) < 1e-3);
});

test('angular rate is stable for very small angles', () => {
  // arccos(dot) loses precision near 1; atan2(|cross|, dot) does not.
  const u1 = unit([1, -1e-7, 0]);
  const u2 = unit([1, +1e-7, 0]);
  const w = angularRateDegPerSec(u1, u2, 1.0);
  const expected = (2e-7) * 180 / Math.PI;
  assert.ok(Math.abs(w - expected) / expected < 1e-3, `got ${w}, want ${expected}`);
});

test('apparentDirEcef raises a low object toward the zenith', () => {
  // Refraction makes objects appear HIGHER. At a geometric altitude of 1.5
  // deg the lift is roughly 0.3 deg.
  const up = [0, 0, 1];
  const geomAlt = 1.5 * Math.PI / 180;
  const dir = [Math.cos(geomAlt), 0, Math.sin(geomAlt)];
  const app = apparentDirEcef(dir, up);
  const appAlt = Math.asin(app[2]) * 180 / Math.PI;
  assert.ok(appAlt > 1.5, `must be raised, got ${appAlt}`);
  assert.ok(appAlt < 2.2, `raised too far, got ${appAlt}`);
  assert.ok(Math.abs(Math.hypot(...app) - 1) < 1e-12, 'must stay a unit vector');
});

test('apparentDirEcef leaves a zenith direction alone', () => {
  const up = [0, 0, 1];
  const app = apparentDirEcef([0, 0, 1], up);
  assert.ok(Math.abs(app[2] - 1) < 1e-9, `zenith must not move, got ${app}`);
});

test('apparentDirEcef preserves azimuth (refraction is purely vertical)', () => {
  const up = [0, 0, 1];
  const geomAlt = 10 * Math.PI / 180;
  const az = 1.1;
  const dir = [Math.cos(geomAlt) * Math.cos(az), Math.cos(geomAlt) * Math.sin(az), Math.sin(geomAlt)];
  const app = apparentDirEcef(dir, up);
  assert.ok(Math.abs(Math.atan2(app[1], app[0]) - az) < 1e-9);
});

test('relSignalDb is 0 at the peak and negative elsewhere', () => {
  assert.equal(relSignalDb(420000, 420000), 0);
  const edge = relSignalDb(1492000, 420000);
  assert.ok(edge < 0);
  // -20 log10(1492/420) = -11.0 dB
  assert.ok(Math.abs(edge + 11.0) < 0.1, `expected ~-11.0 dB, got ${edge}`);
});

test('absoluteFsplDb matches the standard free-space figure', () => {
  // 20 log10(4 pi r f / c) at 420 km on 437.8 MHz = 137.7 dB
  const v = absoluteFsplDb(420000, 437.8e6);
  assert.ok(Math.abs(v - 137.7) < 0.1, `expected ~137.7 dB, got ${v}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/radio-optics.test.mjs`
Expected: FAIL — `Cannot find module '../lib/pass-finder/radio-optics.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/pass-finder/radio-optics.js`:

```javascript
// lib/pass-finder/radio-optics.js - the two non-Doppler curves: apparent
// angular rate (what a camera measures) and the received-signal envelope.

import { apparentAltDeg } from "../refraction.js";

const DEG = Math.PI / 180;
const C_LIGHT = 299792458;

/** Angular rate between two unit line-of-sight vectors, in deg/s.
 *
 *  Use atan2(|u1 x u2|, u1.u2), NOT arccos(u1.u2): arccos loses precision by
 *  cancellation when the dot product is near 1.
 *
 *  Never decompose this into altitude and azimuth components. Azimuth is
 *  singular at the zenith, and the alt/az form returns 0.0000 deg/s where
 *  the true rate is 1.0244 deg/s - a total failure at the peak of an
 *  overhead pass, and ~0.24% low everywhere else. */
export function angularRateDegPerSec(u1, u2, dtSec) {
  const cx = u1[1] * u2[2] - u1[2] * u2[1];
  const cy = u1[2] * u2[0] - u1[0] * u2[2];
  const cz = u1[0] * u2[1] - u1[1] * u2[0];
  const cross = Math.hypot(cx, cy, cz);
  const d = u1[0] * u2[0] + u1[1] * u2[1] + u1[2] * u2[2];
  return (Math.atan2(cross, d) / DEG) / dtSec;
}

/** Apply atmospheric refraction to a TRUE unit direction, returning the
 *  APPARENT one - rotated UP, toward the zenith, because refraction makes
 *  objects appear higher.
 *
 *  Note this is the opposite of `correctRefraction` in lib/refraction.js,
 *  which goes apparent -> true. Using that function here would apply
 *  refraction backwards, roughly 1 deg of error at 1.5 deg elevation.
 *
 *  The angular-rate curve needs apparent positions because it is compared
 *  against video: refraction reduces the apparent rate by 7.97% at 1.5 deg
 *  elevation, 0.85% at 9.9 deg, 0.14% at 26.9 deg.
 *
 *  Refraction is purely vertical (the atmosphere is horizontally
 *  stratified), so azimuth is unchanged. */
export function apparentDirEcef(dirEcef, upEcef) {
  const sinAlt = Math.max(-1, Math.min(1,
    dirEcef[0] * upEcef[0] + dirEcef[1] * upEcef[1] + dirEcef[2] * upEcef[2]));
  const geomAlt = Math.asin(sinAlt) / DEG;
  const liftDeg = apparentAltDeg(geomAlt) - geomAlt;
  if (liftDeg === 0) return [...dirEcef];

  // Rotate dir toward up, in the plane they span, by liftDeg.
  // Horizontal component of dir, orthogonal to up.
  const hx = dirEcef[0] - sinAlt * upEcef[0];
  const hy = dirEcef[1] - sinAlt * upEcef[1];
  const hz = dirEcef[2] - sinAlt * upEcef[2];
  const hLen = Math.hypot(hx, hy, hz);
  if (hLen < 1e-12) return [...dirEcef]; // at the zenith, nothing to rotate

  const ux = hx / hLen, uy = hy / hLen, uz = hz / hLen;
  const newAlt = (geomAlt + liftDeg) * DEG;
  const ca = Math.cos(newAlt), sa = Math.sin(newAlt);
  return [
    ux * ca + upEcef[0] * sa,
    uy * ca + upEcef[1] * sa,
    uz * ca + upEcef[2] * sa,
  ];
}

/** Received power relative to the pass peak, in dB. Free-space path loss
 *  only: at 137-438 MHz atmospheric absorption is under 0.1 dB even near
 *  the horizon, and what actually degrades low passes (antenna pattern,
 *  terrain, multipath) is site-specific and not modelled.
 *
 *  This is an ENVELOPE valid for circular polarization. With a linear
 *  antenna, Faraday rotation gives 254 deg of rotation at 145.8 MHz and
 *  288 deg at 137.1 MHz - deep nulls that have nothing to do with range. */
export function relSignalDb(rangeM, rangeMinM) {
  if (!(rangeM > 0) || !(rangeMinM > 0)) return 0;
  return -20 * Math.log10(rangeM / rangeMinM);
}

/** Absolute free-space path loss in dB, for annotating the peak. */
export function absoluteFsplDb(rangeM, freqHz) {
  return 20 * Math.log10((4 * Math.PI * rangeM * freqHz) / C_LIGHT);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/radio-optics.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/pass-finder/radio-optics.js test/radio-optics.test.mjs
git commit -m "feat: apparent angular rate and signal envelope for radio passes"
```

---

### Task 4: The sampler

**Files:**
- Create: `lib/pass-finder/radio-pass.js`
- Create: `test/radio-pass.test.mjs`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces:
  - `radioPassSamples(obs, window, deps, opts) -> { samples, summary }` where
    - `obs = { latDeg, lonDeg, elevM? }`
    - `window = { startMs, endMs }`
    - `deps = { satStateAt, obsEcef, upEcef }`
    - `opts = { freqHz, stepMs = 2000 }`
    - `samples[i] = { tMs, rangeM, rangeRateMps, dopplerHz, elDeg, azDeg, angRateDegPerSec, relSignalDb }`
    - `summary = { tcaMs, closestRangeM, dopplerMaxHz, dopplerMinHz, dopplerPeakToPeakHz, maxDopplerRateHzPerSec, maxAngRateDegPerSec, absoluteFsplDb, dopplerAtElevation: { 10, 30, tca } }`
  - `interpolateMinimum(y0, y1, y2, stepSec) -> { offsetSec, value }`

- [ ] **Step 1: Write the failing test**

Create `test/radio-pass.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radioPassSamples, interpolateMinimum } from '../lib/pass-finder/radio-pass.js';
import { geodeticToEcef } from '../lib/coords.js';

const OBS = { latDeg: 0, lonDeg: 0 };
const OBS_ECEF = geodeticToEcef(0, 0, 0);
const UP = [1, 0, 0];
const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);

// Straight-line target: closest approach d at t = T0, speed v along +y.
// Closed-form range r(t) = sqrt(d^2 + v^2 t^2), so every output is checkable.
function straightLineTarget(d, v) {
  return (date) => {
    const t = (date.getTime() - T0) / 1000;
    return {
      rTeme: [OBS_ECEF[0] + d, v * t, 0],
      vTeme: [0, v, 0],
      rEcef: [OBS_ECEF[0] + d, v * t, 0],
      gmst: 0,
    };
  };
}

test('interpolateMinimum recovers a parabola vertex exactly', () => {
  // y = 3 (x - 0.4)^2 + 5, sampled at x = -1, 0, 1
  const f = (x) => 3 * (x - 0.4) ** 2 + 5;
  const out = interpolateMinimum(f(-1), f(0), f(1), 1);
  assert.ok(Math.abs(out.offsetSec - 0.4) < 1e-12, `offset ${out.offsetSec}`);
  assert.ok(Math.abs(out.value - 5) < 1e-9, `value ${out.value}`);
});

test('closest approach is interpolated, not snapped to a sample', () => {
  // Offset the grid so TCA falls between samples. At 2 s spacing with an
  // ISS-like second derivative, snapping to the nearest sample is 54.6 m
  // out; interpolation brings that to 0.038 m.
  const d = 420000, v = 7500;
  const stateAt = straightLineTarget(d, v);
  const { summary } = radioPassSamples(
    OBS,
    { startMs: T0 - 200000 + 700, endMs: T0 + 200000 + 700 },
    { satStateAt: stateAt, obsEcef: OBS_ECEF, upEcef: UP },
    { freqHz: 437.8e6, stepMs: 2000 },
  );
  assert.ok(
    Math.abs(summary.closestRangeM - d) < 1.0,
    `closest range ${summary.closestRangeM} vs ${d}`,
  );
  assert.ok(
    Math.abs(summary.tcaMs - T0) < 50,
    `TCA off by ${summary.tcaMs - T0} ms`,
  );
});

test('Doppler extremes match the closed form and are signed correctly', () => {
  const d = 420000, v = 7500, F = 437.8e6;
  const stateAt = straightLineTarget(d, v);
  const half = 400000;
  const { samples, summary } = radioPassSamples(
    OBS,
    { startMs: T0 - half, endMs: T0 + half },
    { satStateAt: stateAt, obsEcef: OBS_ECEF, upEcef: UP },
    { freqHz: F, stepMs: 2000 },
  );
  const tEnd = half / 1000;
  const rdotEnd = (v * v * tEnd) / Math.sqrt(d * d + v * v * tEnd * tEnd);
  const expected = F * rdotEnd / 299792458;
  assert.ok(Math.abs(summary.dopplerMaxHz - expected) < 5,
    `max ${summary.dopplerMaxHz} vs ${expected}`);
  assert.ok(summary.dopplerMinHz < 0, 'must go negative');
  // First sample is approaching -> positive.
  assert.ok(samples[0].dopplerHz > 0, 'pass must start high');
  assert.ok(samples[samples.length - 1].dopplerHz < 0, 'pass must end low');
});

test('peak-to-peak uses both edges independently, not 2x the maximum', () => {
  // Real passes are asymmetric - up to 4.88% measured on a grazing pass.
  const stateAt = straightLineTarget(420000, 7500);
  const { summary } = radioPassSamples(
    OBS,
    { startMs: T0 - 300000, endMs: T0 + 120000 }, // deliberately lopsided
    { satStateAt: stateAt, obsEcef: OBS_ECEF, upEcef: UP },
    { freqHz: 437.8e6, stepMs: 2000 },
  );
  const ptp = summary.dopplerMaxHz - summary.dopplerMinHz;
  assert.ok(Math.abs(summary.dopplerPeakToPeakHz - ptp) < 1e-9);
  assert.ok(
    Math.abs(summary.dopplerPeakToPeakHz - 2 * summary.dopplerMaxHz) > 100,
    'lopsided window must produce an asymmetric swing',
  );
});

test('signal envelope peaks at closest approach', () => {
  const stateAt = straightLineTarget(420000, 7500);
  const { samples } = radioPassSamples(
    OBS,
    { startMs: T0 - 200000, endMs: T0 + 200000 },
    { satStateAt: stateAt, obsEcef: OBS_ECEF, upEcef: UP },
    { freqHz: 437.8e6, stepMs: 2000 },
  );
  const best = samples.reduce((a, b) => (b.relSignalDb > a.relSignalDb ? b : a));
  assert.ok(Math.abs(best.relSignalDb) < 1e-9, 'peak must be 0 dB');
  assert.ok(samples[0].relSignalDb < -5, 'edges must be well below peak');
});

test('angular rate peaks at closest approach', () => {
  const d = 420000, v = 7500;
  const stateAt = straightLineTarget(d, v);
  const { samples } = radioPassSamples(
    OBS,
    { startMs: T0 - 200000, endMs: T0 + 200000 },
    { satStateAt: stateAt, obsEcef: OBS_ECEF, upEcef: UP },
    { freqHz: 437.8e6, stepMs: 2000 },
  );
  const peak = samples.reduce((a, b) =>
    (b.angRateDegPerSec > a.angRateDegPerSec ? b : a));
  assert.ok(Math.abs(peak.tMs - T0) < 3000, 'omega must peak at TCA');
  // omega_max = v/d = 7500/420000 rad/s = 1.0233 deg/s
  const expected = (v / d) * 180 / Math.PI;
  assert.ok(Math.abs(peak.angRateDegPerSec - expected) < 0.02,
    `expected ~${expected.toFixed(3)}, got ${peak.angRateDegPerSec.toFixed(3)}`);
});

test('a window too short to interpolate does not throw', () => {
  const stateAt = straightLineTarget(420000, 7500);
  const out = radioPassSamples(
    OBS,
    { startMs: T0, endMs: T0 + 1000 },
    { satStateAt: stateAt, obsEcef: OBS_ECEF, upEcef: UP },
    { freqHz: 437.8e6, stepMs: 2000 },
  );
  assert.ok(Array.isArray(out.samples));
  assert.ok(out.summary);
});

test('a null frequency still yields range-rate samples', () => {
  const stateAt = straightLineTarget(420000, 7500);
  const { samples } = radioPassSamples(
    OBS,
    { startMs: T0 - 60000, endMs: T0 + 60000 },
    { satStateAt: stateAt, obsEcef: OBS_ECEF, upEcef: UP },
    { freqHz: null, stepMs: 2000 },
  );
  assert.ok(samples.every((s) => s.dopplerHz === null));
  assert.ok(samples.every((s) => Number.isFinite(s.rangeRateMps)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/radio-pass.test.mjs`
Expected: FAIL — `Cannot find module '../lib/pass-finder/radio-pass.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/pass-finder/radio-pass.js`:

```javascript
// lib/pass-finder/radio-pass.js - the radio-pass time series. This is the
// single source of physics for the chart, the CSV, and every header
// readout; nothing downstream recomputes.
//
// Pure given an injected `satStateAt` sampler, so it tests without Cesium.

import { observerTemeAt, rangeRateMps } from "./sat-state.js";
import { retardedState, dopplerHz, C_LIGHT } from "./doppler.js";
import {
  angularRateDegPerSec, apparentDirEcef, relSignalDb, absoluteFsplDb,
} from "./radio-optics.js";

const DEG = Math.PI / 180;

/** Vertex of the parabola through three equally-spaced samples.
 *  Returns the offset from the middle sample, in seconds, and the value. */
export function interpolateMinimum(y0, y1, y2, stepSec) {
  const den = y0 - 2 * y1 + y2;
  if (!Number.isFinite(den) || den === 0) return { offsetSec: 0, value: y1 };
  const delta = (0.5 * (y0 - y2)) / den;
  return { offsetSec: delta * stepSec, value: y1 - 0.25 * (y0 - y2) * delta };
}

function unitTo(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const n = Math.hypot(dx, dy, dz);
  return n > 0 ? [dx / n, dy / n, dz / n] : [0, 0, 1];
}

/** Sample a radio pass.
 *
 *  `window` must be the OBSERVER'S OWN pass window, not a joint
 *  multi-observer intersection - an intersection truncates the S-curve and
 *  understates the swing. Use passWindowAtMsForObserver from
 *  observer-pass.js to compute it. */
export function radioPassSamples(obs, window, deps, opts = {}) {
  const { satStateAt, obsEcef, upEcef } = deps;
  const freqHz = opts.freqHz ?? null;
  const stepMs = Math.max(250, opts.stepMs ?? 2000);
  const samples = [];

  let seedTau = 0;
  for (let tMs = window.startMs; tMs <= window.endMs; tMs += stepMs) {
    const t = Math.round(tMs);
    const inst = satStateAt(new Date(t));
    if (!inst) continue;
    const obsTeme = observerTemeAt(obsEcef, inst.gmst);

    const ret = retardedState(satStateAt, t, obsTeme.r, seedTau);
    if (!ret) continue;
    seedTau = ret.tauSec;

    // Light-path length. At TCA this equals the geometric closest
    // approach, since rdot is zero there.
    const rangeM = ret.tauSec * C_LIGHT;
    const rr = rangeRateMps(ret.rTeme, ret.vTeme, obsTeme);

    // Elevation/azimuth from the ECEF position (the app's convention), using
    // the retarded direction so the chart matches what is actually seen.
    const trueDir = unitTo(obsEcef, inst.rEcef);
    const appDir = apparentDirEcef(trueDir, upEcef);
    const sinAlt = Math.max(-1, Math.min(1,
      appDir[0] * upEcef[0] + appDir[1] * upEcef[1] + appDir[2] * upEcef[2]));
    const elDeg = Math.asin(sinAlt) / DEG;

    const east = [-Math.sin(obs.lonDeg * DEG), Math.cos(obs.lonDeg * DEG), 0];
    const north = [
      -Math.sin(obs.latDeg * DEG) * Math.cos(obs.lonDeg * DEG),
      -Math.sin(obs.latDeg * DEG) * Math.sin(obs.lonDeg * DEG),
      Math.cos(obs.latDeg * DEG),
    ];
    let azDeg = Math.atan2(
      appDir[0] * east[0] + appDir[1] * east[1] + appDir[2] * east[2],
      appDir[0] * north[0] + appDir[1] * north[1] + appDir[2] * north[2],
    ) / DEG;
    if (azDeg < 0) azDeg += 360;

    samples.push({
      tMs: t,
      rangeM,
      rangeRateMps: rr,
      dopplerHz: freqHz ? dopplerHz(ret.rTeme, ret.vTeme, obsTeme, freqHz) : null,
      elDeg,
      azDeg,
      appDir,
      angRateDegPerSec: 0, // filled below, needs neighbours
      relSignalDb: 0,      // filled below, needs the minimum
    });
  }

  // Angular rate from apparent unit vectors - never from alt/az components.
  const stepSec = stepMs / 1000;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    const span = (b.tMs - a.tMs) / 1000;
    samples[i].angRateDegPerSec = span > 0
      ? angularRateDegPerSec(a.appDir, b.appDir, span)
      : 0;
  }

  // Closest approach, refined between samples.
  let minIdx = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].rangeM < samples[minIdx].rangeM) minIdx = i;
  }
  let tcaMs = samples.length ? samples[minIdx].tMs : window.startMs;
  let closestRangeM = samples.length ? samples[minIdx].rangeM : NaN;
  if (minIdx > 0 && minIdx < samples.length - 1) {
    const r = interpolateMinimum(
      samples[minIdx - 1].rangeM, samples[minIdx].rangeM,
      samples[minIdx + 1].rangeM, stepSec,
    );
    tcaMs = samples[minIdx].tMs + r.offsetSec * 1000;
    closestRangeM = r.value;
  }

  for (const s of samples) s.relSignalDb = relSignalDb(s.rangeM, closestRangeM);

  // Both Doppler edges independently - passes are NOT symmetric.
  let dMax = -Infinity, dMin = Infinity, maxRate = 0, maxOmega = 0;
  for (let i = 0; i < samples.length; i++) {
    const d = samples[i].dopplerHz;
    if (d != null) {
      if (d > dMax) dMax = d;
      if (d < dMin) dMin = d;
      if (i > 0 && samples[i - 1].dopplerHz != null) {
        const dt = (samples[i].tMs - samples[i - 1].tMs) / 1000;
        const rate = Math.abs(d - samples[i - 1].dopplerHz) / dt;
        if (rate > maxRate) maxRate = rate;
      }
    }
    if (samples[i].angRateDegPerSec > maxOmega) maxOmega = samples[i].angRateDegPerSec;
  }

  // Doppler nearest the interpolated TCA. NOT atElev(90): most passes never
  // reach the zenith, so keying this off elevation would return null on
  // nearly every real pass.
  let dopplerAtTca = null;
  if (samples.length) {
    let best = samples[0], bestDt = Infinity;
    for (const s of samples) {
      const dt = Math.abs(s.tMs - tcaMs);
      if (dt < bestDt) { bestDt = dt; best = s; }
    }
    dopplerAtTca = best.dopplerHz;
  }

  const atElev = (target) => {
    let bestS = null, bestErr = Infinity;
    for (const s of samples) {
      const e = Math.abs(s.elDeg - target);
      if (e < bestErr) { bestErr = e; bestS = s; }
    }
    return bestS && bestErr < 5 ? bestS.dopplerHz : null;
  };

  for (const s of samples) delete s.appDir;

  return {
    samples,
    summary: {
      tcaMs,
      closestRangeM,
      dopplerMaxHz: dMax === -Infinity ? null : dMax,
      dopplerMinHz: dMin === Infinity ? null : dMin,
      dopplerPeakToPeakHz: dMax === -Infinity ? null : dMax - dMin,
      maxDopplerRateHzPerSec: maxRate,
      maxAngRateDegPerSec: maxOmega,
      absoluteFsplDb: freqHz ? absoluteFsplDb(closestRangeM, freqHz) : null,
      dopplerAtElevation: { 10: atElev(10), 30: atElev(30), tca: dopplerAtTca },
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/radio-pass.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/pass-finder/radio-pass.js test/radio-pass.test.mjs
git commit -m "feat: radio pass sampler producing the full prediction series"
```

---

### Task 5: Catalog downlinks and the NOAA-19 correction

**Files:**
- Modify: `lib/catalog.mjs`
- Modify: `test/catalog.test.mjs:28-30`
- Modify: `test/satellite-seed.test.mjs:24-27`

**Interfaces:**
- Produces: `CATALOG[i].downlinks: Array<{ hz, label, mode, duty, default? }>`, `defaultDownlink(entry) -> downlink | null`.

- [ ] **Step 1: Write the failing test**

Add to `test/catalog.test.mjs`, and replace the existing NOAA-19 test at lines 28-30:

```javascript
import { CATALOG, resolveSatellite, defaultDownlink } from '../lib/catalog.mjs';

// REPLACES the old "NOAA-19 defaults to radio; ISS to visual" test.
// NOAA-19 was decommissioned 2025-08-13 (battery 1A cell failure); NOAA-15
// and -18 went with it and POES operations ended 2025-08-19. It is still in
// orbit and still tracked, so it stays in the catalog as a visual target -
// it is simply silent. Removing it would break share links carrying
// selectedNoradId 33591.
test('NOAA-19 is a visual target: decommissioned, no downlinks', () => {
  const noaa = resolveSatellite(33591);
  assert.equal(noaa.defaultMode, 'visual');
  assert.deepEqual(noaa.downlinks, []);
  assert.match(noaa.viewingHint, /decommission/i);
});

test('ISS defaults to visual and carries verified downlinks', () => {
  const iss = resolveSatellite(25544);
  assert.equal(iss.defaultMode, 'visual');
  const hz = iss.downlinks.map((d) => d.hz);
  assert.deepEqual(hz, [437_800_000, 145_800_000]);
});

test('every catalog entry has a well-formed downlinks array', () => {
  for (const s of CATALOG) {
    assert.ok(Array.isArray(s.downlinks), `${s.name} downlinks`);
    let defaults = 0;
    for (const d of s.downlinks) {
      assert.equal(typeof d.hz, 'number', `${s.name} hz`);
      assert.ok(d.hz > 1e6 && d.hz < 1e10, `${s.name} hz range`);
      assert.equal(typeof d.label, 'string');
      assert.ok(['fm', 'apt', 'lrpt', 'cw', 'ssb'].includes(d.mode), `${s.name} mode`);
      assert.ok(
        ['continuous', 'scheduled', 'packet', 'on-demand'].includes(d.duty),
        `${s.name} duty`,
      );
      if (d.default) defaults++;
    }
    assert.ok(defaults <= 1, `${s.name} has more than one default downlink`);
  }
});

test('defaultDownlink picks the flagged entry, else the first, else null', () => {
  assert.equal(defaultDownlink(resolveSatellite(25544)).hz, 437_800_000);
  assert.equal(defaultDownlink(resolveSatellite(33591)), null);
  assert.equal(defaultDownlink(null), null);
});
```

In `test/satellite-seed.test.mjs`, replace the test at line 24:

```javascript
test('selectionUpdate applies visual mode for NOAA-19 (decommissioned)', () => {
  const u = selectionUpdate(CATALOG, {}, 33591);
  assert.equal(u.selectedNoradId, 33591);
  assert.equal(u.mode, 'visual');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/catalog.test.mjs test/satellite-seed.test.mjs`
Expected: FAIL — `defaultDownlink` is not exported, and `downlinks` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `lib/catalog.mjs`, add `downlinks` to every entry and fix NOAA-19. The ISS and NOAA-19 entries become:

```javascript
  {
    noradId: 25544, name: 'ISS (ZARYA)', shortName: 'ISS', aliases: ['iss', 'zarya', 'space station'],
    tier: 'free', inclinationDeg: 51.6, standardMag: -1.8, viewingHint: null, defaultMode: 'visual',
    // Verified against ARISS/AMSAT sources 2026-09.
    // APRS is deliberately omitted: 145.825 is the long-standing digipeater
    // frequency but packet operations have reportedly moved to 437.825 from
    // Zvezda. Verify before adding.
    downlinks: [
      {
        hz: 437_800_000, label: 'FM cross-band repeater', mode: 'fm',
        // NOT a beacon: it transmits only while someone is uplinking on
        // 145.990 with a 67.0 Hz tone, so a recording will have gaps - and
        // the AOS/LOS extremes are exactly when it is least likely to be in
        // use, which biases a measured peak-to-peak low.
        duty: 'on-demand', default: true,
      },
      {
        hz: 145_800_000, label: 'Voice / SSTV', mode: 'fm',
        // Continuous for minutes at a time during scheduled SSTV events -
        // the best continuous-carrier target on this satellite.
        duty: 'scheduled',
      },
    ],
  },
```

```javascript
  {
    noradId: 33591, name: 'NOAA-19', shortName: 'NOAA-19', aliases: ['noaa', 'noaa-19', 'noaa19'],
    tier: 'free', inclinationDeg: 99.0, standardMag: 3.5,
    viewingHint: 'Decommissioned 2025-08-13 - no longer transmits. Still tracked; a faint visual target.',
    defaultMode: 'visual',
    downlinks: [],
  },
```

Add `downlinks: []` to the Tiangong, BlueWalker 3, and Hubble entries. Tiangong's CSSARC payload exists but no coordinated frequency could be confirmed from a trustworthy source, so it stays empty rather than guessed.

Append the accessor:

```javascript
/** The downlink a satellite should chart by default: the one flagged
 *  `default`, else the first, else null for satellites with no known
 *  receivable downlink. */
export function defaultDownlink(entry) {
  if (!entry || !Array.isArray(entry.downlinks) || !entry.downlinks.length) return null;
  return entry.downlinks.find((d) => d.default) ?? entry.downlinks[0];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/catalog.test.mjs test/satellite-seed.test.mjs`
Expected: PASS.

- [ ] **Step 5: Confirm the untouched assertions still hold**

Run: `npm test`
Expected: PASS. `test/catalog.test.mjs:8` (id list) and `test/magnitude.test.mjs:35` (NOAA-19 dimmest) are unaffected because no entry was added or removed and no `standardMag` changed.

- [ ] **Step 6: Commit**

```bash
git add lib/catalog.mjs test/catalog.test.mjs test/satellite-seed.test.mjs
git commit -m "feat: catalog downlink frequencies; retire NOAA-19 radio claim"
```

---

### Task 6: Store, share links, and observer elevation

**Files:**
- Modify: `lib/pass-finder-store.ts` (PassObserver, store slice)
- Modify: `lib/pass-finder/state-blob.js`
- Modify: `lib/pass-finder/satellite-seed.js`
- Modify: `lib/pass-finder/visibility.js:18`
- Modify: `test/state-blob.test.mjs`
- Modify: `test/satellite-seed.test.mjs`

**Interfaces:**
- Produces: `PassObserver.elevM?: number`; store fields `radioModalObsId`, `setRadioModalObsId`, `downlinkHz`, `setDownlinkHz`; state-blob key `f`.

- [ ] **Step 1: Write the failing test**

Add to `test/state-blob.test.mjs`:

```javascript
test('radio mode round-trips the selected downlink frequency', () => {
  // Without this the Doppler axis is 3x wrong between 145.800 and 437.800
  // when a shared link is opened.
  const snap = { mode: 'radio', downlinkHz: 437_800_000, observers: [], minElevDeg: 10 };
  const blob = encodeStateBlob(snap);
  const out = decodeStateBlob(blob);
  assert.equal(out.mode, 'radio');
  assert.equal(out.downlinkHz, 437_800_000);
});

test('a legacy radio link with no frequency decodes to null', () => {
  const out = decodeStateBlob(encodeStateBlob({ mode: 'radio', observers: [], minElevDeg: 10 }));
  assert.equal(out.mode, 'radio');
  assert.equal(out.downlinkHz, null);
});

test('visual mode does not carry a frequency', () => {
  const blob = encodeStateBlob({ mode: 'visual', downlinkHz: 437_800_000, observers: [], minElevDeg: 10 });
  assert.equal(JSON.parse(atob(blob.replace(/-/g, '+').replace(/_/g, '/'))).f, undefined);
});
```

Add to `test/satellite-seed.test.mjs`:

```javascript
test('selecting a satellite sets its default downlink frequency', () => {
  const u = selectionUpdate(CATALOG, {}, 25544);
  assert.equal(u.downlinkHz, 437_800_000);
});

test('selecting a satellite with no downlinks clears the frequency', () => {
  const u = selectionUpdate(CATALOG, {}, 33591);
  assert.equal(u.downlinkHz, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/state-blob.test.mjs test/satellite-seed.test.mjs`
Expected: FAIL — `downlinkHz` is undefined on both round-trips.

- [ ] **Step 3: Write minimal implementation**

In `lib/pass-finder/state-blob.js`, inside the encoder alongside `if (snap.mode === "radio") obj.m = "r";`:

```javascript
  if (snap.mode === "radio" && snap.downlinkHz) obj.f = snap.downlinkHz;
```

and in the decoder alongside the `mode` line:

```javascript
      downlinkHz: obj.m === "r" && typeof obj.f === "number" ? obj.f : null,
```

In `lib/pass-finder/satellite-seed.js`, extend `selectionUpdate`:

```javascript
import { recordToTle } from './tle-seed.js';
import { defaultDownlink } from '../catalog.mjs';

export function selectionUpdate(catalog, satelliteTles, noradId) {
  const entry = catalog.find((s) => s.noradId === noradId);
  if (!entry) return null;
  const dl = defaultDownlink(entry);
  // A manual frequency override does NOT survive a satellite change - a
  // 437.800 override is meaningless for a 137 MHz weather satellite.
  const patch = {
    selectedNoradId: entry.noradId,
    mode: entry.defaultMode,
    downlinkHz: dl ? dl.hz : null,
  };
  const tle = satelliteTles?.[entry.noradId];
  if (tle) patch.tle = tle;
  return patch;
}
```

In `lib/pass-finder-store.ts`, add to `PassObserver`:

```typescript
  /** Ground elevation in metres above the WGS-84 ellipsoid, resolved
   *  lazily after add - same pattern as `tz`. Undefined until then.
   *  NOTE: Open-Elevation returns ORTHOMETRIC height (above the geoid);
   *  the geoid undulation is about -105 m to +85 m globally, roughly
   *  -30 m over CONUS. That is 0.024% of a typical pass range, below the
   *  TLE error floor - accepted, not corrected. */
  elevM?: number;
  /** How elevM was obtained, so the radio chart can show provenance
   *  instead of silently quoting a range computed from a failed lookup. */
  elevSource?: "lookup" | "default" | "user";
```

and to the store interface and initial state:

```typescript
  radioModalObsId: string | null;
  setRadioModalObsId: (id: string | null) => void;
  downlinkHz: number | null;
  setDownlinkHz: (hz: number | null) => void;
```

```typescript
  radioModalObsId: null,
  setRadioModalObsId: (radioModalObsId) => set({ radioModalObsId }),
  downlinkHz: null,
  setDownlinkHz: (downlinkHz) => set({ downlinkHz }),
```

In `lib/pass-finder/visibility.js`, change line 18 and the doc comment at line 4:

```javascript
//   observer: { latDeg, lonDeg, elevM? }
```

```javascript
  const obsEcef = geodeticToEcef(obs.latDeg, obs.lonDeg, obs.elevM ?? 0);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/state-blob.test.mjs test/satellite-seed.test.mjs`
Expected: PASS.

- [ ] **Step 5: Wire the elevation lookup**

In `lib/pass-finder-scene.js`, where an observer is added (the `addObserver` bridge implementation), resolve elevation lazily exactly as `tz` is resolved. `lib/elevation.js` already exists and `api.open-elevation.com` is already allowed in the CSP at `next.config.ts:54`:

```javascript
import { lookupElev } from "./elevation.js";

// ... after the observer is pushed into state and the store updated:
Promise.resolve(lookupElev(obs.latDeg, obs.lonDeg)).then((m) => {
  const found = Number.isFinite(m) && m !== 0;
  patchObserver(obs.id, {
    elevM: found ? m : 0,
    elevSource: found ? "lookup" : "default",
  });
});
```

- [ ] **Step 6: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: PASS both.

- [ ] **Step 7: Commit**

```bash
git add lib/pass-finder-store.ts lib/pass-finder/state-blob.js lib/pass-finder/satellite-seed.js lib/pass-finder/visibility.js lib/pass-finder-scene.js test/state-blob.test.mjs test/satellite-seed.test.mjs
git commit -m "feat: downlink frequency in store and share links; observer elevation"
```

---

### Task 7: Chart geometry helpers and painter

**Files:**
- Create: `lib/pass-finder/radio-chart.js`
- Create: `test/radio-chart.test.mjs`

Follows the `polar-arc.js` pattern: pure scale/tick helpers are unit tested; the DOM painting itself is browser-only and untested, like `polar-modal-frame.js`.

**Interfaces:**
- Produces: `niceAxisMax(v) -> number`, `panelScale(values, height) -> (v) => number`, `timeTicks(startMs, endMs, count) -> number[]`, `paintRadioChart(svg, series, meta) -> void`.

- [ ] **Step 1: Write the failing test**

Create `test/radio-chart.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceAxisMax, panelScale, timeTicks } from '../lib/pass-finder/radio-chart.js';

test('niceAxisMax rounds up to a readable bound', () => {
  assert.equal(niceAxisMax(10940), 12000);
  assert.equal(niceAxisMax(3640), 4000);
  assert.equal(niceAxisMax(0.7), 0.8);
  assert.equal(niceAxisMax(0), 1);
});

test('niceAxisMax never returns a bound below its input', () => {
  for (const v of [1, 9.9, 10.1, 99, 101, 999, 1001, 10940, 21880]) {
    assert.ok(niceAxisMax(v) >= v, `${v} -> ${niceAxisMax(v)}`);
  }
});

test('panelScale maps a symmetric range to the panel with zero centred', () => {
  const s = panelScale([-4000, 4000], 100);
  assert.ok(Math.abs(s(0) - 50) < 1e-9, 'zero must sit mid-panel');
  assert.ok(s(4000) < s(-4000), 'positive values must plot higher (smaller y)');
});

test('panelScale handles an all-zero series without dividing by zero', () => {
  const s = panelScale([0, 0], 100);
  assert.ok(Number.isFinite(s(0)));
});

test('timeTicks spans the window inclusively and is monotonic', () => {
  const ticks = timeTicks(1000, 401000, 5);
  assert.equal(ticks[0], 1000);
  assert.equal(ticks[ticks.length - 1], 401000);
  for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i] > ticks[i - 1]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/radio-chart.test.mjs`
Expected: FAIL — `Cannot find module '../lib/pass-finder/radio-chart.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/pass-finder/radio-chart.js`. Start with the tested pure helpers:

```javascript
// lib/pass-finder/radio-chart.js - paints the radio-pass chart: three
// stacked panels (Doppler / angular rate / signal) on one shared time axis,
// with a single TCA rule through all three.
//
// CSS is embedded in the SVG so svgToPngBlob can rasterize it standalone,
// exactly as polar-modal-frame.js does.

const SVG_NS = "http://www.w3.org/2000/svg";

/** Round a magnitude up to 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 or 10 times a
 *  power of ten, so axis bounds read cleanly at any frequency. */
export function niceAxisMax(v) {
  const a = Math.abs(v);
  if (!(a > 0)) return 1;
  const exp = Math.floor(Math.log10(a));
  const pow = Math.pow(10, exp);
  const mant = a / pow;
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (mant <= step + 1e-12) return step * pow;
  }
  return 10 * pow;
}

/** Map data values onto panel y-coordinates (SVG y grows downward, so
 *  larger values get smaller y). Symmetric ranges centre zero. */
export function panelScale(values, height) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (lo >= 0) lo = 0;
  if (hi <= 0) hi = 0;
  if (lo < 0 && hi > 0) {
    const m = niceAxisMax(Math.max(-lo, hi));
    lo = -m; hi = m;
  } else if (hi > 0) {
    hi = niceAxisMax(hi);
  } else {
    lo = -niceAxisMax(-lo);
  }
  const span = hi - lo || 1;
  return (v) => height - ((v - lo) / span) * height;
}

/** `count` evenly spaced tick times spanning [startMs, endMs] inclusive. */
export function timeTicks(startMs, endMs, count) {
  const n = Math.max(2, count);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(Math.round(startMs + ((endMs - startMs) * i) / (n - 1)));
  }
  return out;
}
```

Then append the painter. Mirror `polar-modal-frame.js` for the embedded-style
and `data-layer` conventions:

```javascript
const PANELS = [
  { key: "dopplerHz",         label: "Doppler",  unit: "kHz", scale: 1e-3 },
  { key: "angRateDegPerSec",  label: "Ang. rate", unit: "deg/s", scale: 1 },
  { key: "relSignalDb",       label: "Signal",   unit: "dB",  scale: 1 },
];

const CHART_STYLE = `
  .rc-bg     { fill: rgba(4, 8, 20, 0.95); stroke: rgba(126, 184, 255, 0.35); stroke-width: 0.4; }
  .rc-zero   { stroke: rgba(126, 184, 255, 0.45); stroke-width: 0.35; }
  .rc-trace  { fill: none; stroke: #7eb8ff; stroke-width: 1.1; stroke-linejoin: round; }
  .rc-tca    { stroke: #ffb454; stroke-width: 0.5; stroke-dasharray: 2 1.5; }
  .rc-label  { fill: #8aa0c8; font-size: 3.2px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .rc-head   { fill: #b8c4dc; font-size: 4.4px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .rc-meth   { fill: #6a7a9a; font-size: 2.4px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
`;

function el(tag, attrs, text) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text != null) n.textContent = text;
  return n;
}

/** Paint the three-panel chart. `series` is the radioPassSamples result;
 *  `meta` carries satelliteName, observerName, freqHz, downlinkLabel,
 *  duty, tz, elevM, elevSource. */
export function paintRadioChart(svg, series, meta) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.appendChild(el("style", {}, CHART_STYLE));

  const { samples, summary } = series;
  if (!samples.length) return;
  const t0 = samples[0].tMs, t1 = samples[samples.length - 1].tMs;
  const span = Math.max(1, t1 - t0);
  const X0 = 34, W = 268, H = 44, GAP = 10, Y0 = 30;
  const xOf = (ms) => X0 + ((ms - t0) / span) * W;

  svg.appendChild(el("text", { x: X0, y: 12, class: "rc-head" },
    `${meta.satelliteName} · ${(meta.freqHz / 1e6).toFixed(3)} MHz · ${meta.observerName}`));
  svg.appendChild(el("text", { x: X0, y: 19, class: "rc-label" },
    `${meta.downlinkLabel ?? ""} (${meta.duty ?? "unknown"}) · ` +
    `swing ${(summary.dopplerPeakToPeakHz / 1000).toFixed(2)} kHz · ` +
    `max rate ${summary.maxDopplerRateHzPerSec.toFixed(0)} Hz/s · ` +
    `closest ${(summary.closestRangeM / 1000).toFixed(1)} km`));

  PANELS.forEach((panel, i) => {
    const top = Y0 + i * (H + GAP);
    const g = el("g", { "data-layer": panel.key });
    g.appendChild(el("rect", { x: X0, y: top, width: W, height: H, class: "rc-bg" }));

    const vals = samples.map((s) => (s[panel.key] ?? 0) * panel.scale);
    const yOf = panelScale(vals, H);
    const zeroY = top + yOf(0);
    g.appendChild(el("line", { x1: X0, y1: zeroY, x2: X0 + W, y2: zeroY, class: "rc-zero" }));

    const pts = samples
      .map((s, j) => (s[panel.key] == null ? null : `${xOf(s.tMs)},${top + yOf(vals[j])}`))
      .filter(Boolean).join(" ");
    if (pts) g.appendChild(el("polyline", { points: pts, class: "rc-trace" }));

    g.appendChild(el("text", { x: 4, y: top + 6, class: "rc-label" },
      `${panel.label} (${panel.unit})`));
    // One shared TCA rule per panel: Doppler crosses zero, angular rate and
    // signal both peak, all on the same instant.
    const tx = xOf(summary.tcaMs);
    g.appendChild(el("line", { x1: tx, y1: top, x2: tx, y2: top + H, class: "rc-tca" }));
    svg.appendChild(g);
  });

  const axisY = Y0 + PANELS.length * (H + GAP);
  for (const ms of timeTicks(t0, t1, 5)) {
    const label = new Date(ms).toISOString().slice(11, 19);
    svg.appendChild(el("text", { x: xOf(ms), y: axisY, class: "rc-label",
      "text-anchor": "middle" }, label));
  }
  svg.appendChild(el("text", { x: X0, y: axisY + 6, class: "rc-label" }, "UTC"));

  const methods = el("g", { "data-layer": "methods" });
  const notes = [
    `Predicted — verify against your capture. Only the SHAPE is comparable:`,
    `the transmitter's oscillator offset is unknown and constant (~±1.1 kHz),`,
    `so measure the null as the MIDPOINT of the swing, not as a crossing of ${(meta.freqHz / 1e6).toFixed(3)} MHz.`,
    `Signal is free-space path loss only (peak ${summary.absoluteFsplDb?.toFixed(1)} dB);`,
    `an envelope valid for circular polarization — Faraday rotation causes deep VHF nulls.`,
    `Observer elevation ${meta.elevM ?? 0} m (${meta.elevSource ?? "default"}), orthometric.`,
  ];
  notes.forEach((line, i) => methods.appendChild(
    el("text", { x: X0, y: axisY + 14 + i * 3.4, class: "rc-meth" }, line)));
  svg.appendChild(methods);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/radio-chart.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/pass-finder/radio-chart.js test/radio-chart.test.mjs
git commit -m "feat: radio pass chart painter"
```

---

### Task 8: Radio modal and the observer-card trigger

**Files:**
- Create: `components/passes/RadioModal.tsx`
- Modify: `components/passes/ObserverCard.tsx`
- Modify: `components/PassFinderApp.tsx` (mount the modal)
- Modify: `lib/scene-bridge.ts` (add `renderRadioModal`)
- Modify: `lib/pass-finder-scene.js` (implement it)
- Modify: `lib/pass-finder/polar-png.js` (filename prefix parameter)
- Modify: `app/pass-finder.css`
- Modify: `test/polar-png.test.mjs`

**Interfaces:**
- Consumes: `radioPassSamples` (Task 4), `paintRadioChart` (Task 7), store fields (Task 6).
- Produces: `renderRadioModal(svgEl, obsId) -> Promise<{ blobUrl, fileName } | null>`; `polarModalFileNameFor(obs, ms, prefix = 'iss-pass')`.

- [ ] **Step 1: Write the failing test**

In `test/polar-png.test.mjs`, add:

```javascript
test('polarModalFileNameFor accepts a prefix for radio exports', () => {
  const fn = polarModalFileNameFor({ name: 'Chicago' }, ms, 'radio-pass');
  assert.match(fn, /^radio-pass-chicago-2025-06-\d{2}T\d{6}Z\.png$/);
});

test('polarModalFileNameFor keeps its original default prefix', () => {
  const fn = polarModalFileNameFor({ name: 'Chicago' }, ms);
  assert.match(fn, /^iss-pass-chicago-/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/polar-png.test.mjs`
Expected: FAIL — the radio-prefixed name still starts with `iss-pass`.

- [ ] **Step 3: Add the prefix parameter**

In `lib/pass-finder/polar-png.js`, change the signature to
`export function polarModalFileNameFor(obs, ms, prefix = "iss-pass")` and use
`` `${prefix}-${obsSlug}-...` `` in the returned template. Defaulting keeps
all existing callers working unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/polar-png.test.mjs`
Expected: PASS.

- [ ] **Step 5: Add the scene bridge entry**

In `lib/scene-bridge.ts`, add to the `SceneBridge` interface, mirroring `renderPolarModal`:

```typescript
  renderRadioModal: (
    svgEl: SVGSVGElement,
    obsId: string,
  ) => Promise<PolarModalRenderResult | null>;
```

and the passthrough export:

```typescript
export const renderRadioModal: SceneBridge["renderRadioModal"] = (svg, obsId) =>
  bridge().renderRadioModal(svg, obsId);
```

In `lib/pass-finder-scene.js`:

```javascript
import { radioPassSamples } from "./pass-finder/radio-pass.js";
import { paintRadioChart } from "./pass-finder/radio-chart.js";
import { defaultDownlink } from "./catalog.mjs";

// Build the per-observer series for a radio pass. Uses the OBSERVER'S OWN
// window, not the joint multi-observer intersection - an intersection
// truncates the S-curve and understates the swing.
function radioSeriesFor(obsId, stepMs) {
  const obs = state.observers.find((o) => o.id === obsId);
  if (!obs || !satrec) return null;
  const w = state.windows[state.activeWindowIdx] ?? state.windows[0];
  if (!w) return null;
  const own = passWindowAtMsForObserver(
    obs, bestMomentMs(w), "radio", state.minElevDeg, issEcefAt,
  );
  if (!own) return null;

  const obsEcef = geodeticToEcef(obs.latDeg, obs.lonDeg, obs.elevM ?? 0);
  const la = obs.latDeg * Math.PI / 180, lo = obs.lonDeg * Math.PI / 180;
  const upEcef = [
    Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la),
  ];
  const entry = CATALOG.find((s) => s.noradId === state.selectedNoradId);
  const dl = defaultDownlink(entry);
  const freqHz = state.downlinkHz ?? (dl ? dl.hz : null);

  const series = radioPassSamples(
    obs, own,
    { satStateAt, obsEcef, upEcef },
    { freqHz, stepMs },
  );
  return { obs, entry, dl, freqHz, series };
}

async function renderRadioModal(svgEl, obsId) {
  const built = radioSeriesFor(obsId, 2000);
  if (!built) return null;
  paintRadioChart(svgEl, built.series, {
    satelliteName: built.entry?.shortName ?? "Satellite",
    observerName: built.obs.name,
    freqHz: built.freqHz,
    downlinkLabel: built.dl?.label,
    duty: built.dl?.duty,
    tz: built.obs.tz,
    elevM: built.obs.elevM,
    elevSource: built.obs.elevSource,
  });
  const blob = await svgToPngBlob(svgEl);
  return {
    blobUrl: URL.createObjectURL(blob),
    fileName: polarModalFileNameFor(
      built.obs, built.series.summary.tcaMs, "radio-pass",
    ),
  };
}
```

Register `renderRadioModal` in the bridge object alongside `renderPolarModal`.

- [ ] **Step 6: Create the modal**

Create `components/passes/RadioModal.tsx` as a copy of `PolarModal.tsx` with
these substitutions: `polarModalObsId` → `radioModalObsId`,
`renderPolarModal` → `renderRadioModal`, `id="polar-modal"` →
`id="radio-modal"`, `aria-label` → `Radio pass — ${obsName}`, the download
name → `radio-pass.png`, and a wider `viewBox` suited to three stacked
panels (`"0 0 320 240"`). Keep the blob-URL revocation, the
`renderedObsId === obsId` visibility gate, the Escape handler, the backdrop
click, and the copy/save buttons exactly as they are.

Mount it next to `<PolarModal />` in `components/PassFinderApp.tsx`.

- [ ] **Step 7: Add the card trigger**

In `components/passes/ObserverCard.tsx`, read the mode and the setter:

```typescript
  const mode = usePassFinderStore((s) => s.mode);
  const setRadioModalObsId = usePassFinderStore((s) => s.setRadioModalObsId);
```

and add a button before the `fps-view` one, using the same `stop(ev)` pattern
so it does not open the polar modal underneath:

```tsx
        {mode === "radio" && (
          <button
            type="button"
            className="radio-chart"
            title="Doppler + signal chart for this pass"
            onClick={(ev) => { stop(ev); setRadioModalObsId(obs.id); }}
          >
            〜
          </button>
        )}
```

Card click still opens the sky chart — it remains useful in radio mode as
the antenna-pointing view.

- [ ] **Step 8: Add the frequency picker**

Spec §15 requires a frequency control in the chart header, and §10.2 gives
ISS two downlinks whose Doppler axes differ 3x. Add to `RadioModal.tsx`,
above the SVG:

```tsx
  const selectedNoradId = usePassFinderStore((s) => s.selectedNoradId);
  const downlinkHz = usePassFinderStore((s) => s.downlinkHz);
  const setDownlinkHz = usePassFinderStore((s) => s.setDownlinkHz);
  const entry = CATALOG.find((s) => s.noradId === selectedNoradId);
  const options = entry?.downlinks ?? [];

  // ... inside .polar-modal-actions:
  <select
    className="radio-freq-select"
    value={downlinkHz ?? ""}
    onChange={(ev) => setDownlinkHz(ev.target.value ? Number(ev.target.value) : null)}
  >
    {options.length === 0 && <option value="">no known downlink</option>}
    {options.map((d) => (
      <option key={d.hz} value={d.hz}>
        {(d.hz / 1e6).toFixed(3)} MHz — {d.label}
      </option>
    ))}
  </select>
  <input
    className="radio-freq-input"
    type="number"
    step="0.001"
    placeholder="MHz"
    aria-label="Custom downlink frequency in MHz"
    onBlur={(ev) => {
      const mhz = Number(ev.target.value);
      if (Number.isFinite(mhz) && mhz > 1) setDownlinkHz(Math.round(mhz * 1e6));
    }}
  />
```

Changing the frequency must repaint: add `downlinkHz` to the `useEffect`
dependency array that calls `renderRadioModal`, so the Doppler axis rescales.

When `options` is empty and no custom frequency is set, the sampler already
returns `dopplerHz: null` for every sample (Task 4), and `paintRadioChart`
skips the Doppler polyline — the angular-rate and signal panels still draw.

- [ ] **Step 9: Add styles**

In `app/pass-finder.css`, add `#radio-modal` rules mirroring the existing
`#polar-modal` block (backdrop, content, actions, svg sizing, hint), and a
`.obs-card-header .radio-chart` rule matching `.fps-view`'s dimensions and
hover treatment.

- [ ] **Step 10: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: PASS both.

- [ ] **Step 11: Commit**

```bash
git add components/passes/RadioModal.tsx components/passes/ObserverCard.tsx components/PassFinderApp.tsx lib/scene-bridge.ts lib/pass-finder-scene.js lib/pass-finder/polar-png.js app/pass-finder.css test/polar-png.test.mjs
git commit -m "feat: radio pass modal and observer-card trigger"
```

---

### Task 9: CSV export

**Files:**
- Create: `lib/pass-finder/radio-csv.js`
- Create: `test/radio-csv.test.mjs`
- Modify: `components/passes/RadioModal.tsx` (export button)

**Interfaces:**
- Consumes: `radioPassSamples` output (Task 4).
- Produces: `radioPassCsv(samples, meta) -> string`.

- [ ] **Step 1: Write the failing test**

Create `test/radio-csv.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radioPassCsv } from '../lib/pass-finder/radio-csv.js';

const SAMPLES = [{
  tMs: Date.UTC(2024, 0, 1, 12, 0, 0, 250),
  rangeM: 812345.678, rangeRateMps: -6543.21, dopplerHz: 9551.4,
  elDeg: 12.3456, azDeg: 271.9, angRateDegPerSec: 0.3412, relSignalDb: -5.87,
}];

const META = {
  satelliteName: 'ISS (ZARYA)', observerName: 'Chicago',
  freqHz: 437_800_000, tleEpochMs: Date.UTC(2023, 11, 30, 12, 0, 0),
  clockSkewMs: -420, elevM: 180, elevSource: 'lookup',
};

test('header block records the inputs a reader needs to judge the data', () => {
  const csv = radioPassCsv(SAMPLES, META);
  assert.match(csv, /# satellite: ISS \(ZARYA\)/);
  assert.match(csv, /# downlink_hz: 437800000/);
  assert.match(csv, /# tle_epoch: 2023-12-30T12:00:00\.000Z/);
  assert.match(csv, /# tle_epoch_age_days: 2\.0/);
  assert.match(csv, /# observer_elev_m: 180 \(lookup\)/);
  assert.match(csv, /# clock_skew_ms: -420/);
});

test('TLE age is reported as a magnitude with direction, never bare negative', () => {
  // Propagating to a time BEFORE epoch is legitimate and gives a negative
  // age; "-0.45 days old" would read as a bug.
  const csv = radioPassCsv(SAMPLES, { ...META, tleEpochMs: Date.UTC(2024, 0, 3) });
  assert.match(csv, /# tle_epoch_age_days: 1\.5 \(before epoch\)/);
});

test('column order is fixed and values keep useful precision', () => {
  const csv = radioPassCsv(SAMPLES, META);
  const lines = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim());
  assert.equal(
    lines[0],
    'time_utc,az_deg,el_deg,range_m,range_rate_mps,doppler_hz,doppler_rate_hz_s,rel_signal_db',
  );
  const cells = lines[1].split(',');
  assert.equal(cells[0], '2024-01-01T12:00:00.250Z', 'millisecond timestamps');
  assert.equal(cells[1], '271.900');
  assert.equal(cells[2], '12.346');
  assert.equal(cells[3], '812345.7');
});

test('a null frequency leaves the Doppler columns empty, not NaN', () => {
  const csv = radioPassCsv(
    [{ ...SAMPLES[0], dopplerHz: null }],
    { ...META, freqHz: null },
  );
  assert.ok(!csv.includes('NaN'));
  const row = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim())[1];
  assert.equal(row.split(',')[5], '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/radio-csv.test.mjs`
Expected: FAIL — `Cannot find module '../lib/pass-finder/radio-csv.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/pass-finder/radio-csv.js`:

```javascript
// lib/pass-finder/radio-csv.js - the sample series as CSV, for driving a
// rig or a camera trigger.
//
// Azimuth and elevation are APPARENT (refracted, light-time retarded), so
// they are pointing angles rather than geometric ones.
//
// The header block carries the inputs that bound the accuracy: TLE epoch
// age (ISS along-track drift is ~1 km/day, 0.13 s of pass timing per km),
// the detected browser clock skew, and the observer elevation with its
// provenance. Sub-second camera triggering needs an NTP-disciplined clock;
// the app cannot provide one.

const COLUMNS = [
  "time_utc", "az_deg", "el_deg", "range_m", "range_rate_mps",
  "doppler_hz", "doppler_rate_hz_s", "rel_signal_db",
];

const num = (v, dp) => (v == null || !Number.isFinite(v) ? "" : v.toFixed(dp));

export function radioPassCsv(samples, meta = {}) {
  const lines = [];
  lines.push(`# satellite: ${meta.satelliteName ?? "unknown"}`);
  lines.push(`# observer: ${meta.observerName ?? "unknown"}`);
  lines.push(`# downlink_hz: ${meta.freqHz ?? ""}`);
  if (meta.tleEpochMs != null && samples.length) {
    const epoch = new Date(meta.tleEpochMs);
    lines.push(`# tle_epoch: ${epoch.toISOString()}`);
    const ageDays = (samples[0].tMs - meta.tleEpochMs) / 86400000;
    const suffix = ageDays < 0 ? " (before epoch)" : "";
    lines.push(`# tle_epoch_age_days: ${Math.abs(ageDays).toFixed(1)}${suffix}`);
  }
  if (meta.elevM != null) {
    lines.push(`# observer_elev_m: ${meta.elevM} (${meta.elevSource ?? "unknown"})`);
  }
  if (meta.clockSkewMs != null) lines.push(`# clock_skew_ms: ${meta.clockSkewMs}`);
  lines.push("# az/el are apparent: refracted and light-time retarded");
  lines.push(COLUMNS.join(","));

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    let rate = null;
    if (i > 0 && s.dopplerHz != null && samples[i - 1].dopplerHz != null) {
      const dt = (s.tMs - samples[i - 1].tMs) / 1000;
      if (dt > 0) rate = (s.dopplerHz - samples[i - 1].dopplerHz) / dt;
    }
    lines.push([
      new Date(s.tMs).toISOString(),
      num(s.azDeg, 3),
      num(s.elDeg, 3),
      num(s.rangeM, 1),
      num(s.rangeRateMps, 3),
      num(s.dopplerHz, 1),
      num(rate, 2),
      num(s.relSignalDb, 2),
    ].join(","));
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/radio-csv.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the export button**

In `components/passes/RadioModal.tsx`, add a "CSV" button beside "Save PNG"
that requests a 1 s series (the chart uses 2 s; at 180 Hz/s, 2 s rows leave a
rig 360 Hz out between points) via a new `radioPassCsvFor(obsId)` bridge
method, then triggers a `Blob` download:

```tsx
  const onCsv = async () => {
    const csv = await radioPassCsvFor(obsId!);
    if (!csv) return;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `radio-pass-${obsName ?? "observer"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
```

Add `radioPassCsvFor` to `SceneBridge` in `lib/scene-bridge.ts` and implement
it in `lib/pass-finder-scene.js` by calling `radioPassSamples` with
`stepMs: 1000` and passing the result to `radioPassCsv` along with the TLE
epoch, the clock skew from `clock-sync.js`, and the observer's elevation and
its provenance.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: PASS both.

- [ ] **Step 7: Commit**

```bash
git add lib/pass-finder/radio-csv.js test/radio-csv.test.mjs components/passes/RadioModal.tsx lib/scene-bridge.ts lib/pass-finder-scene.js
git commit -m "feat: CSV export of the radio pass series"
```

---

## Deferred from the spec

These are recorded so they are not silently lost. None blocks the feature.

- **§19 — `isRadioReachable` uses optical refraction.** Radio refraction is
  ~10-15% larger; the effect is window-edge timing only (~0.15 s at a 10°
  cutoff, ~1.2 s at 0°). Not worth a radio refraction model; state it in the
  methods panel.
- **§19 — the 60 s pass-search step** (`pass-finder-scene.js:1594`) can alias
  out passes peaking within ~0.4° of `minElevDeg`, roughly 1-2%. A smaller
  `stepMs` in radio mode is a one-argument fix.
- **§10.3 — Tier 3 catalog additions** (SO-50 on 436.795, Meteor-M2-4 on
  137.9 LRPT). Changes `CATALOG.length` and the id-list assertion at
  `test/catalog.test.mjs:8`; a separate change.
- **§5.2 — the optional `sgp4()` direct call.** Computing minutes-since-epoch
  from integer milliseconds removes the library's ~0.2 m noise floor and
  tightens TCA from ~0.8 ms to ~0.25 ms. Not needed while the range rate is
  analytic.
- **§2 — observed-recording import.** The interfaces here are shaped to
  accept it; it is the next project.
