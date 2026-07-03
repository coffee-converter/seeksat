// lib/pass-finder/polar-arc.js - ISS-arc painting helpers shared by
// the small per-card polar plot and the fullscreen modal.
//
// Pure given inputs: the only scene-coupled thing is "where is the
// ISS at time t?", which callers thread in as an `issEcefAtFn`
// callback (driven by the satrec the scene owns).

import { sunPositionEcef } from "./sun.js";
import { sunAltitudeDeg, issIlluminated, issAltAzDeg } from "./visibility.js";
import { magnitudeAt } from "./ratings.js";
import { SVG_NS, altAzToSvg, naturalSkyLimMag } from "./sky-helpers.js";

// Opacity range for the visible ISS arc - gradient by per-sample
// magnitude. Faintest (m ≈ +2) maps to 0.18, brightest (m ≈ -3) to
// 0.88, with the asymptotic uniform value used when no magnitude
// estimate is available (e.g., radio-mode arcs where the ISS isn't
// being scored on visual brightness).
export const ARC_OPACITY_UNIFORM = 0.65;
export const ARC_DASH_ALPHA = 0.3;

export function issAlphaForMag(m) {
  if (m == null) return ARC_OPACITY_UNIFORM;
  // m = -3 → t=1 (fully opaque end of range); m = +2 → t=0 (dimmest).
  const t = Math.max(0, Math.min(1, (-m + 2) / 5));
  return 0.18 + t * 0.7;
}

// Per-sample arc style. Returns { alpha, dashed } so the segment
// renderer can mark "would be visible if not for the ISS being
// eclipsed / too dim" stretches with a dotted-low-opacity treatment -
// diagnostically useful on a dark-sky radio pass where the ISS dips
// into Earth's shadow mid-arc and the operator wants to know "where
// would I be looking if it were lit?"
export function arcSampleStyle(obs, issEcef, jsDate, stdMag = -1.8) {
  const sunDir = sunPositionEcef(jsDate);
  const sunAlt = sunAltitudeDeg(obs, jsDate);
  // Unified rule: dashed whenever the ISS isn't naked-eye visible at
  // this instant for this observer (daylight sky, civil-twilight sky,
  // ISS in Earth's shadow, or ISS dimmer than the sky-glow limit).
  // Solid + magnitude-gradient only when it's actually observable.
  const darkSky = sunAlt <= -6;
  if (!darkSky) return { alpha: ARC_DASH_ALPHA, dashed: true };
  if (!issIlluminated(issEcef, sunDir)) {
    return { alpha: ARC_DASH_ALPHA, dashed: true };
  }
  const m = magnitudeAt(obs, issEcef, sunDir, stdMag);
  if (m == null || m > naturalSkyLimMag(sunAlt)) {
    return { alpha: ARC_DASH_ALPHA, dashed: true };
  }
  return { alpha: issAlphaForMag(m), dashed: false };
}

// Sample an arc trajectory at SAMPLES+1 evenly-spaced instants across
// a pass window, returning {x, y, alpha, dashed} per sample in the
// caller's SVG coordinate space. Skips below-horizon samples so a
// window that strays under the horizon at its edges doesn't yield
// nonsense segments. Shared by the modal and the small icon plots.
//
// `issEcefAtFn(jsDate) → [x, y, z] | null` is threaded in by the
// scene so this module doesn't need a satrec dependency.
export function computeArcSamples(obs, win, cx, cy, R, SAMPLES, issEcefAtFn, stdMag = -1.8) {
  const dt = (win.endMs - win.startMs) / SAMPLES;
  const samples = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const d = new Date(win.startMs + dt * i);
    const issEcef = issEcefAtFn(d);
    if (!issEcef) continue;
    const { alt, az } = issAltAzDeg(obs, issEcef);
    if (alt < 0) continue;
    const [x, y] = altAzToSvg(alt, az, cx, cy, R);
    samples.push({ x, y, ...arcSampleStyle(obs, issEcef, d, stdMag) });
  }
  return samples;
}

