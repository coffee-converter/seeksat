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
  return (v) => height - ((v - lo) / span) * height;
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
  .rc-zero   { stroke: rgba(126, 184, 255, 0.45); stroke-width: 0.35; }
  .rc-trace  { fill: none; stroke: #7eb8ff; stroke-width: 1.1; stroke-linejoin: round; }
  .rc-tca    { stroke: #ffb454; stroke-width: 0.5; stroke-dasharray: 2 1.5; }
  .rc-label  { fill: #8aa0c8; font-size: 3.2px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .rc-head   { fill: #b8c4dc; font-size: 4.4px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .rc-meth   { fill: #6a7a9a; font-size: 2.4px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
`;

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
 *  duty, tz, elevM, elevSource. */
export function paintRadioChart(svg, series, meta) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.appendChild(el("style", {}, CHART_STYLE));

  const { samples, summary } = series;
  if (!samples.length) return;
  const t0 = samples[0].tMs, t1 = samples[samples.length - 1].tMs;
  const span = Math.max(1, t1 - t0);
  const X0 = 34, W = 268, H = 44, GAP = 10;
  const xOf = (ms) => X0 + ((ms - t0) / span) * W;
  const hasFreq = !!meta.freqHz;

  // Title line - frequency segment is only meaningful when a downlink is
  // actually selected (Task 8 lets the picker go empty).
  const freqStr = hasFreq ? ` · ${(meta.freqHz / 1e6).toFixed(3)} MHz` : "";
  svg.appendChild(el("text", { x: X0, y: 12, class: "rc-head" },
    `${meta.satelliteName}${freqStr} · ${meta.observerName}`));

  // Swing/rate/closest line - swing is only defined when Doppler was
  // sampled at all (dopplerPeakToPeakHz is null with no frequency set).
  const swingStr = summary.dopplerPeakToPeakHz != null
    ? `swing ${(summary.dopplerPeakToPeakHz / 1000).toFixed(2)} kHz · `
    : "";
  svg.appendChild(el("text", { x: X0, y: 19, class: "rc-label" },
    `${meta.downlinkLabel ?? ""} (${meta.duty ?? "unknown"}) · ` +
    `${swingStr}` +
    `max rate ${summary.maxDopplerRateHzPerSec.toFixed(0)} Hz/s · ` +
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
    const e10 = elev[10] ?? { rise: null, set: null };
    const e30 = elev[30] ?? { rise: null, set: null };
    svg.appendChild(el("text", { x: X0, y: 26, class: "rc-label" },
      `10°  rise ${fmtDopplerLeg(e10.rise)} / set ${fmtDopplerLeg(e10.set)}` +
      `      30°  rise ${fmtDopplerLeg(e30.rise)} / set ${fmtDopplerLeg(e30.set)}` +
      `      TCA ${fmtDopplerLeg(elev.tca)}`));
    headerLines = 3;
  }
  const Y0 = 12 + headerLines * 7 + 4;

  PANELS.forEach((panel, i) => {
    const top = Y0 + i * (H + GAP);
    const g = el("g", { "data-layer": panel.key });
    g.appendChild(el("rect", { x: X0, y: top, width: W, height: H, class: "rc-bg" }));

    const vals = samples.map((s) => (s[panel.key] ?? 0) * panel.scale);
    const yOf = panelScale(vals, H);
    const zeroY = top + yOf(0);
    g.appendChild(el("line", { x1: X0, y1: zeroY, x2: X0 + W, y2: zeroY, class: "rc-zero" }));

    const pts = samples
      .map((s, j) => (s[panel.key] == null ? null : `${xOf(s.tMs)},${top + yOf(vals[j])}`))
      .filter(Boolean).join(" ");
    if (pts) g.appendChild(el("polyline", { points: pts, class: "rc-trace" }));

    g.appendChild(el("text", { x: 4, y: top + 6, class: "rc-label" },
      `${panel.label} (${panel.unit})`));
    // One shared TCA rule per panel: Doppler crosses zero, angular rate and
    // signal both peak, all on the same instant.
    const tx = xOf(summary.tcaMs);
    g.appendChild(el("line", { x1: tx, y1: top, x2: tx, y2: top + H, class: "rc-tca" }));
    svg.appendChild(g);
  });

  const axisY = Y0 + PANELS.length * (H + GAP);
  for (const ms of timeTicks(t0, t1, 5)) {
    const label = new Date(ms).toISOString().slice(11, 19);
    svg.appendChild(el("text", { x: xOf(ms), y: axisY, class: "rc-label",
      "text-anchor": "middle" }, label));
  }
  svg.appendChild(el("text", { x: X0, y: axisY + 6, class: "rc-label" }, "UTC"));

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
    el("text", { x: X0, y: axisY + 14 + i * 3.4, class: "rc-meth" }, line)));
  svg.appendChild(methods);
}
