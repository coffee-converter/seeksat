// lib/mcp/ecef-sampler.mjs — build the satrec once, sample ECEF (meters)
// at any Date. Mirrors lib/truth.js: tlePositionEcef but hoists the
// twoline2satrec parse out of the hot loop for the pass search.

import * as sat from 'satellite.js';

export function makeEcefSampler(line1, line2) {
  const satrec = sat.twoline2satrec(line1.trim(), line2.trim());
  return function ecefAt(jsDate) {
    const pv = sat.propagate(satrec, jsDate);
    if (!pv || !pv.position) return null;
    const gmst = sat.gstime(jsDate);
    const ecf = sat.eciToEcf(pv.position, gmst);
    return [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000];
  };
}
