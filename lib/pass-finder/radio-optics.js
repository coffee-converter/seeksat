// lib/pass-finder/radio-optics.js - the two non-Doppler curves: apparent
// angular rate (what a camera measures) and the received-signal envelope.

import { apparentAltDeg } from "../refraction.js";
import { C_LIGHT } from "./doppler.js";

const DEG = Math.PI / 180;

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
  const ratio = rangeM / rangeMinM;
  if (ratio === 1) return 0; // avoid -0
  return -20 * Math.log10(ratio);
}

/** Absolute free-space path loss in dB, for annotating the peak. */
export function absoluteFsplDb(rangeM, freqHz) {
  return 20 * Math.log10((4 * Math.PI * rangeM * freqHz) / C_LIGHT);
}
