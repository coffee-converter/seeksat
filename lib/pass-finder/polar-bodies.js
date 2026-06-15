// lib/pass-finder/polar-bodies.js — fullscreen polar-modal painters
// for celestial bodies (sun, moon, naked-eye planets) on the chart
// itself plus the bottom-left legend that mirrors them.
//
// Pure given (svg, obs, jsDate, limMag, modalGeom). Body data and
// position helpers come from sun/moon/planets modules; moonLitPath
// from polar-arc.js.

import { SVG_NS, altAzToSvg, starAltAzForObs } from "./sky-helpers.js";
import { sunPositionEcef } from "./sun.js";
import { moonPositionEcef, moonPhaseAngle, moonIlluminatedFraction } from "./moon.js";
import { planetPositionEcef, planetApparentMagnitude, PLANET_STYLE, PLANET_NAMES } from "./planets.js";
import { moonLitPath, ARC_DASH_ALPHA } from "./polar-arc.js";

// Apparent radii (radians) of the sun and moon. Used to occlude any
// planet whose chart-direction lies inside one of those discs.
const SUN_R_RAD = 0.267 * Math.PI / 180;
const MOON_R_RAD = 0.259 * Math.PI / 180;

// Planet glyph — traditional astrological symbol painted in the
// planet's own color with a thin dark halo (paint-order: stroke) for
// legibility against any sky shade. No disc backing — the glyph
// itself is the planet marker. Font size scales off the disc radius
// the caller would have used, so brighter planets read bigger.
export function appendPlanetGlyph(layer, cx, cy, glyph, discR, color) {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", cx.toFixed(2));
  t.setAttribute("y", cy.toFixed(2));
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("dominant-baseline", "central");
  t.setAttribute("fill", color || "#e8eefc");
  // Bumped 1.55x → 2.8x: the glyph IS the marker now, so it should
  // read at roughly the disc-diameter size that brightness conveyed.
  t.setAttribute("font-size", (discR * 2.8).toFixed(2));
  t.classList.add("planet-glyph");
  t.textContent = glyph;
  layer.appendChild(t);
}

// Single-letter identifier painted at the center of a body disc.
// Caller picks the fill (and optionally a CSS blend mode — the moon's
// "M" uses mix-blend-mode: difference so it inverts whatever the
// lit/unlit fill is below it).
export function appendBodyGlyph(layer, cx, cy, letter, fill, blend) {
  const g = document.createElementNS(SVG_NS, "text");
  g.setAttribute("x", cx.toFixed(2));
  g.setAttribute("y", cy.toFixed(2));
  g.setAttribute("text-anchor", "middle");
  g.setAttribute("dominant-baseline", "central");
  g.setAttribute("fill", fill);
  if (blend) g.style.mixBlendMode = blend;
  g.classList.add("body-glyph");
  g.textContent = letter;
  layer.appendChild(g);
}

