// lib/pass-finder/radio-chart.js - paints the radio-pass chart: three
// stacked panels (angular rate / Doppler / signal) on one shared time axis,
// with a single TCA rule through all three.
//
// CSS is embedded in the SVG so svgToPngBlob can rasterize it standalone,
// exactly as polar-modal-frame.js does. Module-level code never touches
// `document` - only paintRadioChart's body does - so this file imports
// cleanly under node for the pure helper tests below.

import { TX_OSC_PPM, txOscTolerance } from "./radio-format.js";
import { wrapText } from "./text.js";

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

// Doppler leads and is tallest: it is what an operator tunes by. Each panel
// has its own colour so the three read apart at a glance.
const PANELS = [
  { key: "dopplerHz",        label: "Doppler",   unit: "kHz",   scale: 1e-3, height: 62, cls: "dop" },
  { key: "relSignalDb",      label: "Signal",    unit: "dB",    scale: 1,    height: 30, cls: "sig" },
  { key: "angRateDegPerSec", label: "Ang. rate", unit: "deg/s", scale: 1,    height: 30, cls: "ang" },
];

const RANGE_RATE_PANEL =
  { key: "rangeRateMps", label: "Range rate", unit: "m/s", scale: 1, height: 62, cls: "dop" };

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

/** Where the pass crosses each elevation in `degs`, rising and setting, with
 *  time and Doppler interpolated between the straddling samples (the same
 *  linear rule radio-pass.js uses for its summary). Sorted by elevation, rise
 *  first. Needs Doppler: with no frequency there is nothing to mark. */
export function elevationMarks(samples, degs = [10, 30]) {
  const out = [];
  for (const deg of degs) {
    let rise = null, set = null;
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      if (a.dopplerHz == null || b.dopplerHz == null) continue;
      const up = a.elDeg < deg && b.elDeg >= deg;
      const down = a.elDeg >= deg && b.elDeg < deg;
      if (!(up && !rise) && !(down && !set)) continue;
      const f = b.elDeg === a.elDeg ? 0 : (deg - a.elDeg) / (b.elDeg - a.elDeg);
      const mark = { deg, leg: up ? "rise" : "set",
        tMs: a.tMs + f * (b.tMs - a.tMs), dopplerHz: a.dopplerHz + f * (b.dopplerHz - a.dopplerHz) };
      if (up) rise = mark; else set = mark;
    }
    if (rise) out.push(rise);
    if (set) out.push(set);
  }
  return out;
}

/** The headline numbers, as value and label pairs, most useful first. */
export function statTiles(series, meta) {
  const { samples, summary } = series;
  const maxEl = samples.reduce((m, s) => Math.max(m, s.elDeg ?? -90), -90);
  const tiles = [];
  if (meta.freqHz && summary.dopplerPeakToPeakHz != null) {
    tiles.push({ value: `${(summary.dopplerPeakToPeakHz / 1000).toFixed(2)} kHz`, label: "Doppler swing" });
    tiles.push({ value: `${summary.maxDopplerRateHzPerSec.toFixed(0)} Hz/s`, label: "max Doppler rate" });
  }
  tiles.push({ value: `${Math.round(maxEl)}°`, label: "max elevation" });
  tiles.push({ value: `${Math.round(summary.closestRangeM / 1000).toLocaleString("en-US")} km`, label: "closest range" });
  tiles.push({ value: `${summary.maxAngRateDegPerSec.toFixed(2)}°/s`, label: "max angular rate" });
  return tiles;
}

/** The receive frequency in MHz at a Doppler offset in kHz: three decimals,
 *  or four when the offset is not a whole kHz. */
export function tuneLabel(freqHz, offsetKhz) {
  const mhz = (freqHz + offsetKhz * 1000) / 1e6;
  return mhz.toFixed(Number.isInteger(Math.round(offsetKhz * 1000) / 1000) ? 3 : 4);
}

