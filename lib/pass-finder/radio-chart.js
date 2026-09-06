// lib/pass-finder/radio-chart.js - paints the radio-pass chart: three
// stacked panels (Doppler / angular rate / signal) on one shared time axis,
// with a single TCA rule through all three.
//
// CSS is embedded in the SVG so svgToPngBlob can rasterize it standalone,
// exactly as polar-modal-frame.js does. Module-level code never touches
// `document` - only paintRadioChart's body does - so this file imports
// cleanly under node for the pure helper tests below.

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
  { key: "dopplerHz",        label: "Doppler",   unit: "kHz",   scale: 1e-3 },
  { key: "angRateDegPerSec", label: "Ang. rate",  unit: "deg/s", scale: 1 },
  { key: "relSignalDb",      label: "Signal",    unit: "dB",    scale: 1 },
];

const CHART_STYLE = `
  .rc-bg     { fill: rgba(4, 8, 20, 0.95); stroke: rgba(126, 184, 255, 0.35); stroke-width: 0.4; }
  .rc-joint  { fill: rgba(126, 184, 255, 0.10); stroke: none; }
  .rc-zero   { stroke: rgba(126, 184, 255, 0.45); stroke-width: 0.35; }
  .rc-trace  { fill: none; stroke: #7eb8ff; stroke-width: 1.1; stroke-linejoin: round; }
  .rc-tca    { stroke: #ffb454; stroke-width: 0.5; stroke-dasharray: 2 1.5; }
  .rc-label  { fill: #8aa0c8; font-size: 3.2px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .rc-head   { fill: #b8c4dc; font-size: 4.4px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .rc-meth   { fill: #6a7a9a; font-size: 2.4px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  /* Axis numbers sit between label and methods in the type scale so they
     read as instrument scale rather than prose. */
  .rc-tick   { fill: #7386a8; font-size: 2.7px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .rc-panel  { fill: #9fb3d4; font-size: 3.0px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .rc-axis   { fill: #6a7a9a; font-size: 2.7px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
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

  const { samples, summary } = series;
  if (!samples.length) return;
  const t0 = samples[0].tMs, t1 = samples[samples.length - 1].tMs;
  const span = Math.max(1, t1 - t0);
  const X0 = 42, W = 270, H = 46, GAP = 16;
  const xOf = (ms) => X0 + ((ms - t0) / span) * W;
  const hasFreq = !!meta.freqHz;

  // Title line - frequency segment is only meaningful when a downlink is
  // actually selected (Task 8 lets the picker go empty). Date is the UTC
  // calendar date of the pass, since nothing else on the chart says which
  // day this is.
  const freqStr = hasFreq ? ` · ${(meta.freqHz / 1e6).toFixed(3)} MHz` : "";
  const dateStr = new Date(t0).toISOString().slice(0, 10);
  svg.appendChild(el("text", { x: X0, y: 12, class: "rc-head" },
    `${meta.satelliteName}${freqStr} · ${meta.observerName} · ${dateStr}`));

  // Swing/rate/closest line - swing and max Doppler rate are only defined
  // when Doppler was sampled at all (both null with no frequency set).
  // Max angular rate is frequency-independent and always shown (spec §8).
  const swingStr = summary.dopplerPeakToPeakHz != null
    ? `swing ${(summary.dopplerPeakToPeakHz / 1000).toFixed(2)} kHz · `
    : "";
  const maxRateStr = hasFreq
    ? `max rate ${summary.maxDopplerRateHzPerSec.toFixed(0)} Hz/s · `
    : "";
  svg.appendChild(el("text", { x: X0, y: 19, class: "rc-label" },
    `${meta.downlinkLabel ?? ""} (${meta.duty ?? "unknown"}) · ` +
    `${swingStr}` +
    `${maxRateStr}` +
    `max ang. rate ${summary.maxAngRateDegPerSec.toFixed(2)} deg/s · ` +
    `closest ${(summary.closestRangeM / 1000).toFixed(1)} km`));

  // Doppler at reference elevations (10°, 30°, TCA) - spec §8: these are
  // measurable from a partial capture (the ISS repeater only transmits
  // while someone is uplinking, so a real recording often lacks the
  // AOS/LOS extremes peak-to-peak needs), while peak-to-peak is not. A
  // null leg means the pass never crossed that elevation on that side of
  // TCA. Skipped entirely with no frequency set - dopplerAtElevation is
  // all-null in that case anyway.
  let headerLines = 2;
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
    if (parts.length) {
      svg.appendChild(el("text", { x: X0, y: 26, class: "rc-label" },
        parts.join("   ·   ")));
      headerLines = 3;
    }
  }
  const Y0 = 12 + headerLines * 7 + 4;

  // Degrade path (spec §15): with no frequency set, the Doppler panel has
  // nothing to show, so swap it for range rate (already on every sample)
  // rather than drawing an empty panel asserting a flat zero.
  const panels = hasFreq
    ? PANELS
    : [{ key: "rangeRateMps", label: "Range rate", unit: "m/s", scale: 1 }, PANELS[1], PANELS[2]];

  // Joint (multi-observer) window, shaded behind the traces (spec §4.1).
  // Omitted for a single observer, where it coincides with the chart span.
  const hasJoint = meta.jointStartMs != null && meta.jointEndMs != null;
  const jx0 = hasJoint ? Math.max(X0, xOf(meta.jointStartMs)) : 0;
  const jx1 = hasJoint ? Math.min(X0 + W, xOf(meta.jointEndMs)) : 0;

  panels.forEach((panel, i) => {
    const top = Y0 + i * (H + GAP);
    const g = el("g", { "data-layer": panel.key });
    g.appendChild(el("rect", { x: X0, y: top, width: W, height: H, class: "rc-bg" }));
    if (hasJoint && jx1 > jx0) {
      g.appendChild(el("rect", { x: jx0, y: top, width: jx1 - jx0, height: H, class: "rc-joint" }));
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

    // Y-axis scale: top, bottom, and zero when the range straddles it. The
    // existing zero rule doubles as the middle gridline, so no extra
    // hairlines are drawn - the panel border already bounds top and bottom.
    g.appendChild(el("text", { x: X0 - 3, y: top + 2.4, class: "rc-tick",
      "text-anchor": "end" }, fmtTick(yOf.hi)));
    g.appendChild(el("text", { x: X0 - 3, y: top + H - 0.4, class: "rc-tick",
      "text-anchor": "end" }, fmtTick(yOf.lo)));
    if (yOf.lo < 0 && yOf.hi > 0) {
      g.appendChild(el("text", { x: X0 - 3, y: zeroY + 1, class: "rc-tick",
        "text-anchor": "end" }, "0"));
    }
    // One shared TCA rule per panel: Doppler crosses zero, angular rate and
    // signal both peak, all on the same instant.
    const tx = xOf(summary.tcaMs);
    g.appendChild(el("line", { x1: tx, y1: top, x2: tx, y2: top + H, class: "rc-tca" }));
    svg.appendChild(g);
  });

  const axisY = Y0 + panels.length * (H + GAP);
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
  const notes = hasFreq
    ? [
        `Predicted — verify against your capture. Only the SHAPE is comparable:`,
        `the transmitter's oscillator offset is unknown and constant (~±1.1 kHz),`,
        `so measure the null as the MIDPOINT of the swing, not as a crossing of ${(meta.freqHz / 1e6).toFixed(3)} MHz.`,
        `Signal is free-space path loss only (peak ${summary.absoluteFsplDb?.toFixed(1) ?? "n/a"} dB);`,
        `an envelope valid for circular polarization — Faraday rotation causes deep VHF nulls.`,
        `Observer elevation ${meta.elevM ?? 0} m (${meta.elevSource ?? "default"}), orthometric.`,
      ]
    : [
        `Predicted — verify against your capture. No downlink frequency is set,`,
        `so Doppler is not shown; angular rate and signal are frequency-independent.`,
        `Signal is free-space path loss only, shown as a relative envelope;`,
        `an envelope valid for circular polarization — Faraday rotation causes deep VHF nulls.`,
        `Observer elevation ${meta.elevM ?? 0} m (${meta.elevSource ?? "default"}), orthometric.`,
      ];
  notes.forEach((line, i) => methods.appendChild(
    el("text", { x: X0, y: bottomY + 8 + i * 3.4, class: "rc-meth" }, line)));
  svg.appendChild(methods);

  const contentBottom = bottomY + 8 + (notes.length - 1) * 3.4;
  svg.setAttribute("viewBox", `0 0 320 ${Math.ceil(contentBottom + 6)}`);
}
