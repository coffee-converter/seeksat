// lib/mcp/ecef-sampler.mjs - build the satrec once, sample ECEF (meters)
// at any Date. Mirrors lib/truth.js: tlePositionEcef but hoists the satrec
// build (satrecFromRecord: OMM via json2satrec, else TLE lines) out of the
// hot loop for the pass search.

import * as sat from 'satellite.js';
import { satrecFromRecord } from '../sat/satrec.mjs';

export function makeEcefSampler(record) {
  const satrec = satrecFromRecord(record);
  return function ecefAt(jsDate) {
    const pv = sat.propagate(satrec, jsDate);
    if (!pv || !pv.position) return null;
    const gmst = sat.gstime(jsDate);
    const ecf = sat.eciToEcf(pv.position, gmst);
    return [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000];
  };
}
