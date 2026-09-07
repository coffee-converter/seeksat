// lib/pass-finder/radio-chart.js - paints the radio-pass chart: three
// stacked panels (angular rate / Doppler / signal) on one shared time axis,
// with a single TCA rule through all three.
//
// CSS is embedded in the SVG so svgToPngBlob can rasterize it standalone,
// exactly as polar-modal-frame.js does. Module-level code never touches
// `document` - only paintRadioChart's body does - so this file imports
// cleanly under node for the pure helper tests below.

import { TX_OSC_PPM, txOscTolerance, wrapText } from "./radio-format.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Round a magnitude up to 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 or 10 times a
 *  power of ten, so axis bounds read cleanly at any frequency. */
export function niceAxisMax(v) {
  const a = Math.abs(v);
  if (!(a > 0)) return 1;
  const exp = Math.floor(Math.log10(a));
  const pow = Math.pow(10, exp);
  const mant = a / pow;
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (mant <= step + 1e-12) return step * pow;
  }
  return 10 * pow;
}

/** Map data values onto panel y-coordinates (SVG y grows downward, so
 *  larger values get smaller y). Symmetric ranges centre zero. */
export function panelScale(values, height) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (lo >= 0) lo = 0;
  if (hi <= 0) hi = 0;
  if (lo < 0 && hi > 0) {
    const m = niceAxisMax(Math.max(-lo, hi));
    lo = -m; hi = m;
  } else if (hi > 0) {
    hi = niceAxisMax(hi);
  } else {
    lo = -niceAxisMax(-lo);
  }
  const span = hi - lo || 1;
  // The bounds ride along on the returned function so the painter can label
  // the axis without recomputing niceAxisMax. Attaching properties keeps the
  // call signature untouched for existing callers.
  const fn = (v) => height - ((v - lo) / span) * height;
  fn.lo = lo;
  fn.hi = hi;
  return fn;
}

/** Format a y-axis tick. Decimals follow magnitude, not unit: a Doppler axis
 *  topping out at 9 kHz wants one decimal, a signal axis at -15 dB wants
 *  none, and both want the zero tick to read plainly as "0". */
export function fmtTick(v) {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

/** Gridline values across [lo, hi], stepping by a readable increment
 *  (1, 2, 2.5 or 5 times a power of ten) that yields roughly `target`
 *  intervals. Dividing the span evenly instead would put an angular-rate
 *  axis on 0.15 deg/s steps - arithmetically fine, unreadable on a chart. */
export function axisTicks(lo, hi, target = 4) {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [lo];
  const raw = span / Math.max(1, target);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = 10 * pow;
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= raw - 1e-12) { step = m * pow; break; }
  }
  // A denormal span could floor `pow` to 0 and stall the walk below.
  if (!(step > 0)) return [lo];
  const out = [];
  const first = Math.ceil(lo / step - 1e-9) * step;
  // Relative epsilon and a hard cap: an absolute 1e-9 let a denormal span
  // walk toward 1e-9 regardless of step, taking ~1e312 iterations before
  // throwing on array length. Unreachable via panelScale, whose bounds go
  // through niceAxisMax, but the guard costs nothing.
  const limit = hi + span * 1e-9;
  for (let v = first; v <= limit && out.length < 64; v += step) {
    // Snap values that land within a rounding whisker of zero, so a tick
    // reads "0" rather than "-0.00".
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

/** `count` evenly spaced tick times spanning [startMs, endMs] inclusive. */
export function timeTicks(startMs, endMs, count) {
  const n = Math.max(2, count);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(Math.round(startMs + ((endMs - startMs) * i) / (n - 1)));
  }
  return out;
}

const PANELS = [
  { key: "angRateDegPerSec", label: "Ang. rate", unit: "deg/s", scale: 1 },
  { key: "dopplerHz",        label: "Doppler",   unit: "kHz",   scale: 1e-3 },
  { key: "relSignalDb",      label: "Signal",    unit: "dB",    scale: 1 },
];

const RANGE_RATE_PANEL =
  { key: "rangeRateMps", label: "Range rate", unit: "m/s", scale: 1 };

/** The panel set to draw. With no downlink frequency selected the Doppler
 *  panel has nothing to show, so it is replaced by range rate (already on
 *  every sample) rather than drawn empty asserting a flat zero - spec §15.
 *
 *  The substitution matches on key, not position: keying it off an index
 *  silently swaps the wrong panel the moment PANELS is reordered. */
export function panelsFor(hasFreq) {
  return hasFreq
    ? PANELS
    : PANELS.map((p) => (p.key === "dopplerHz" ? RANGE_RATE_PANEL : p));
}

