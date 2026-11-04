// lib/passes/charts.js - sky chart and radio chart orchestration for one
// satellite, one observer and one pass.
//
// Lifted out of the 3D globe scene so pages without a globe can draw the same
// charts. Everything here takes explicit inputs (a Track, an observer, a
// resolved pass window); deciding WHICH pass and observer to chart stays
// with the caller. The painters themselves live in lib/pass-finder/.

import { geodeticToEcef } from "../coords.js";
import { sunAltitudeDeg } from "../pass-finder/visibility.js";
import {
  naturalSkyLimMag,
} from "../pass-finder/sky-helpers.js";
import { paintPolarModalStatic } from "../pass-finder/polar-modal-frame.js";
import { computeArcSamples, renderArcSegments } from "../pass-finder/polar-arc.js";
import { passPeakMs, paintPolarModalEvents } from "../pass-finder/polar-events.js";
import { paintPolarModalConstellations } from "../pass-finder/constellations.js";
import { paintPolarModalStars } from "../pass-finder/polar-stars.js";
import { paintPolarModalSunMoon, paintPolarModalLegend } from "../pass-finder/polar-bodies.js";
import { radioChartWindows } from "../pass-finder/radio-window.js";
import { walkOptsForOrbit } from "../pass-finder/observer-pass.js";
import { radioPassSamples } from "../pass-finder/radio-pass.js";
import { radioPassCsv } from "../pass-finder/radio-csv.js";
import { polarModalFileNameFor } from "../pass-finder/polar-png.js";
import { slug } from "../pass-finder/text.js";

export const MODAL_GEOM = { cx: 100, cy: 100, R: 90 };

// The sky-chart arc paints in a neutral gray rather than the observer's
// color - in this view the arc represents the satellite path, not the
// observer. paintPolarModalStatic usually stashes a sky-adapted stroke on
// the SVG root; this is the fallback.
export const POLAR_ARC_COLOR = "#aab8d4";
const ARC_SAMPLES = 60;

/** Paint the full sky chart for `obs` over pass window `win` (null paints
 *  the sky with no arc). The sky backdrop is anchored at the pass PEAK, not
 *  a playback clock, so a pass three hours away shows its own sky.
 *  `tzRefMs` picks the instant whose UTC offset the chart labels (so DST
 *  matches the pass); it defaults to the peak. */
export function paintSkyChart(svgEl, { track, obs, win, tzRefMs }) {
  const ecefAtFn = track.ecefAt;
  const peakMs = win ? passPeakMs(win, obs, ecefAtFn) : Date.now();
  const sunAltAtPeak = sunAltitudeDeg(obs, new Date(peakMs));
  const limMag = naturalSkyLimMag(sunAltAtPeak);
  paintPolarModalStatic(svgEl, obs, peakMs, sunAltAtPeak, {
    modalGeom: MODAL_GEOM,
    tzRefMs: tzRefMs ?? peakMs,
    satName: track.name,
  });

  const arc = svgEl.querySelector(".arc");
  if (arc) {
    if (!win) {
      arc.replaceChildren();
    } else {
      const stroke = svgEl.dataset.arcStroke || POLAR_ARC_COLOR;
      const { cx, cy, R } = MODAL_GEOM;
      // null, never undefined, so a satellite with no published brightness
      // gets the plain arc rather than computeArcSamples' ISS default.
      const samples = computeArcSamples(obs, win, cx, cy, R, ARC_SAMPLES, ecefAtFn,
        track.standardMag ?? null);
      renderArcSegments(arc, samples, stroke, "1.4 1.8");
    }
  }

  const jsDate = new Date(peakMs);
  paintPolarModalEvents(svgEl, obs, peakMs, win, {
    modalGeom: MODAL_GEOM,
    ecefAtFn,
    polarArcColor: POLAR_ARC_COLOR,
  });
  paintPolarModalConstellations(svgEl, obs, jsDate, sunAltAtPeak, MODAL_GEOM);
  paintPolarModalStars(svgEl, obs, jsDate, limMag, MODAL_GEOM);
  paintPolarModalSunMoon(svgEl, obs, jsDate, limMag, MODAL_GEOM);
  paintPolarModalLegend(svgEl, obs, jsDate, limMag, MODAL_GEOM);
}

/** On-screen radio chart step: 2 s for LEO passes, coarser for long ones so
 *  a pass stays near 1800 samples. */
export function chartStepMs(durationMs) {
  return Math.max(2000, Math.ceil(durationMs / 1800 / 1000) * 1000);
}

/** CSV step: 1 s for LEO passes. At ~180 Hz/s of Doppler swing near TCA a
 *  2 s row leaves a rig 360 Hz out between points, so the export samples
 *  finer than the chart. Coarser for long passes, near 7200 rows. */
export function csvStepMs(durationMs) {
  return Math.max(1000, Math.ceil(durationMs / 7200 / 1000) * 1000);
}