// Render the segmented arc inside a <g> container. Solid segments are
// individual <line> elements so each can carry its own magnitude-
// derived stroke-opacity; consecutive dashed segments collapse into a
// single <polyline> so SVG's stroke-dasharray follows the actual
// path arclength and dash spacing stays even regardless of how
// sample times stretch or compress along the chart. dashArray is in
// the caller's viewBox units, so small icons want larger numbers than
// the modal for visually-similar dash density.
export function renderArcSegments(arcGroup, samples, stroke, dashArray) {
  arcGroup.replaceChildren();
  if (samples.length < 2) return;
  let dashedRun = null;
  const flushDashedRun = () => {
    if (!dashedRun) return;
    const pl = document.createElementNS(SVG_NS, "polyline");
    pl.setAttribute("points", dashedRun.points.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" "));
    pl.setAttribute("fill", "none");
    pl.setAttribute("stroke", stroke);
    pl.setAttribute("stroke-opacity", ARC_DASH_ALPHA.toFixed(3));
    pl.setAttribute("stroke-dasharray", dashArray);
    // Butt caps on dashed runs so each gap is honored exactly - round
    // caps (the default from the .arc CSS) extend every dash by half
    // the stroke width on each side, which eats the gap on thick
    // small-icon strokes and makes the dashed run look solid.
    pl.setAttribute("stroke-linecap", "butt");
    arcGroup.appendChild(pl);
    dashedRun = null;
  };
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    const dashed = a.dashed || b.dashed;
    if (dashed) {
      if (!dashedRun) dashedRun = { points: [[a.x, a.y]] };
      dashedRun.points.push([b.x, b.y]);
      continue;
    }
    flushDashedRun();
    const ln = document.createElementNS(SVG_NS, "line");
    ln.setAttribute("x1", a.x.toFixed(2));
    ln.setAttribute("y1", a.y.toFixed(2));
    ln.setAttribute("x2", b.x.toFixed(2));
    ln.setAttribute("y2", b.y.toFixed(2));
    ln.setAttribute("stroke", stroke);
    ln.setAttribute("stroke-opacity", ((a.alpha + b.alpha) / 2).toFixed(3));
    arcGroup.appendChild(ln);
  }
  flushDashedRun();
}

// SVG path for the moon's illuminated portion, in moon-local coords:
// +x points toward the sun (lit side). The terminator is an ellipse
// with semi-axes (r·|cos i|, r); we trace the outer right-half disc
// edge plus the half of the ellipse on the un-/over-lit side to close
// the boundary. After drawing, the caller rotates the whole shape so
// +x in this frame aligns with the actual sun direction in the chart.
export function moonLitPath(cx, cy, r, phaseAngleRad) {
  const cosI = Math.cos(phaseAngleRad);
  const termRx = r * Math.abs(cosI);
  // SVG sweep-flag=1 means "increasing-angle direction" - for our
  // bottom→top return arc that goes through θ=π (the LEFT side of the
  // ellipse). sweep-flag=0 goes through θ=0 (the RIGHT side).
  //
  // Gibbous (cosI > 0, lit > 50%): the terminator sits on the unlit
  //   -x side, and the lit region extends past center into the left
  //   half → the closing arc has to bulge LEFT → sweep=1.
  // Crescent (cosI < 0, lit < 50%): the terminator sits on the +x
  //   side of the disc just inside the lit edge → the closing arc
  //   bulges RIGHT, taking a bite out of the right semicircle to
  //   produce a thin crescent → sweep=0.
  const termSweep = cosI >= 0 ? 1 : 0;
  return `M ${cx},${cy - r} `
       + `A ${r},${r} 0 0,1 ${cx},${cy + r} `
       + `A ${termRx.toFixed(3)},${r} 0 0,${termSweep} ${cx},${cy - r} Z`;
}