/** Type sizes, in viewBox units. Exported so the wrap budgets, the layout
 *  guard in test/radio-chart-layout.test.mjs, and the stylesheet below all
 *  read one value. */
export const FONT_PX = {
  "rc-title": 5.6,
  "rc-label": 3.0,
  "rc-head": 3.4,
  "rc-meth": 2.6,
  "rc-panel": 3.0,
  "rc-tick": 2.6,
  "rc-axis": 2.6,
  "rc-tile-v": 4.6,
  "rc-tile-l": 2.4,
  "rc-mark": 2.5,
};

const SANS = "-apple-system, BlinkMacSystemFont, sans-serif";

/** Average glyph advance as a fraction of font size, used to turn a pixel
 *  width into a character budget. Deliberately conservative: this copy
 *  measures nearer 0.45 em in Arimo, but the browser resolves whatever
 *  `sans-serif` means locally, and a DejaVu fallback runs ~8-10% wider. */
export const ADVANCE_EM = 0.6;

// Role colours: warm while the satellite approaches (Doppler above zero),
// cool as it recedes, teal for signal, violet for angular rate.
const C = { warm: "#ffb070", cool: "#7eb8ff", sig: "#7fe5d1", ang: "#c4a3ff" };

const CHART_STYLE = `
  /* Opaque canvas ground. Without it the exported PNG has a transparent
     background, which shows as white once the image is opened elsewhere. */
  .rc-canvas { fill: #0a0e1a; }
  .rc-bg     { fill: rgba(4, 8, 20, 0.95); stroke: rgba(126, 184, 255, 0.22); stroke-width: 0.3; }
  .rc-joint  { fill: rgba(126, 184, 255, 0.10); stroke: none; }
  /* Above the observer's minimum elevation: a faint light wash, since a dark
     one has no headroom on a near-black panel. */
  .rc-workable { fill: rgba(126, 184, 255, 0.055); stroke: none; }
  .rc-edge   { stroke: rgba(126, 184, 255, 0.30); stroke-width: 0.3; stroke-dasharray: 1 1.2; }
  .rc-zero   { stroke: rgba(200, 215, 240, 0.45); stroke-width: 0.35; }
  .rc-grid   { stroke: rgba(126, 184, 255, 0.10); stroke-width: 0.25; }
  .rc-trace  { fill: none; stroke-width: 1.1; stroke-linejoin: round; stroke-linecap: round; }
  .rc-tca    { stroke: rgba(255, 255, 255, 0.55); stroke-width: 0.4; stroke-dasharray: 1.5 1.2; }
  .rc-dot    { stroke: #0a0e1a; stroke-width: 0.5; }
  .rc-tile   { fill: rgba(126, 184, 255, 0.06); stroke: rgba(126, 184, 255, 0.18); stroke-width: 0.3; }
  .rc-title  { fill: #e6eeff; font-size: ${FONT_PX['rc-title']}px; font-weight: 700; font-family: ${SANS}; }
  .rc-head   { fill: #b8c4dc; font-size: ${FONT_PX['rc-head']}px; font-family: ${SANS}; }
  .rc-label  { fill: #8aa0c8; font-size: ${FONT_PX['rc-label']}px; font-family: ${SANS}; }
  .rc-meth   { fill: #6f80a0; font-size: ${FONT_PX['rc-meth']}px; font-family: ${SANS}; }
  .rc-tick   { fill: #7386a8; font-size: ${FONT_PX['rc-tick']}px; font-family: ${SANS}; font-variant-numeric: tabular-nums; }
  .rc-panel  { font-size: ${FONT_PX['rc-panel']}px; font-weight: 600; font-family: ${SANS}; }
  .rc-axis   { fill: #6a7a9a; font-size: ${FONT_PX['rc-axis']}px; font-family: ${SANS}; }
  .rc-tile-v { fill: #e6eeff; font-size: ${FONT_PX['rc-tile-v']}px; font-weight: 700; font-family: ${SANS}; font-variant-numeric: tabular-nums; }
  .rc-tile-l { fill: #8aa0c8; font-size: ${FONT_PX['rc-tile-l']}px; font-family: ${SANS}; letter-spacing: 0.04em; }
  .rc-mark   { font-size: ${FONT_PX['rc-mark']}px; font-family: ${SANS}; font-variant-numeric: tabular-nums;
               paint-order: stroke; stroke: #04081a; stroke-width: 0.9; stroke-linejoin: round; }
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

/** Paint the chart. `series` is the radioPassSamples result; `meta` carries
 *  satelliteName, observerName, freqHz, downlinkLabel, duty, tz, elevM,
 *  elevSource, minElevDeg, clamped, workableStartMs/workableEndMs and
 *  optionally jointStartMs/jointEndMs (the multi-observer joint window). */
export function paintRadioChart(svg, series, meta) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.appendChild(el("style", {}, CHART_STYLE));
  const canvas = el("rect", { x: 0, y: 0, width: 320, height: 0, class: "rc-canvas" });
  svg.appendChild(canvas);

  const { samples, summary } = series;
  if (!samples.length) {
    // Size the canvas before bailing, so an empty series is not transparent.
    canvas.setAttribute("height", "40");
    svg.setAttribute("viewBox", "0 0 320 40");
    return;
  }
  const t0 = samples[0].tMs, t1 = samples[samples.length - 1].tMs;
  const span = Math.max(1, t1 - t0);
  // Room on the right for the Doppler panel's tune-to axis.
  const X0 = 34, W = 250, GAP = 11;
  const budget = (cls) => Math.floor(W / (FONT_PX[cls] * ADVANCE_EM));
  const xOf = (ms) => X0 + ((ms - t0) / span) * W;
  const hasFreq = !!meta.freqHz;
  // Band flags, computed once: the caption and the rect must never disagree.
  const hasJoint = meta.jointStartMs != null && meta.jointEndMs != null;
  const hasWorkable = meta.workableStartMs != null && meta.workableEndMs != null;

  // Title: the satellite and frequency, then what it is and where from.
  let y = 10;
  const freqStr = hasFreq ? ` · ${(meta.freqHz / 1e6).toFixed(3)} MHz` : "";
  for (const l of wrapText(`${meta.satelliteName}${freqStr}`, budget("rc-title"))) {
    svg.appendChild(el("text", { x: X0, y, class: "rc-title" }, l));
    y += 6.4;
  }
  const dateStr = new Date(t0).toISOString().slice(0, 10);
  const sub = (meta.downlinkLabel ? `${meta.downlinkLabel} (${meta.duty ?? "unknown duty"}) · ` : "") +
    `${meta.observerName} · ${dateStr}`;
  for (const l of wrapText(sub, budget("rc-head"))) {
    svg.appendChild(el("text", { x: X0, y: y - 1, class: "rc-head" }, l));
    y += 4.4;
  }

  // Stat tiles, one row across the plot width.
  const tiles = statTiles(series, meta);
  const TG = 2.5, TH = 11;
  const tw = (W - TG * (tiles.length - 1)) / tiles.length;
  const ty = y + 1;
  tiles.forEach((t, i) => {
    const tx = X0 + i * (tw + TG);
    svg.appendChild(el("rect", { x: tx, y: ty, width: tw, height: TH, rx: 1.2, class: "rc-tile" }));
    svg.appendChild(el("text", { x: tx + 2.2, y: ty + 5.6, class: "rc-tile-v" }, t.value));
    svg.appendChild(el("text", { x: tx + 2.2, y: ty + 9.2, class: "rc-tile-l" }, t.label.toUpperCase()));
  });
  y = ty + TH + 5;

  // One caption line for what the tiles and bands mean.
  const caption =
    (summary.dopplerPeakToPeakHz != null
      ? (meta.clamped
        ? "WINDOW TRUNCATED at the search cap: rates, swing and duration are lower bounds, closest range an upper one. "
        : "Swing is horizon-to-horizon. ")
      : (meta.clamped ? "WINDOW TRUNCATED at the search cap: rates and duration are lower bounds, closest range an upper one. " : "")) +
    (hasWorkable ? `Shaded: above ${meta.minElevDeg}°. ` : "") +
    (hasJoint ? "Brighter: every observer can hear it. " : "") +
    (hasFreq ? "Dots: Doppler at 10° and 30° up." : "");
  for (const l of wrapText(caption.trim(), budget("rc-label"))) {
    svg.appendChild(el("text", { x: X0, y, class: "rc-label" }, l));
    y += 4;
  }
  const Y0 = y + 6;

  const panels = panelsFor(hasFreq);
  const jx0 = hasJoint ? Math.max(X0, xOf(meta.jointStartMs)) : 0;
  const jx1 = hasJoint ? Math.min(X0 + W, xOf(meta.jointEndMs)) : 0;
  const wx0 = hasWorkable ? Math.max(X0, xOf(meta.workableStartMs)) : 0;
  const wx1 = hasWorkable ? Math.min(X0 + W, xOf(meta.workableEndMs)) : 0;
  const tcaX = xOf(summary.tcaMs);

  let top = Y0;
  panels.forEach((panel, i) => {
    const H = panel.height;
    const g = el("g", { "data-layer": panel.key });
    const clipId = `rc-clip-${panel.key}`;
    const defs = el("defs", {});
    const clip = el("clipPath", { id: clipId });
    clip.appendChild(el("rect", { x: X0, y: top, width: W, height: H }));
    defs.appendChild(clip);
    g.appendChild(defs);
    g.appendChild(el("rect", { x: X0, y: top, width: W, height: H, rx: 1, class: "rc-bg" }));
    if (hasJoint && jx1 > jx0) {
      g.appendChild(el("rect", { x: jx0, y: top, width: jx1 - jx0, height: H, class: "rc-joint" }));
    }
    if (hasWorkable && wx1 > wx0) {
      g.appendChild(el("rect", { x: wx0, y: top, width: wx1 - wx0, height: H, class: "rc-workable" }));
      if (wx0 > X0) g.appendChild(el("line", { x1: wx0, y1: top, x2: wx0, y2: top + H, class: "rc-edge" }));
      if (wx1 < X0 + W) g.appendChild(el("line", { x1: wx1, y1: top, x2: wx1, y2: top + H, class: "rc-edge" }));
    }

    const vals = samples.map((s) => (s[panel.key] ?? 0) * panel.scale);
    const yOf = panelScale(vals, H);
    const zeroY = top + yOf(0);
    const ticks = axisTicks(yOf.lo, yOf.hi, H > 40 ? 5 : 3);
    for (const tv of ticks) {
      const gy = top + yOf(tv);
      const atEdge = Math.abs(gy - top) < 0.05 || Math.abs(gy - (top + H)) < 0.05;
      if (tv !== 0 && !atEdge) g.appendChild(el("line", { x1: X0, y1: gy, x2: X0 + W, y2: gy, class: "rc-grid" }));
      const ly = Math.abs(gy - top) < 0.05 ? gy + 2.4 : Math.abs(gy - (top + H)) < 0.05 ? gy - 0.4 : gy + 0.9;
      g.appendChild(el("text", { x: X0 - 2.5, y: ly, class: "rc-tick", "text-anchor": "end" }, fmtTick(tv)));
      // The Doppler panel's right axis: the frequency to tune to.
      if (panel.key === "dopplerHz") {
        g.appendChild(el("text", { x: X0 + W + 2.5, y: ly, class: "rc-tick" }, tuneLabel(meta.freqHz, tv)));
      }
    }
    g.appendChild(el("line", { x1: X0, y1: zeroY, x2: X0 + W, y2: zeroY, class: "rc-zero" }));

    const pts = samples
      .map((s, j) => (s[panel.key] == null ? null : [xOf(s.tMs), top + yOf(vals[j])]))
      .filter(Boolean);
    if (pts.length) {
      const line = pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
      if (panel.cls === "dop") {
        // Above zero (approaching) warm, below (receding) cool: the same
        // curve painted twice, each copy clipped to its half.
        // Range rate has the opposite sign: above zero it is moving away.
        const dop = panel.key === "dopplerHz";
        const halves = [
          { id: `${clipId}-up`, y: top, h: zeroY - top, color: dop ? C.warm : C.cool },
          { id: `${clipId}-dn`, y: zeroY, h: top + H - zeroY, color: dop ? C.cool : C.warm },
        ];
        for (const half of halves) {
          if (!(half.h > 0)) continue;
          const c = el("clipPath", { id: half.id });
          c.appendChild(el("rect", { x: X0, y: half.y, width: W, height: half.h }));
          defs.appendChild(c);
          const area = `${pts[0][0].toFixed(2)},${zeroY.toFixed(2)} ${line} ${pts[pts.length - 1][0].toFixed(2)},${zeroY.toFixed(2)}`;
          const hg = el("g", { "clip-path": `url(#${half.id})` });
          hg.appendChild(el("polygon", { points: area, fill: half.color, "fill-opacity": 0.16 }));
          hg.appendChild(el("polyline", { points: line, class: "rc-trace", stroke: half.color }));
          g.appendChild(hg);
        }
        if (hasFreq) {
          // Beside the zero rule at the far edges, where the curve is at its
          // extremes and never near zero.
          g.appendChild(el("text", { x: X0 + 2, y: zeroY - 1.4, class: "rc-mark", fill: C.warm }, "approaching"));
          g.appendChild(el("text", { x: X0 + W - 2, y: zeroY + 3.4, class: "rc-mark", fill: C.cool, "text-anchor": "end" }, "receding"));
        }
      } else {
        const color = panel.cls === "sig" ? C.sig : C.ang;
        const base = top + H;
        const area = `${pts[0][0].toFixed(2)},${base} ${line} ${pts[pts.length - 1][0].toFixed(2)},${base}`;
        const hg = el("g", { "clip-path": `url(#${clipId})` });
        hg.appendChild(el("polygon", { points: area, fill: color, "fill-opacity": 0.12 }));
        hg.appendChild(el("polyline", { points: line, class: "rc-trace", stroke: color }));
        g.appendChild(hg);
      }
    }

    const color = panel.cls === "dop" ? (hasFreq ? C.warm : C.cool) : panel.cls === "sig" ? C.sig : C.ang;
    g.appendChild(el("text", { x: X0, y: top - 2, class: "rc-panel", fill: color }, `${panel.label} (${panel.unit})`));
    if (panel.key === "dopplerHz") {
      g.appendChild(el("text", { x: X0 + W + 2.5, y: top - 2, class: "rc-axis" }, "Tune (MHz)"));
    }

    // One TCA rule through every panel: Doppler crosses zero, angular rate
    // and signal both peak, all at the same instant.
    g.appendChild(el("line", { x1: tcaX, y1: top, x2: tcaX, y2: top + H, class: "rc-tca" }));
    if (i === 0) {
      g.appendChild(el("text", { x: tcaX, y: top - 2, class: "rc-mark", fill: "#e6eeff", "text-anchor": "middle" }, "TCA"));
    }

    // Doppler at 10 and 30 degrees, rising and setting, on the curve itself.
    if (panel.key === "dopplerHz") {
      for (const m of elevationMarks(samples)) {
        const mx = xOf(m.tMs), my = top + yOf(m.dopplerHz / 1000);
        const c = m.dopplerHz >= 0 ? C.warm : C.cool;
        g.appendChild(el("circle", { cx: mx, cy: my, r: 1.1, fill: c, class: "rc-dot" }));
        // The curve falls left to right, so below-left of a rising mark and
        // above-right of a setting one are clear of it.
        // Near an edge, the label flips inward rather than run into an axis.
        const text = `${m.deg}° ${fmtDopplerLeg(m.dopplerHz)}`;
        const tw = text.length * FONT_PX["rc-mark"] * ADVANCE_EM;
        let left = m.leg === "rise";
        if (left && mx - 1.8 - tw < X0) left = false;
        else if (!left && mx + 1.8 + tw > X0 + W) left = true;
        g.appendChild(el("text", {
          x: mx + (left ? -1.8 : 1.8), y: my + (m.leg === "rise" ? 3.8 : -2),
          class: "rc-mark", fill: c, "text-anchor": left ? "end" : "start",
        }, text));
      }
    }
    svg.appendChild(g);
    top += H + GAP;
  });

  const axisY = top - GAP + 5.5;
  const ticks = timeTicks(t0, t1, 5);
  const tickAnchor = (i) => (i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle");
  ticks.forEach((ms, i) => {
    svg.appendChild(el("text", { x: xOf(ms), y: axisY, class: "rc-tick", "text-anchor": tickAnchor(i) },
      new Date(ms).toISOString().slice(11, 19)));
  });
  svg.appendChild(el("text", { x: X0 - 2.5, y: axisY, class: "rc-axis", "text-anchor": "end" }, "UTC"));

  // Second axis row: observer-local time (spec §15), skipped without a zone.
  const localLabels = ticks.map((ms) => formatLocalTime(ms, meta.tz));
  let bottomY = axisY;
  if (localLabels.every((l) => l != null)) {
    const localY = axisY + 4;
    ticks.forEach((ms, i) => {
      svg.appendChild(el("text", { x: xOf(ms), y: localY, class: "rc-tick", "text-anchor": tickAnchor(i) }, localLabels[i]));
    });
    svg.appendChild(el("text", { x: X0 - 2.5, y: localY, class: "rc-axis", "text-anchor": "end" },
      formatZoneAbbr(t0, meta.tz) ?? meta.tz));
    bottomY = localY;
  }

  const methods = el("g", { "data-layer": "methods" });
  // Datum stated rather than absorbed (spec 12): geodeticToEcef consumes an
  // ellipsoidal height, so the undulation is uncorrected.
  const elevNote =
    `Observer elevation ${meta.elevM ?? 0} m (${meta.elevSource ?? "default"}), ` +
    `used as ellipsoidal; a looked-up value is orthometric, leaving the geoid ` +
    `undulation (±100 m) uncorrected, under 0.5 Hz.`;
  const prose = hasFreq
    ? `Predicted; verify against your capture. Only the SHAPE is comparable: the ` +
      `transmitter's oscillator offset is unknown and constant ` +
      `(~±${txOscTolerance(meta.freqHz) ?? "unknown"}, assuming ${TX_OSC_PPM} ppm), ` +
      `so measure the null as the MIDPOINT of the swing, not as a crossing of ` +
      `${(meta.freqHz / 1e6).toFixed(3)} MHz. Signal is free-space path loss only (peak ` +
      `${summary.absoluteFsplDb?.toFixed(1) ?? "n/a"} dB), an envelope valid for circular ` +
      `polarization; Faraday rotation causes deep VHF nulls. ${elevNote}`
    : `Predicted; verify against your capture. No downlink frequency is set, so Doppler is ` +
      `not shown; angular rate and signal are frequency-independent. Signal is free-space ` +
      `path loss only, shown as a relative envelope valid for circular polarization; ` +
      `Faraday rotation causes deep VHF nulls. ${elevNote}`;
  const notes = wrapText(prose, budget("rc-meth"));
  notes.forEach((line, i) => methods.appendChild(
    el("text", { x: X0, y: bottomY + 7 + i * 3.6, class: "rc-meth" }, line)));
  svg.appendChild(methods);

  const canvasH = Math.ceil(bottomY + 7 + (notes.length - 1) * 3.6 + 5);
  canvas.setAttribute("height", String(canvasH));
  svg.setAttribute("viewBox", `0 0 320 ${canvasH}`);
}