export function paintPolarModalSunMoon(svg, obs, jsDate, limMag, modalGeom) {
  const layer = svg.querySelector('[data-layer="bodies"]');
  if (!layer) return;
  layer.replaceChildren();
  const { cx, cy, R } = modalGeom;
  const sunDir = sunPositionEcef(jsDate);
  const sunAA = starAltAzForObs(obs, sunDir);
  const moonDir = moonPositionEcef(jsDate);
  const moonAA = starAltAzForObs(obs, moonDir);
  // Sun chart position is needed for orienting the moon even when the
  // sun itself is below horizon (the lit side still faces where the
  // sun would be).
  const [sx, sy] = altAzToSvg(sunAA.alt, sunAA.az, cx, cy, R);

  // Moon FIRST so the Sun always paints on top of it (matters when
  // they're geometrically close — e.g. on a new-moon day). Sun and
  // moon stay smaller than the event markers (diamonds), since they
  // are sky CONTEXT for the chart while the markers are the chart's
  // featured content.
  if (moonAA.alt >= 0) {
    const [mx, my] = altAzToSvg(moonAA.alt, moonAA.az, cx, cy, R);
    const moonR = 1.8;
    // Dark disc behind the lit shape so the unlit side reads as a
    // circle (rather than empty negative space at new/crescent).
    const dark = document.createElementNS(SVG_NS, "circle");
    dark.setAttribute("cx", mx.toFixed(2));
    dark.setAttribute("cy", my.toFixed(2));
    dark.setAttribute("r", moonR);
    dark.setAttribute("fill", "#1a1f2e");
    dark.setAttribute("stroke", "rgba(220,225,240,0.4)");
    dark.setAttribute("stroke-width", "0.3");
    layer.appendChild(dark);
    // Illuminated portion drawn in moon-local frame (+x toward sun),
    // then rotated so +x points to the sun's chart position.
    const litFrac = moonIlluminatedFraction(jsDate);
    if (litFrac > 0.01) {
      const litPath = moonLitPath(mx, my, moonR, moonPhaseAngle(jsDate));
      const sunAngle = Math.atan2(sy - my, sx - mx) * 180 / Math.PI;
      const lit = document.createElementNS(SVG_NS, "path");
      lit.setAttribute("d", litPath);
      lit.setAttribute("fill", "#e8eefc");
      lit.setAttribute("transform", `rotate(${sunAngle.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)})`);
      layer.appendChild(lit);
    }
    // Difference blend means the white fill inverts whatever's beneath
    // it — the M reads dark on the bright lit hemisphere and bright
    // on the dark unlit hemisphere automatically, including at the
    // terminator where one stroke can span both.
    appendBodyGlyph(layer, mx, my, "M", "#ffffff", "difference");
  }

  if (sunAA.alt >= 0) {
    const sun = document.createElementNS(SVG_NS, "circle");
    sun.setAttribute("cx", sx.toFixed(2));
    sun.setAttribute("cy", sy.toFixed(2));
    sun.setAttribute("r", 1.6);
    sun.setAttribute("fill", "#ffe066");
    sun.setAttribute("stroke", "#ffd633");
    sun.setAttribute("stroke-width", "0.3");
    layer.appendChild(sun);
    // Same difference trick on the S — white fill inverts the yellow
    // disc beneath it to a clearly readable dark blue-ish letter,
    // without competing with the peak marker's gold. Small upward
    // nudge: "central" baseline puts the S a hair low visually,
    // since its glyph weight skews toward the bottom curve.
    appendBodyGlyph(layer, sx, sy - 0.12, "S", "#ffffff", "difference");
  }

  // ---- Planets ---------------------------------------------------
  // Five classical naked-eye planets, drawn as small colored discs
  // (Pogson-scaled by approximate apparent magnitude) with their
  // traditional astrological glyph in difference-blend overlay. Hide
  // any planet whose angular position falls inside the sun's or
  // moon's apparent disc — literal occlusion. Sun and moon both
  // subtend ~0.5°, so the threshold is one apparent radius.
  for (const pname of PLANET_NAMES) {
    const dirEcef = planetPositionEcef(pname, jsDate);
    const aa = starAltAzForObs(obs, dirEcef);
    if (aa.alt < 0) continue;
    // Occlusion vs sun.
    const dotSun = sunDir[0] * dirEcef[0] + sunDir[1] * dirEcef[1] + sunDir[2] * dirEcef[2];
    if (Math.acos(Math.max(-1, Math.min(1, dotSun))) < SUN_R_RAD) continue;
    // Occlusion vs moon (moonDir is a unit vector, so dot is cos of separation).
    const dotMoon = moonDir[0] * dirEcef[0] + moonDir[1] * dirEcef[1] + moonDir[2] * dirEcef[2];
    if (Math.acos(Math.max(-1, Math.min(1, dotMoon))) < MOON_R_RAD) continue;
    const style = PLANET_STYLE[pname];
    const mag = planetApparentMagnitude(pname, jsDate);
    // Twilight gate: drop planets whose apparent magnitude is dimmer
    // than the prevailing sky-glow limit. Venus stays visible through
    // most of daytime (mag -4 ≪ daylight limit -3); Saturn drops out
    // around civil twilight.
    if (limMag != null && mag != null && mag > limMag) continue;
    // Narrow clamp: Pogson scaling would make Venus a small planet
    // (mag -4 → r≈6) and Saturn near-invisible (mag +1 → r≈0.6).
    // We want all five readable as discs without the brightest two
    // dominating the chart.
    const pogson = 0.95 * Math.pow(10, -(mag ?? 1.0) / 5);
    const r = Math.max(1.1, Math.min(1.5, pogson));
    const [px, py] = altAzToSvg(aa.alt, aa.az, cx, cy, R);
    // Glyph-only rendering — planet color on the glyph itself with a
    // thin dark stroke (paint-order: stroke) keeps it legible against
    // any sky shade. The disc-and-overlay approach made the inner
    // glyph too small to read; here the whole footprint IS the glyph.
    appendPlanetGlyph(layer, px, py, style.glyph, r, style.color);
  }
}