/** Type sizes, in viewBox units. Exported so the wrap budgets, the layout
 *  guard in test/radio-chart-layout.test.mjs, and the stylesheet below all
 *  read one value. */
export const FONT_PX = {
  "rc-label": 3.2,
  "rc-head": 4.4,
  "rc-meth": 2.9,
  "rc-panel": 3.0,
  "rc-tick": 2.7,
  "rc-axis": 2.7,
};

const SANS = "-apple-system, BlinkMacSystemFont, sans-serif";

/** Average glyph advance as a fraction of font size, used to turn a pixel
 *  width into a character budget. Deliberately conservative: this copy
 *  measures nearer 0.45 em in Arimo, but the browser resolves whatever
 *  `sans-serif` means locally, and a DejaVu fallback runs ~8-10% wider. */
export const ADVANCE_EM = 0.6;

const CHART_STYLE = `
  /* Opaque canvas ground. Without it the exported PNG has a transparent
     background, which looks correct inside the modal (which supplies its
     own dark ground) but shows as white the moment the image is opened in
     a tab, saved, or pasted into a light-themed document. */
  .rc-canvas { fill: #0a0e1a; }
  .rc-bg     { fill: rgba(4, 8, 20, 0.95); stroke: rgba(126, 184, 255, 0.35); stroke-width: 0.4; }
  .rc-joint  { fill: rgba(126, 184, 255, 0.10); stroke: none; }
  /* Above the observer's minimum elevation. The chart spans the full
     geometric pass so the physics does not move with a filter setting;
     this marks the part they can actually work.
     Lightening rather than darkening the complement is deliberate: on a
     near-black panel there is no headroom downward, so a dark wash is
     invisible while a faint light one reads immediately. */
  .rc-workable { fill: rgba(126, 184, 255, 0.055); stroke: none; }
  .rc-edge   { stroke: rgba(126, 184, 255, 0.30); stroke-width: 0.3; stroke-dasharray: 1 1.2; }
  .rc-zero   { stroke: rgba(126, 184, 255, 0.45); stroke-width: 0.35; }
  /* Gridlines sit well below the zero rule so the zero crossing still reads
     as the significant line rather than one stripe among many. */
  .rc-grid   { stroke: rgba(126, 184, 255, 0.13); stroke-width: 0.25; }
  .rc-trace  { fill: none; stroke: #7eb8ff; stroke-width: 1.1; stroke-linejoin: round; }
  .rc-tca    { stroke: #ffb454; stroke-width: 0.5; stroke-dasharray: 2 1.5; }
  .rc-label  { fill: #8aa0c8; font-size: ${FONT_PX['rc-label']}px; font-family: ${SANS}; }
  .rc-head   { fill: #b8c4dc; font-size: ${FONT_PX['rc-head']}px; font-family: ${SANS}; }
  .rc-meth   { fill: #7a8aa8; font-size: ${FONT_PX['rc-meth']}px; font-family: ${SANS}; }
  /* Axis numbers sit between label and methods in the type scale so they
     read as instrument scale rather than prose. */
  .rc-tick   { fill: #7386a8; font-size: ${FONT_PX['rc-tick']}px; font-family: ${SANS}; }
  .rc-panel  { fill: #9fb3d4; font-size: ${FONT_PX['rc-panel']}px; font-family: ${SANS}; }
  .rc-axis   { fill: #6a7a9a; font-size: ${FONT_PX['rc-axis']}px; font-family: ${SANS}; }
`;

/** Format `ms` as HH:MM:SS in `tz`. Returns null when `tz` is absent or
 *  unrecognized (Intl.DateTimeFormat throws RangeError on a bogus zone) so
 *  callers degrade gracefully - same pattern as polar-png.js. */
export function formatLocalTime(ms, tz) {
  if (!tz) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date(ms));
  } catch (_) {
    return null;
  }
}

/** Short zone abbreviation for `tz` at `ms` (e.g. "CDT"). Returns null on an
 *  absent or bogus zone, like formatLocalTime. Used for the axis row name,
 *  where the full IANA identifier is both too wide and less legible. */
export function formatZoneAbbr(ms, tz) {
  if (!tz) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, timeZoneName: "short",
    }).formatToParts(new Date(ms));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? null;
  } catch (_) {
    return null;
  }
}

function el(tag, attrs, text) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text != null) n.textContent = text;
  return n;
}

/** Format one leg (rise or set) of a reference-elevation Doppler reading.
 *  `null` means the pass never crossed that elevation on that leg - render
 *  it as an em-dash, not as 0 or the string "null". */
