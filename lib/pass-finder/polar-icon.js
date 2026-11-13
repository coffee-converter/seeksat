// lib/pass-finder/polar-icon.js - small-icon polar plot painters for
// the per-observer card. Simpler than the fullscreen modal painters:
// a rise dot and a set arrowhead + an optional sun/moon overlay,
// no overlap-split, no info-row labels.
//
// Both painters are pure given their args. paintIconEvents takes
// `ecefAtFn` as a callback so this module stays satrec-free; the
// scene wraps it with its own ecefAt closure.

import { SVG_NS, altAzToSvg, starAltAzForObs } from "./sky-helpers.js";
import { sunPositionEcef } from "./sun.js";
import { satAltAzDeg } from "./visibility.js";
import { moonPositionEcef, moonPhaseAngle, moonIlluminatedFraction } from "./moon.js";
import { moonLitPath } from "./polar-arc.js";

// Where the pass starts and which way it goes: a small dot at the rise and
// an arrowhead at the set, pointing along the path, in the arc's colour
// (currentColor, set by the card). The arc's top shows the peak, so it has
// no mark. `peakMs` is unused, kept for the painter's call shape.
export function paintIconEvents(group, obs, win, peakMs, cx, cy, R, markerR, ecefAtFn) {
  group.replaceChildren();
  if (!win) return;
  const at = (ms) => {
    const e = ecefAtFn(new Date(ms));
    if (!e) return null;
    const { alt, az } = satAltAzDeg(obs, e);
    // Rise and set are where refraction (about 0.6°) and a raised site's
    // horizon dip lift it to the horizon: geometrically it is just below.
    if (alt < -2) return null;
    return altAzToSvg(Math.max(0, alt), az, cx, cy, R);
  };
  const rise = at(win.startMs);
  if (rise) {
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", rise[0].toFixed(2));
    dot.setAttribute("cy", rise[1].toFixed(2));
    dot.setAttribute("r", (markerR * 0.6).toFixed(2));
    dot.setAttribute("class", "rise");
    group.appendChild(dot);
  }
  // The arrow points from a moment before the set to the set.
  const end = at(win.endMs);
  const before = at(win.endMs - Math.min(60_000, (win.endMs - win.startMs) / 6));
  if (end && before) {
    const dx = end[0] - before[0];
    const dy = end[1] - before[1];
    const len = Math.hypot(dx, dy);
    if (len > 0.01) {
      const ux = dx / len, uy = dy / len;
      const L = markerR * 1.5, W = markerR * 0.85;
      const bx = end[0] - ux * L, by = end[1] - uy * L;
      const d = `M ${end[0].toFixed(2)},${end[1].toFixed(2)} ` +
        `L ${(bx - uy * W).toFixed(2)},${(by + ux * W).toFixed(2)} ` +
        `L ${(bx + uy * W).toFixed(2)},${(by - ux * W).toFixed(2)} Z`;
      const arrow = document.createElementNS(SVG_NS, "path");
      arrow.setAttribute("d", d);
      arrow.setAttribute("class", "set");
      group.appendChild(arrow);
    }
  }
}

// Sun + moon for the small icon. No M/S glyphs (illegible at small
// scale), no planets. Moon gets the phase-shaded illuminated portion
// oriented toward the chart's sun position (still works when the sun
// itself is below the horizon and not drawn).
export function paintIconSunMoon(group, obs, jsDate, cx, cy, R, bodyR) {
  group.replaceChildren();
  const sunDir = sunPositionEcef(jsDate);
  const sunAA = starAltAzForObs(obs, sunDir);
  const moonDir = moonPositionEcef(jsDate);
  const moonAA = starAltAzForObs(obs, moonDir);
  const [sx, sy] = altAzToSvg(sunAA.alt, sunAA.az, cx, cy, R);
  if (moonAA.alt >= 0) {
    const [mx, my] = altAzToSvg(moonAA.alt, moonAA.az, cx, cy, R);
    const dark = document.createElementNS(SVG_NS, "circle");
    dark.setAttribute("cx", mx.toFixed(2));
    dark.setAttribute("cy", my.toFixed(2));
    dark.setAttribute("r", bodyR);
    dark.setAttribute("fill", "#1a1f2e");
    dark.setAttribute("stroke", "rgba(220,225,240,0.45)");
    dark.setAttribute("stroke-width", "0.4");
    group.appendChild(dark);
    const litFrac = moonIlluminatedFraction(jsDate);
    if (litFrac > 0.01) {
      const litPath = moonLitPath(mx, my, bodyR, moonPhaseAngle(jsDate));
      const sunAngle = Math.atan2(sy - my, sx - mx) * 180 / Math.PI;
      const lit = document.createElementNS(SVG_NS, "path");
      lit.setAttribute("d", litPath);
      lit.setAttribute("fill", "#e8eefc");
      lit.setAttribute("transform",
        `rotate(${sunAngle.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)})`);
      group.appendChild(lit);
    }
  }
  if (sunAA.alt >= 0) {
    const sun = document.createElementNS(SVG_NS, "circle");
    sun.setAttribute("cx", sx.toFixed(2));
    sun.setAttribute("cy", sy.toFixed(2));
    sun.setAttribute("r", (bodyR * 0.85).toFixed(2));
    sun.setAttribute("fill", "#ffe066");
    sun.setAttribute("stroke", "#ffd633");
    sun.setAttribute("stroke-width", "0.4");
    group.appendChild(sun);
  }
}