// Legend painted in the lower-left corner of the chart's viewBox.
// Bottom-anchored so the stack always sits flush to the corner; only
// shows bodies that are actually drawn on the chart (above horizon +
// passing the limMag gate). The Moon icon mirrors the chart moon's
// phase and sun-relative orientation, so the legend reads as a direct
// reference key for what the user is looking at right now.
export function paintPolarModalLegend(svg, obs, jsDate, limMag, modalGeom) {
  svg.querySelector('[data-layer="legend"]')?.remove();
  const layer = document.createElementNS(SVG_NS, "g");
  layer.dataset.layer = "legend";
  // Pull the chart's actual arc stroke (luminance-derived) and pair
  // it with a small "sky box" rect behind each pass-line swatch
  // painted in the matching sky shade. That way each swatch is a
  // literal mini-render of the chart's pass arc — colors and contrast
  // exactly match what the user sees on the disc.
  const arcStroke = svg.dataset.arcStroke || "#aab8d4";
  const swatchBg = svg.dataset.skyShade || null;

  // Layout constants. xLeft = symbol/swatch left edge; xLbl is a
  // SINGLE label column shared by every row (visibility lines, sun,
  // moon, planets) so the right-side text stack reads flush.
  // Body icons are CENTERED inside the same horizontal band as the
  // visibility swatches (xLeft .. xLeft+swatchLen) so the symbol
  // column reads consistently too.
  const xLeft = -19.6;     // box left ~3px from viewBox left, matches bottom inset
  // Swatch width = exactly 4 chart-style dashes (4×1.4 + 3×1.8 = 11),
  // so the dashed swatch ends on a dash, not a gap.
  const swatchLen = 11;
  const xSymC = xLeft + swatchLen / 2;
  const xLbl = xLeft + swatchLen + 3;
  const rowH = 6;          // bumped from 4.5 for breathing room
  const bottomY = 203;     // last row sits 7px from viewBox bottom

  const addLabel = (yRow, text) => {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", xLbl); t.setAttribute("y", yRow);
    t.setAttribute("dominant-baseline", "central");
    t.classList.add("legend-text");
    t.textContent = text;
    layer.appendChild(t);
  };

  // Pre-compute body altitudes to decide what shows up.
  const sunDir = sunPositionEcef(jsDate);
  const sunAA = starAltAzForObs(obs, sunDir);
  const moonDir = moonPositionEcef(jsDate);
  const moonAA = starAltAzForObs(obs, moonDir);

  // ?demoLegend=1 → bypass all visibility filters so every legend row
  // renders. Useful for previewing the maximum legend size. Guarded for
  // server-side rendering (no `location` in Node — the MCP/OG render path).
  const demoAll = typeof location !== "undefined"
    && new URLSearchParams(location.search).has("demoLegend");

  // Build the row list first (a kind + payload) so we can compute
  // total height for bottom-alignment, then render in a second pass.
  const rows = [];
  rows.push({ kind: "passLine", solid: true,  label: "visible" });
  rows.push({ kind: "passLine", solid: false, label: "not visible" });
  if (demoAll || sunAA.alt >= 0) rows.push({ kind: "sun" });
  if (demoAll || moonAA.alt >= 0) rows.push({ kind: "moon" });

  for (const pname of PLANET_NAMES) {
    const dirEcef = planetPositionEcef(pname, jsDate);
    const aa = starAltAzForObs(obs, dirEcef);
    const dotSun = sunDir[0]*dirEcef[0] + sunDir[1]*dirEcef[1] + sunDir[2]*dirEcef[2];
    const dotMoon = moonDir[0]*dirEcef[0] + moonDir[1]*dirEcef[1] + moonDir[2]*dirEcef[2];
    const mag = planetApparentMagnitude(pname, jsDate);
    if (!demoAll) {
      if (aa.alt < 0) continue;
      if (Math.acos(Math.max(-1, Math.min(1, dotSun))) < SUN_R_RAD) continue;
      if (Math.acos(Math.max(-1, Math.min(1, dotMoon))) < MOON_R_RAD) continue;
      if (limMag != null && mag != null && mag > limMag) continue;
    }
    rows.push({ kind: "planet", pname });
  }

  // Bottom-anchor: position the LAST row at bottomY, stacking upward.
  let y = bottomY - (rows.length - 1) * rowH;

  // Sky-shade backdrop spanning the entire symbol column. Each swatch
  // becomes a literal mini-render of "what the chart would look like
  // on this kind of sky": arc colors, planet glyphs, sun/moon discs
  // all paint against the actual disc shade. A thin half-transparent
  // blue border (same hue as the chart horizon ring) frames the box
  // without competing visually. No backdrop on dark-sky charts where
  // the shade matches the modal background — invisible anyway.
  if (swatchBg && rows.length > 0) {
    const firstContentY = y;
    const skyBox = document.createElementNS(SVG_NS, "rect");
    const padX = 1.4;
    const padY = 1.0;  // split the diff between original ~0.4 and prior 1.6
    skyBox.setAttribute("x", (xLeft - padX).toFixed(2));
    skyBox.setAttribute("y", (firstContentY - rowH / 2 - padY).toFixed(2));
    skyBox.setAttribute("width", (swatchLen + 2 * padX).toFixed(2));
    skyBox.setAttribute("height", ((rows.length - 1) * rowH + rowH + 2 * padY).toFixed(2));
    skyBox.setAttribute("rx", "1.2");
    skyBox.setAttribute("fill", swatchBg);
    skyBox.setAttribute("stroke", "rgba(126, 184, 255, 0.35)");
    skyBox.setAttribute("stroke-width", "0.3");
    layer.appendChild(skyBox);
  }

  for (const row of rows) {
    if (row.kind === "passLine") {
      if (row.solid) {
        // Smooth ramp via many short segments. stroke-width 1.6 +
        // linecap butt match the chart .arc class exactly, so the
        // legend reads as a literal sample of the chart's pass arc.
        const N = 22;
        const segW = swatchLen / N;
        // Quick ramp to ~full opacity in the first ~55%, then hold
        // near 0.85 — mirrors the issAlphaForMag curve a bright pass
        // produces on the actual chart.
        const opacityAt = (t) => 0.18 + (0.85 - 0.18) * Math.min(1, t * 1.8);
        for (let i = 0; i < N; i++) {
          const seg = document.createElementNS(SVG_NS, "line");
          seg.setAttribute("x1", (xLeft + i * segW).toFixed(3));
          seg.setAttribute("y1", y);
          seg.setAttribute("x2", (xLeft + (i + 1) * segW).toFixed(3));
          seg.setAttribute("y2", y);
          seg.setAttribute("stroke", arcStroke);
          seg.setAttribute("stroke-width", "1.6");
          seg.setAttribute("stroke-opacity", opacityAt(i / (N - 1)).toFixed(3));
          seg.setAttribute("stroke-linecap", "butt");
          layer.appendChild(seg);
        }
      } else {
        // Match the chart's "not visible" arc segments exactly:
        // stroke-width 1.6, dasharray "1.4 1.8", ARC_DASH_ALPHA opacity.
        // swatchLen = 11 = 4*1.4 + 3*1.8, so the line ends on a dash.
        const dashed = document.createElementNS(SVG_NS, "line");
        dashed.setAttribute("x1", xLeft); dashed.setAttribute("y1", y);
        dashed.setAttribute("x2", xLeft + swatchLen); dashed.setAttribute("y2", y);
        dashed.setAttribute("stroke", arcStroke);
        dashed.setAttribute("stroke-width", "1.6");
        dashed.setAttribute("stroke-opacity", String(ARC_DASH_ALPHA));
        dashed.setAttribute("stroke-dasharray", "1.4 1.8");
        dashed.setAttribute("stroke-linecap", "butt");
        layer.appendChild(dashed);
      }
      addLabel(y, row.label);
    } else if (row.kind === "sun") {
      const sun = document.createElementNS(SVG_NS, "circle");
      sun.setAttribute("cx", xSymC); sun.setAttribute("cy", y); sun.setAttribute("r", "1.5");
      sun.setAttribute("fill", "#ffe066");
      sun.setAttribute("stroke", "#ffd633"); sun.setAttribute("stroke-width", "0.3");
      layer.appendChild(sun);
      appendBodyGlyph(layer, xSymC, y - 0.12, "S", "#ffffff", "difference");
      addLabel(y, "Sun");
    } else if (row.kind === "moon") {
      // Mirror the chart moon: same phase angle, same sun-relative
      // rotation (so the legend icon points its lit side the same
      // way the user sees on the chart).
      const { cx, cy, R } = modalGeom;
      const [sx, sy] = altAzToSvg(sunAA.alt, sunAA.az, cx, cy, R);
      const [mx, my] = altAzToSvg(moonAA.alt, moonAA.az, cx, cy, R);
      const sunAngle = Math.atan2(sy - my, sx - mx) * 180 / Math.PI;
      const litFrac = moonIlluminatedFraction(jsDate);
      const phase = moonPhaseAngle(jsDate);
      const r = 1.7;
      const dark = document.createElementNS(SVG_NS, "circle");
      dark.setAttribute("cx", xSymC); dark.setAttribute("cy", y); dark.setAttribute("r", r);
      dark.setAttribute("fill", "#1a1f2e");
      dark.setAttribute("stroke", "rgba(220,225,240,0.4)");
      dark.setAttribute("stroke-width", "0.3");
      layer.appendChild(dark);
      if (litFrac > 0.01) {
        const lit = document.createElementNS(SVG_NS, "path");
        lit.setAttribute("d", moonLitPath(xSymC, y, r, phase));
        lit.setAttribute("fill", "#e8eefc");
        lit.setAttribute("transform", `rotate(${sunAngle.toFixed(2)} ${xSymC} ${y.toFixed(2)})`);
        layer.appendChild(lit);
      }
      appendBodyGlyph(layer, xSymC, y, "M", "#ffffff", "difference");
      // Bucket the current phase into 6 named phases (matching the
      // user-chosen short names). Waxing vs waning is determined by
      // sampling phaseAngle an hour later — phase angle increases
      // from full (0) to new (π), so a later-larger value means we're
      // moving toward new = waning; smaller means waxing.
      const phaseLater = moonPhaseAngle(new Date(jsDate.getTime() + 3600 * 1000));
      const waxing = phaseLater < phase;
      let phaseName;
      if (litFrac < 0.02)         phaseName = "New";
      else if (litFrac > 0.98)    phaseName = "Full";
      else if (Math.abs(litFrac - 0.5) < 0.05) phaseName = waxing ? "1st Qtr" : "3rd Qtr";
      else if (waxing)            phaseName = litFrac < 0.5 ? "Wax Cr" : "Wax Gib";
      else                        phaseName = litFrac < 0.5 ? "Wan Cr" : "Wan Gib";
      addLabel(y, `Moon (${phaseName})`);
    } else if (row.kind === "planet") {
      const style = PLANET_STYLE[row.pname];
      appendPlanetGlyph(layer, xSymC, y, style.glyph, 1.35, style.color);
      addLabel(y, style.name);
    }
    y += rowH;
  }

  svg.appendChild(layer);
}
