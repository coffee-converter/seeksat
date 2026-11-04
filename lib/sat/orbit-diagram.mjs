// Orbit diagram geometry: the orbit drawn to scale in its own plane.
// Perifocal frame: Earth's center (the focus) is the origin, perigee on +x.
import { orbitElements, EQUATORIAL_RADIUS_KM } from './numbers.mjs';

const TWO_PI = 2 * Math.PI;
// Coordinates go into server-rendered SVG: two decimals, so the last-digit
// float differences between the server's and the browser's V8 never show up
// as a hydration mismatch.
const q = (v) => Math.round(v * 100) / 100;

function solveKepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 20; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-10) break;
  }
  return E;
}

export function orbitDiagram(track, nowMs, { size = 240, pad = 16 } = {}) {
  const { semiMajorAxisKm: a, eccentricity: e } = orbitElements(track);
  const R = EQUATORIAL_RADIUS_KM;
  const b = a * Math.sqrt(1 - e * e);
  const rp = a * (1 - e), ra = a * (1 + e);

  // Union box in km (perifocal): x from min(-ra,-R) to max(rp,R), y symmetric.
  const xMin = Math.min(-ra, -R), xMax = Math.max(rp, R);
  const yHalf = Math.max(b, R);
  const scale = (size - 2 * pad) / Math.max(xMax - xMin, 2 * yHalf);
  const ox = size / 2 - ((xMin + xMax) / 2) * scale; // SVG x of the focus
  const oy = size / 2; // SVG y of the focus
  const px = (x) => ox + x * scale;
  const py = (y) => oy - y * scale;

  let dot = null;
  if (a > 0) {
    const { mo, no } = track.satrec;
    let M = (mo + (no * (nowMs - track.epochMs)) / 60000) % TWO_PI;
    if (M < 0) M += TWO_PI;
    const E = solveKepler(M, e);
    const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    const r = a * (1 - e * Math.cos(E));
    dot = { x: q(px(r * Math.cos(nu))), y: q(py(r * Math.sin(nu))) };
  }

  return {
    size,
    scale,
    earth: { cx: q(px(0)), cy: q(py(0)), r: q(R * scale) },
    ellipse: { cx: q(px(-a * e)), cy: q(py(0)), rx: q(a * scale), ry: q(b * scale) },
    perigee: { x: q(px(rp)), y: q(py(0)) },
    apogee: { x: q(px(-ra)), y: q(py(0)) },
    dot,
  };
}
