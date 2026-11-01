// lib/passes/card-chart.js - the pass card's small polar plot painter.
//
// Kept apart from charts.js so the home page can paint cards without pulling
// in the sky chart and radio chart painters (stars, constellations). Nothing
// here may import charts.js.

import { apparentAltDeg } from "../refraction.js";
import { satAltAzDeg, sunAltitudeDeg } from "../pass-finder/visibility.js";
import { altAzToSvg, chartPalette, skyShadeForSunAlt } from "../pass-finder/sky-helpers.js";
import { computeArcSamples, renderArcSegments } from "../pass-finder/polar-arc.js";
import { paintIconEvents, paintIconSunMoon } from "../pass-finder/polar-icon.js";
import { bestMomentMs, peakStepMsFor } from "../pass-finder/window-scoring.js";

// Intrinsic magnitude when the catalog has none: the ISS's, as before.
const DEFAULT_STD_MAG = -1.8;

// The pass card's small polar plot: viewBox 0 0 100 100, horizon radius 45.
const CARD = { cx: 50, cy: 50, R: 45 };
const CARD_ARC_SAMPLES = 30;

/** Paint a pass card's small polar plot (the PolarPlotSvg skeleton): sky
 *  shade, arc, start/peak/end markers, sun and moon, and the satellite dot.
 *  Matches the scene's observer-card painting, except the sky is shown at
 *  the pass peak rather than a playback clock, as the sky chart does. The
 *  dot shows only while the satellite is above the horizon at `nowMs`. */
export function paintPassCard(svgEl, { track, obs, win, nowMs }) {
  const ecefAtFn = track.ecefAt;
  const { cx, cy, R } = CARD;
  // The engine's peak when the window carries one; else the same search it runs
  // for a single observer.
  const peakMs = !win
    ? nowMs
    : Number.isFinite(win.peakMs)
      ? win.peakMs
      : bestMomentMs(win, [obs], ecefAtFn, peakStepMsFor(win.endMs - win.startMs));
  const peakDate = new Date(peakMs);
  const sunAlt = apparentAltDeg(sunAltitudeDeg(obs, peakDate));

  const horizon = svgEl.querySelector(".horizon");
  if (horizon) horizon.style.fill = skyShadeForSunAlt(sunAlt);

  const arc = svgEl.querySelector(".arc");
  if (arc) {
    if (!win) {
      arc.replaceChildren();
    } else {
      const samples = computeArcSamples(obs, win, cx, cy, R, CARD_ARC_SAMPLES, ecefAtFn,
        track.standardMag ?? DEFAULT_STD_MAG);
      renderArcSegments(arc, samples, chartPalette(sunAlt).arc, "4 6");
    }
  }

  const events = svgEl.querySelector(".events");
  if (events) paintIconEvents(events, obs, win, win ? peakMs : null, cx, cy, R, 2.8, ecefAtFn);

  const bodies = svgEl.querySelector(".bodies");
  if (bodies) paintIconSunMoon(bodies, obs, peakDate, cx, cy, R, 2.4);

  const dot = svgEl.querySelector(".iss-dot");
  if (dot) {
    const satEcef = ecefAtFn(new Date(nowMs));
    const aa = satEcef ? satAltAzDeg(obs, satEcef) : null;
    if (!aa || aa.alt < 0) {
      dot.style.display = "none";
    } else {
      const [x, y] = altAzToSvg(aa.alt, aa.az, cx, cy, R);
      dot.setAttribute("cx", x.toFixed(2));
      dot.setAttribute("cy", y.toFixed(2));
      dot.style.display = "";
    }
  }
}
