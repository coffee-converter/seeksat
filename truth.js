// truth.js -- SGP4 propagation via global `satellite` (satellite.js CDN).
// Returns ECEF position in meters at a JS Date, given a 2-line element set.

const sat = window.satellite;

export function tlePositionEcef(line1, line2, jsDate) {
  if (!sat) throw new Error("satellite.js not loaded");
  const satrec = sat.twoline2satrec(line1.trim(), line2.trim());
  const pv = sat.propagate(satrec, jsDate);
  if (!pv || !pv.position) return null;
  // satellite.js returns ECI (TEME) km. Convert to ECEF and to meters.
  const gmst = sat.gstime(jsDate);
  const ecf = sat.eciToEcf(pv.position, gmst);
  return [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000];
}
