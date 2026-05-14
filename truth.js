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

// Sample the orbit over +/- half a period around jsCenterDate.
// Each sample is converted to ECEF using the rotation matrix at jsCenterDate
// (snapshot in the Earth-fixed frame at the observation moment), so the
// drawn polyline shows the geometric orbit shape rather than a wobbly
// ground track. Returns an array of [x,y,z] in meters.
export function tleOrbitTrackEcef(line1, line2, jsCenterDate, periodMin = 93, samples = 360) {
  if (!sat) throw new Error("satellite.js not loaded");
  const satrec = sat.twoline2satrec(line1.trim(), line2.trim());
  const periodMs = periodMin * 60 * 1000;
  const dt = periodMs / (samples - 1);
  const gmstCenter = sat.gstime(jsCenterDate);
  const points = [];
  for (let i = 0; i < samples; i++) {
    const t = new Date(jsCenterDate.getTime() - periodMs / 2 + i * dt);
    const pv = sat.propagate(satrec, t);
    if (!pv || !pv.position) continue;
    const ecf = sat.eciToEcf(pv.position, gmstCenter);
    points.push([ecf.x * 1000, ecf.y * 1000, ecf.z * 1000]);
  }
  return points;
}
