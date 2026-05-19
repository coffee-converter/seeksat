// lib/pass-finder/polar-stars.js — paint star dots + labels onto the
// fullscreen polar modal's [data-layer="stars"] group.
//
// Pure given (svg, obs, jsDate, limMag, modalGeom). All catalog data
// and per-star helpers come from star-catalog.js; projection from
// sky-helpers.js. The scene file wraps this so callers don't have to
// know about modalGeom.

import { SVG_NS, altAzToSvg, starAltAzForObs } from "./sky-helpers.js";
import {
  BRIGHT_STARS, MORE_STARS, FAINT_STARS, DIM_STARS,
  starDirectionEcef, starDotColor, starDotRadius, starDotOpacity,
} from "./star-catalog.js";

// Minimum distance (in SVG units) two label centers must be from each
// other before we'll place both. The chart spans ~180 SVG units across
// (R=90 radius), so 14 units ≈ 7° of sky — keeps the Big Dipper and
// Orion's belt from stacking name on name. Brightest-first sort means
// brighter stars always win the right to a label.
const STAR_LABEL_MIN_DIST = 14;

export function paintPolarModalStars(svg, obs, jsDate, limMag, modalGeom) {
  const starsG = svg.querySelector('[data-layer="stars"]');
  if (!starsG) return;
  starsG.replaceChildren();

  // Brighter stars get first claim to label space. Stars whose labels
  // would crash into an already-placed label still draw their dot.
  const labelEligible = [...BRIGHT_STARS].sort((a, b) => a.mag - b.mag);
  const placedLabels = [];
  // Twilight gate: stars dimmer than this magnitude are washed out by
  // sky glow at the prevailing sun altitude — skip rendering them.
  // limMag === null means "no filter" (legacy callers).
  const passesLimMag = (mag) => limMag == null || mag <= limMag;
  const { cx, cy, R } = modalGeom;

  const drawStar = (star, withLabel) => {
    if (!passesLimMag(star.mag)) return;
    const dirEcef = starDirectionEcef(star, jsDate);
    const { alt, az } = starAltAzForObs(obs, dirEcef);
    if (alt < 0) return;
    const [x, y] = altAzToSvg(alt, az, cx, cy, R);
    const r = starDotRadius(star.mag);
    const op = starDotOpacity(star.mag);
    const d = document.createElementNS(SVG_NS, "circle");
    d.classList.add("star-dot");
    d.setAttribute("cx", x.toFixed(2));
    d.setAttribute("cy", y.toFixed(2));
    d.setAttribute("r", r.toFixed(2));
    d.setAttribute("fill", starDotColor(star));
    if (op < 1) d.setAttribute("opacity", op.toFixed(2));
    starsG.appendChild(d);
    if (withLabel && star.name) {
      const lx = x, ly = y - r - 1.2;
      const tooClose = placedLabels.some(p =>
        Math.hypot(p.x - lx, p.y - ly) < STAR_LABEL_MIN_DIST
      );
      if (tooClose) return;
      placedLabels.push({ x: lx, y: ly });
      const t = document.createElementNS(SVG_NS, "text");
      t.classList.add("star-name");
      t.setAttribute("x", lx.toFixed(2));
      t.setAttribute("y", ly.toFixed(2));
      t.setAttribute("text-anchor", "middle");
      t.textContent = star.name;
      starsG.appendChild(t);
    }
  };
  // Labeled (brightest-first so declutter favors them)
  for (const star of labelEligible) drawStar(star, true);
  // Dots only — fill-in catalogs for visual density. DIM_STARS adds
  // the mag 4-5 layer that only appears on dark-sky nights (limMag
  // filter above gates it out at brighter twilight stages).
  for (const star of MORE_STARS)  drawStar(star, false);
  for (const star of FAINT_STARS) drawStar(star, false);
  for (const star of DIM_STARS)   drawStar(star, false);
}