/** Build the radio series for `obs`. Uses the OBSERVER'S OWN pass through
 *  `anchorMs`, not a joint multi-observer window - an intersection truncates
 *  the S-curve and understates the swing. The window rule (chart the full
 *  geometric pass, draw the elevation threshold rather than apply it) lives
 *  in radio-window.js.
 *
 *  `jointWindow` is shaded inside the chart; pass it only when there is more
 *  than one observer. `dl` describes the frequency actually selected, not
 *  the catalog default, and is null for a custom frequency: better to say
 *  nothing than the wrong duty. Returns null when the observer cannot see
 *  the satellite at `anchorMs`.
 *  @param {{ track: any, obs: any, anchorMs: number, minElevDeg: number,
 *    freqHz?: number | null, jointWindow?: { startMs: number, endMs: number } | null,
 *    purpose?: "chart" | "csv" }} args */
export function radioSeries({ track, obs, anchorMs, minElevDeg, freqHz, jointWindow = null, purpose = "chart" }) {
  const wins = radioChartWindows(obs, anchorMs, minElevDeg, track.ecefAt,
    walkOptsForOrbit(track.orbitClass, track.periodMs));
  if (!wins) return null;
  const own = wins.full;
  const durationMs = own.endMs - own.startMs;
  const stepMs = purpose === "csv" ? csvStepMs(durationMs) : chartStepMs(durationMs);

  const obsEcef = geodeticToEcef(obs.latDeg, obs.lonDeg, obs.elevM ?? 0);
  const la = obs.latDeg * Math.PI / 180, lo = obs.lonDeg * Math.PI / 180;
  const upEcef = [
    Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la),
  ];
  const dl = track.downlinks.find((d) => d.hz === freqHz) ?? null;

  const series = radioPassSamples(
    obs, own,
    { satStateAt: track.stateAt, obsEcef, upEcef },
    { freqHz, stepMs },
  );
  return { series, dl, freqHz, workableWindow: wins.workable, jointWindow,
           minElevDeg, clamped: wins.clamped };
}

/** An uplink's frequency to correct for Doppler: its centre when it is a
 *  band, or null without one. */
export function uplinkCentreHz(uplink) {
  if (!uplink || !(uplink.hz > 0)) return null;
  return uplink.highHz > uplink.hz ? Math.round((uplink.hz + uplink.highHz) / 2) : uplink.hz;
}

/** The options paintRadioChart takes for a series built by radioSeries. */
export function radioChartOptions(built, { track, obs }) {
  return {
    satelliteName: track.shortName,
    observerName: obs.name,
    freqHz: built.freqHz,
    downlinkLabel: built.dl?.label,
    duty: built.dl?.duty,
    // Where to transmit: the uplink's centre, for a linear transponder's band.
    uplinkHz: uplinkCentreHz(built.dl?.uplink),
    tz: obs.tz,
    elevM: obs.elevM,
    elevSource: obs.elevSource,
    jointStartMs: built.jointWindow?.startMs ?? null,
    jointEndMs: built.jointWindow?.endMs ?? null,
    workableStartMs: built.workableWindow?.startMs ?? null,
    workableEndMs: built.workableWindow?.endMs ?? null,
    minElevDeg: built.minElevDeg,
    clamped: built.clamped,
  };
}

/** The radio pass CSV for a series built by radioSeries (purpose 'csv'). */
export function radioCsvText(built, { track, obs, generatedAtMs, clockSkewMs }) {
  const meta = {
    satelliteName: track.shortName,
    noradId: track.noradId,
    observerName: obs.name,
    // The position every row derives from, and the elements it was
    // propagated from: together these make the file reproducible by
    // someone who does not have SeekSat.
    latDeg: obs.latDeg,
    lonDeg: obs.lonDeg,
    freqHz: built.freqHz,
    uplinkHz: uplinkCentreHz(built.dl?.uplink),
    downlinkLabel: built.dl?.label,
    tcaMs: built.series.summary.tcaMs,
    tleEpochMs: track.epochMs,
    generatedAtMs,
    clockSkewMs,
    elevM: obs.elevM,
    elevSource: obs.elevSource,
    minElevDeg: built.minElevDeg,
    workableStartMs: built.workableWindow?.startMs,
    workableEndMs: built.workableWindow?.endMs,
    clamped: built.clamped,
  };
  // An OMM-only track (NORAD IDs above 99999) has no TLE lines to quote.
  const { line1, line2 } = track.record ?? {};
  if (line1 && line2) {
    meta.tleLine1 = line1;
    meta.tleLine2 = line2;
  }
  return radioPassCsv(built.series.samples, meta);
}

/** Export file name for a pass chart. `kind` is 'sky' or 'radio'; the two
 *  prefixes differ so the downloads don't collide, and a pass's PNG and CSV
 *  sort together. */
export function passFileName(track, obs, ms, kind, ext = "png") {
  const sat = slug(track.shortName, "sat");
  const prefix = kind === "radio" ? `radio-${sat}` : `${sat}-pass`;
  return polarModalFileNameFor(obs, ms, prefix, ext);
}
