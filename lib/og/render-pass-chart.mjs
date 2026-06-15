// lib/og/render-pass-chart.mjs — render the REAL polar sky chart with
// the app's own modal painters (the lib/pass-finder-scene.js
// renderPolarModalInto sequence), cropped to the circular chart for the
// OG card. Importing ./dom.mjs installs the DOM the painters need.
import { newSvgRoot, serialize } from "./dom.mjs";
import { paintPolarModalStatic } from "../pass-finder/polar-modal-frame.js";
import { computeArcSamples, renderArcSegments } from "../pass-finder/polar-arc.js";
import { paintPolarModalEvents } from "../pass-finder/polar-events.js";
import { paintPolarModalConstellations } from "../pass-finder/constellations.js";
import { paintPolarModalStars } from "../pass-finder/polar-stars.js";
import { paintPolarModalSunMoon, paintPolarModalLegend } from "../pass-finder/polar-bodies.js";
import { sunAltitudeDeg } from "../pass-finder/visibility.js";
import { naturalSkyLimMag } from "../pass-finder/sky-helpers.js";

const MODAL_GEOM = { cx: 100, cy: 100, R: 90 };
const POLAR_ARC_COLOR = "#aab8d4";

// { observer, win, peakMs, issEcefAt, satName?, full? } -> chart SVG string.
// Default (full=false): cropped to just the circle, for the OG share card.
// full=true: the complete modal layout (title/meta header, legend, sky
// background) — what the on-screen modal shows — for standalone use (the
// get_pass_chart MCP tool hands this to agents).
export function renderPassChartSVG({ observer, win, peakMs, issEcefAt, satName, full = false }) {
  const svg = newSvgRoot("-24 -68 248 278"); // native modal viewBox while painting
  const sunAltAtPeak = sunAltitudeDeg(observer, new Date(peakMs));
  const limMag = naturalSkyLimMag(sunAltAtPeak);
  const jsDate = new Date(peakMs);

  paintPolarModalStatic(svg, observer, peakMs, sunAltAtPeak,
    { modalGeom: MODAL_GEOM, tzRefMs: win.startMs, satName });

  const arc = svg.querySelector(".arc");
  const stroke = svg.dataset.arcStroke || POLAR_ARC_COLOR;
  const samples = computeArcSamples(observer, win, MODAL_GEOM.cx, MODAL_GEOM.cy, MODAL_GEOM.R, 60, issEcefAt);
  renderArcSegments(arc, samples, stroke, "1.4 1.8");

  paintPolarModalEvents(svg, observer, peakMs, win,
    { modalGeom: MODAL_GEOM, issEcefAtFn: issEcefAt, polarArcColor: POLAR_ARC_COLOR });
  paintPolarModalConstellations(svg, observer, jsDate, sunAltAtPeak, MODAL_GEOM);
  paintPolarModalStars(svg, observer, jsDate, limMag, MODAL_GEOM);
  paintPolarModalSunMoon(svg, observer, jsDate, limMag, MODAL_GEOM);

  if (full) {
    // Complete modal layout: paint the legend and keep the native viewBox,
    // sky background, title/meta header, and watermark (the same picture
    // the on-screen modal shows).
    paintPolarModalLegend(svg, observer, jsDate, limMag, MODAL_GEOM);
    return serialize(svg);
  }

  // OG card: trim to the circular chart — drop watermark, full-bleed bg, and
  // the metadata header text. The on-disc Start/Peak/End markers stay; the
  // event TEXT table sits above the disc and is cropped by the viewBox. The
  // legend is never painted; any now-orphaned CSS rules left in the embedded
  // <style> match nothing, so we leave the stylesheet as-is.
  for (const el of svg.querySelectorAll(
    ".brand-wordmark, .brand-url, .bg, .meta-title, .meta-sub, .meta-tz"
  )) el.remove();
  svg.setAttribute("viewBox", "-8 -8 216 216");
  return serialize(svg);
}