export function fmtDopplerLeg(hz) {
  if (hz == null) return "—";
  const khz = hz / 1000;
  return `${khz >= 0 ? "+" : ""}${khz.toFixed(1)} kHz`;
}

/** Paint the three-panel chart. `series` is the radioPassSamples result;
 *  `meta` carries satelliteName, observerName, freqHz, downlinkLabel,
 *  duty, tz, elevM, elevSource, and optionally jointStartMs/jointEndMs
 *  (the multi-observer joint window, omitted for a single observer). */
export function paintRadioChart(svg, series, meta) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.appendChild(el("style", {}, CHART_STYLE));
  const canvas = el("rect", { x: 0, y: 0, width: 320, height: 0, class: "rc-canvas" });
  svg.appendChild(canvas);

  const { samples, summary } = series;
  if (!samples.length) {
    // Size the canvas before bailing: returning early left the rect at
    // height 0 and the viewBox at whatever the previous render set, so an
    // empty series rasterized as a transparent PNG.
    canvas.setAttribute("height", "40");
    svg.setAttribute("viewBox", "0 0 320 40");
    return;
  }
  const t0 = samples[0].tMs, t1 = samples[samples.length - 1].tMs;
  const span = Math.max(1, t1 - t0);
  const X0 = 42, W = 270, H = 46, GAP = 16;
  // Methods-block wrap budget, derived from the plot width rather than
  // guessed, so it tracks any change to W or the type size. 0.6 x font-size
  // is a deliberately conservative average advance - measured against this
  // copy the real figure is nearer 0.45 em, so the budget leaves headroom
  // rather than risking a line running past the viewBox.
  // Character budget for a wrapped line of class `cls`, from the plot width
  // and that class's own type size. Derived, so a font-size change cannot
  // leave the wrapping computing against a stale number.
  const budget = (cls) => Math.floor(W / (FONT_PX[cls] * ADVANCE_EM));
  const methBudget = budget("rc-meth");
  const xOf = (ms) => X0 + ((ms - t0) / span) * W;
  const hasFreq = !!meta.freqHz;
  // Band flags, computed once: the caption and the rect must never be able
  // to disagree about whether a band exists.
  const hasJoint = meta.jointStartMs != null && meta.jointEndMs != null;
  const hasWorkable = meta.workableStartMs != null && meta.workableEndMs != null;

  // Header lines are wrapped, not emitted as single runs. Each was one
  // unwrapped <text> before, and content past the viewBox is silently
  // clipped in both the modal image and the saved PNG - the readouts line
  // reached 322 of 320 units in the default configuration (ISS on its
  // longest catalog label, a 10 deg threshold, two observers) once the
  // second band caption was added. Budgets are derived from the plot width
  // and each type size, so no future clause can reintroduce this.
  const headLines = [];
  const push = (text, cls) => {
    for (const l of wrapText(text, budget(cls))) headLines.push({ text: l, cls });
  };

  // Title. Date is the UTC calendar date of the pass, since nothing else on
  // the chart says which day this is; the frequency segment is meaningful
  // only when a downlink is actually selected.
  const freqStr = hasFreq ? ` · ${(meta.freqHz / 1e6).toFixed(3)} MHz` : "";
  const dateStr = new Date(t0).toISOString().slice(0, 10);
  push(`${meta.satelliteName}${freqStr} · ${meta.observerName} · ${dateStr}`,
    "rc-head");

  // Readouts. Swing and max Doppler rate are defined only when Doppler was
  // sampled at all; max angular rate is frequency-independent and always
  // shown (spec §8).
  const swingStr = summary.dopplerPeakToPeakHz != null
    ? `swing ${(summary.dopplerPeakToPeakHz / 1000).toFixed(2)} kHz horizon-to-horizon · `
    : "";
  const maxRateStr = hasFreq
    ? `max rate ${summary.maxDopplerRateHzPerSec.toFixed(0)} Hz/s · `
    : "";
  push(
    (meta.downlinkLabel ? `${meta.downlinkLabel} (${meta.duty ?? "unknown duty"}) · ` : "") +
    `${swingStr}` +
    `${maxRateStr}` +
    `max ang. rate ${summary.maxAngRateDegPerSec.toFixed(2)} deg/s · ` +
    `closest ${(summary.closestRangeM / 1000).toFixed(1)} km` +
    (hasWorkable ? ` · shaded band is above ${meta.minElevDeg}°` : "") +
    // Guarded on the band actually being drawn, not on one endpoint, and
    // worded so it stands alone: with no elevation threshold the joint
    // window is the only band and has nothing to be "inner" to.
    (hasJoint ? " · brighter band is all observers" : ""),
    "rc-label");

  // Doppler at reference elevations (10°, 30°, TCA) - spec §8: these are
  // measurable from a partial capture (the ISS repeater only transmits
  // while someone is uplinking, so a real recording often lacks the
  // AOS/LOS extremes peak-to-peak needs), while peak-to-peak is not. A
  // null leg means the pass never crossed that elevation on that side of
  // TCA. Skipped entirely with no frequency set - dopplerAtElevation is
  // all-null in that case anyway.
  if (hasFreq) {
    const elev = summary.dopplerAtElevation ?? {};
    const parts = [];
    for (const deg of [10, 30]) {
      const e = elev[deg] ?? { rise: null, set: null };
      const legs = [];
      if (e.rise != null) legs.push(`rise ${fmtDopplerLeg(e.rise)}`);
      if (e.set != null) legs.push(`set ${fmtDopplerLeg(e.set)}`);
      if (legs.length) parts.push(`${deg}° ${legs.join(", ")}`);
    }
    if (elev.tca != null) parts.push(`TCA ${fmtDopplerLeg(elev.tca)}`);
    if (parts.length) push(parts.join(" · "), "rc-label");
  }

  headLines.forEach((h, i) => svg.appendChild(
    el("text", { x: X0, y: 12 + i * 7, class: h.cls }, h.text)));
  const Y0 = 12 + headLines.length * 7 + 4;

  // Degrade path (spec §15): with no frequency set, the Doppler panel has
  // nothing to show, so swap it for range rate (already on every sample)
  // rather than drawing an empty panel asserting a flat zero.
  const panels = panelsFor(hasFreq);

  // Joint (multi-observer) window, shaded behind the traces (spec §4.1).
  // Omitted for a single observer, where it coincides with the chart span.
  const jx0 = hasJoint ? Math.max(X0, xOf(meta.jointStartMs)) : 0;
  const jx1 = hasJoint ? Math.min(X0 + W, xOf(meta.jointEndMs)) : 0;

  // The minimum-elevation threshold, drawn rather than enforced.
  const wx0 = hasWorkable ? Math.max(X0, xOf(meta.workableStartMs)) : 0;
  const wx1 = hasWorkable ? Math.min(X0 + W, xOf(meta.workableEndMs)) : 0;

  panels.forEach((panel, i) => {
    const top = Y0 + i * (H + GAP);
    const g = el("g", { "data-layer": panel.key });
    g.appendChild(el("rect", { x: X0, y: top, width: W, height: H, class: "rc-bg" }));
    if (hasJoint && jx1 > jx0) {
      g.appendChild(el("rect", { x: jx0, y: top, width: jx1 - jx0, height: H, class: "rc-joint" }));
    }
    // Mark the region above the elevation threshold, and rule its edges.
    if (hasWorkable && wx1 > wx0) {
      g.appendChild(el("rect", { x: wx0, y: top, width: wx1 - wx0, height: H,
        class: "rc-workable" }));
      if (wx0 > X0) {
        g.appendChild(el("line", { x1: wx0, y1: top, x2: wx0, y2: top + H, class: "rc-edge" }));
      }
      if (wx1 < X0 + W) {
        g.appendChild(el("line", { x1: wx1, y1: top, x2: wx1, y2: top + H, class: "rc-edge" }));
      }
    }

    const vals = samples.map((s) => (s[panel.key] ?? 0) * panel.scale);
    const yOf = panelScale(vals, H);
    const zeroY = top + yOf(0);
    g.appendChild(el("line", { x1: X0, y1: zeroY, x2: X0 + W, y2: zeroY, class: "rc-zero" }));

    const pts = samples
      .map((s, j) => (s[panel.key] == null ? null : `${xOf(s.tMs)},${top + yOf(vals[j])}`))
      .filter(Boolean).join(" ");
    if (pts) g.appendChild(el("polyline", { points: pts, class: "rc-trace" }));

    g.appendChild(el("text", { x: X0, y: top - 3, class: "rc-panel" },
      `${panel.label} (${panel.unit})`));

    // Y-axis grid + scale. Gridlines are drawn before the trace so the
    // curve reads on top of them; the zero rule keeps its own brighter
    // stroke and is not redrawn as a gridline.
    for (const tv of axisTicks(yOf.lo, yOf.hi)) {
      const ty = top + yOf(tv);
      const atEdge = Math.abs(ty - top) < 0.05 || Math.abs(ty - (top + H)) < 0.05;
      if (tv !== 0 && !atEdge) {
        g.appendChild(el("line", { x1: X0, y1: ty, x2: X0 + W, y2: ty, class: "rc-grid" }));
      }
      // Nudge edge labels inward so they sit against the panel rather than
      // straddling its border.
      const ly = Math.abs(ty - top) < 0.05 ? ty + 2.4
        : Math.abs(ty - (top + H)) < 0.05 ? ty - 0.4
        : ty + 1;
      g.appendChild(el("text", { x: X0 - 3, y: ly, class: "rc-tick",
        "text-anchor": "end" }, fmtTick(tv)));
    }
    // One shared TCA rule per panel: Doppler crosses zero, angular rate and
    // signal both peak, all on the same instant.
    const tx = xOf(summary.tcaMs);
    g.appendChild(el("line", { x1: tx, y1: top, x2: tx, y2: top + H, class: "rc-tca" }));
    svg.appendChild(g);
  });

  const axisY = Y0 + (panels.length - 1) * (H + GAP) + H + 7;
  const ticks = timeTicks(t0, t1, 5);
  // First tick anchors to its start and last to its end: centring them
  // pushes the first label left into the axis-name gutter and the last
  // past the plot's right edge.
  const tickAnchor = (i) =>
    i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle";
  ticks.forEach((ms, i) => {
    const label = new Date(ms).toISOString().slice(11, 19);
    svg.appendChild(el("text", { x: xOf(ms), y: axisY, class: "rc-label",
      "text-anchor": tickAnchor(i) }, label));
  });
  svg.appendChild(el("text", { x: X0 - 5, y: axisY, class: "rc-axis",
    "text-anchor": "end" }, "UTC"));

  // Second axis row: observer-local time (spec §15). Degrades gracefully
  // when meta.tz is absent or unrecognized - formatLocalTime returns null
  // and the row is simply skipped.
  const localLabels = ticks.map((ms) => formatLocalTime(ms, meta.tz));
  const hasLocalRow = localLabels.every((l) => l != null);
  let bottomY = axisY;
  if (hasLocalRow) {
    const localY = axisY + 5;
    ticks.forEach((ms, i) => {
      svg.appendChild(el("text", { x: xOf(ms), y: localY, class: "rc-label",
        "text-anchor": tickAnchor(i) }, localLabels[i]));
    });
    // Short abbreviation, not the IANA identifier: "CDT" fits the gutter and
    // is what a reader checking a capture actually wants.
    const abbr = formatZoneAbbr(t0, meta.tz) ?? meta.tz;
    svg.appendChild(el("text", { x: X0 - 5, y: localY, class: "rc-axis",
      "text-anchor": "end" }, abbr));
    bottomY = localY;
  }

  const methods = el("g", { "data-layer": "methods" });
  const elevNote =
    `Observer elevation ${meta.elevM ?? 0} m (${meta.elevSource ?? "default"}), orthometric.`;
  const prose = hasFreq
    ? `Predicted — verify against your capture. Only the SHAPE is comparable: the ` +
      `transmitter's oscillator offset is unknown and constant ` +
      `(~±${txOscTolerance(meta.freqHz) ?? "unknown"}, assuming ${TX_OSC_PPM} ppm), ` +
      `so measure the null as the MIDPOINT of the swing, not as a crossing of ` +
      `${(meta.freqHz / 1e6).toFixed(3)} MHz. Signal is free-space path loss only (peak ` +
      `${summary.absoluteFsplDb?.toFixed(1) ?? "n/a"} dB), an envelope valid for circular ` +
      `polarization — Faraday rotation causes deep VHF nulls. ${elevNote}`
    : `Predicted — verify against your capture. No downlink frequency is set, so Doppler is ` +
      `not shown; angular rate and signal are frequency-independent. Signal is free-space ` +
      `path loss only, shown as a relative envelope valid for circular polarization — ` +
      `Faraday rotation causes deep VHF nulls. ${elevNote}`;
  const notes = wrapText(prose, methBudget);
  notes.forEach((line, i) => methods.appendChild(
    el("text", { x: X0, y: bottomY + 9 + i * 4.0, class: "rc-meth" }, line)));
  svg.appendChild(methods);

  const contentBottom = bottomY + 9 + (notes.length - 1) * 4.0;
  const canvasH = Math.ceil(contentBottom + 6);
  canvas.setAttribute("height", String(canvasH));
  svg.setAttribute("viewBox", `0 0 320 ${canvasH}`);
}
