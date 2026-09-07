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
 *  form carries 0.242 Hz of second-order error of its own; the light-time
 *  term beside it is slightly LARGER, at 0.264 Hz. Together a naive
 *  formulation gives up ~0.51 Hz, comparable to the ionosphere.
 *
 *  (Measured over an 89.4 deg ISS pass at 437.8 MHz. The two do not simply
 *  add in the shipped output: the second-order kinematic term partly
 *  cancels the relativistic offset below, so exact-minus-linear comes out
 *  at 0.124 Hz even though its parts are larger.)
 *
 *  The gamma and gravitational factors are included for completeness. Note
 *  they vary by only ~0.25 mHz across a pass (the satellite's radius moves
 *  ~5 km at e = 0.0003), while the transmitter's oscillator offset is
 *  unknown and constant at +/-1.1 kHz - so they are perfectly degenerate
 *  with it and unobservable in a single recording. They are here because they are free, not because they can be
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
