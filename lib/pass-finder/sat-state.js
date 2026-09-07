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
 *  Using 2*PI/86400 (the solar day) instead is a 0.27% error - up to
 *  1.27 m/s of observer velocity (at the equator, falling with cos(lat)),
 *  1.9 Hz at 437.8 MHz. */
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
