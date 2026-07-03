// lib/pass-finder/polar-icon.js - small-icon polar plot painters for
// the per-observer card. Simpler than the fullscreen modal painters:
// just three colored event diamonds + an optional sun/moon overlay,
// no overlap-split, no info-row labels.
//
// Both painters are pure given their args. paintIconEvents takes
// `issEcefAtFn` as a callback so this module stays satrec-free; the
// scene wraps it with its own issEcefAt closure.

import { SVG_NS, altAzToSvg, starAltAzForObs } from "./sky-helpers.js";
import { sunPositionEcef } from "./sun.js";
import { issAltAzDeg } from "./visibility.js";
import { moonPositionEcef, moonPhaseAngle, moonIlluminatedFraction } from "./moon.js";
import { moonLitPath } from "./polar-arc.js";

// Start / peak / end marker colors - must visually tie to the modal's
// EVENT_STYLE row (teal=start, gold=peak, red=end) so a glance from
// card to modal stays interpretable.
export const ICON_EVENT_COLORS = ["#34d399", "#facc15", "#f87171"];

// Three axis-aligned colored diamonds at start / peak / end. `peakMs`
// is the moment of peak coverage (e.g., joint maximum altitude); the
// scene computes it via its `bestMomentMs(win)` and passes it in.
export function paintIconEvents(group, obs, win, peakMs, cx, cy, R, markerR, issEcefAtFn) {
  group.replaceChildren();
  if (!win) return;
  const events = [
    { ms: win.startMs, color: ICON_EVENT_COLORS[0] },
    { ms: peakMs,      color: ICON_EVENT_COLORS[1] },
    { ms: win.endMs,   color: ICON_EVENT_COLORS[2] },
  ];
  for (const ev of events) {
    const e = issEcefAtFn(new Date(ev.ms));
    if (!e) continue;
    const { alt, az } = issAltAzDeg(obs, e);
    if (alt < -0.5) continue;
    const a = Math.max(0, alt);
    const [x, y] = altAzToSvg(a, az, cx, cy, R);
    const d = `M ${x.toFixed(2)},${(y - markerR).toFixed(2)} ` +
              `L ${(x + markerR).toFixed(2)},${y.toFixed(2)} ` +
              `L ${x.toFixed(2)},${(y + markerR).toFixed(2)} ` +
              `L ${(x - markerR).toFixed(2)},${y.toFixed(2)} Z`;
    const m = document.createElementNS(SVG_NS, "path");
    m.setAttribute("d", d);
    m.setAttribute("fill", ev.color);
    m.setAttribute("stroke", "rgba(0,0,0,0.55)");
    m.setAttribute("stroke-width", "0.7");
    group.appendChild(m);
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
