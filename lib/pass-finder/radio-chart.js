// lib/pass-finder/radio-chart.js - paints the radio-pass chart: stacked
// panels (tune / transmit / elevation and direction / angular rate) on one
// shared time axis, with a single TCA rule through all of them.
//
// CSS is embedded in the SVG so svgToPngBlob can rasterize it standalone,
// exactly as polar-modal-frame.js does. Module-level code never touches
// `document` - only paintRadioChart's body does - so this file imports
// cleanly under node for the pure helper tests below.

import { TX_OSC_PPM, txOscTolerance } from "./radio-format.js";
import { wrapText } from "./text.js";
import { uplinkDopplerHz } from "../radio/uplink.mjs";
import { ATKINSON_FONT_FACE, ATKINSON_STACK } from "./atkinson-embed.js";
import { CHART_CANVAS } from "./chart-canvas.js";
import { BRAND_LINE_GAP, BRAND_PX, BRAND_STYLE, EXO2_FONT_FACE, paintBrandMark } from "./brand-mark.js";

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
  if (a >= 0.1) return v.toFixed(2);
  // Slow rates (a geosynchronous satellite turns thousandths of a degree a
  // second): two significant figures rather than a column of 0.00.
  return String(Number(v.toPrecision(2)));
}

/** A rate for a stat tile: whole units when large, else two significant figures. */
function fmtRate(v, whole) {
  if (!Number.isFinite(v)) return "n/a";
  return Math.abs(v) >= whole ? v.toFixed(0) : String(Number(v.toPrecision(2)));
}

/** A Doppler shift tick: "+2.9", "-2.9" or "0". */
const signedTick = (v) => (v > 0 ? `+${fmtTick(v)}` : fmtTick(v));

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

// Doppler leads and is tallest: it is what an operator tunes by. Then where
// to transmit (a link with an uplink), where to point (elevation, with the
// compass direction along it) and how fast to turn. Each panel has its own
// colour so they read apart at a glance.
const PANELS = [
  { key: "dopplerHz",        label: "Doppler",   unit: "kHz",   scale: 1e-3, height: 62, cls: "dop" },
  { key: "uplinkDopplerHz",  label: "Transmit",  unit: "kHz",   scale: 1e-3, height: 34, cls: "up" },
  { key: "elDeg",            label: "Elevation", unit: "°",     scale: 1,    height: 30, cls: "el" },
  { key: "angRateDegPerSec", label: "Ang. rate", unit: "deg/s", scale: 1,    height: 24, cls: "ang" },
];

const RANGE_RATE_PANEL =
  { key: "rangeRateMps", label: "Range rate", unit: "m/s", scale: 1, height: 62, cls: "dop" };

/** The panel set to draw. With no downlink frequency selected the Doppler
 *  panel has nothing to show, so it is replaced by range rate (already on
 *  every sample) rather than drawn empty asserting a flat zero - spec §15.
 *
 *  The substitution matches on key, not position: keying it off an index
 *  silently swaps the wrong panel the moment PANELS is reordered. */
export function panelsFor(hasFreq, hasUplink = false) {
  const shown = PANELS.filter((p) => p.key !== "uplinkDopplerHz" || (hasFreq && hasUplink));
  return hasFreq
    ? shown
    : shown.map((p) => (p.key === "dopplerHz" ? RANGE_RATE_PANEL : p));
}

/** 16-point compass name for an azimuth in degrees. */
export function compassPoint(azDeg) {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16];
}

/** The samples with the transmit-side Doppler added, when the link has an
 *  uplink: the same range rate, at the uplink's frequency, with the sign an
 *  operator applies (transmit low while it approaches). */
export function withUplink(samples, meta) {
  if (!meta.freqHz || !(meta.uplinkHz > 0)) return samples;
  return samples.map((s) => ({ ...s, uplinkDopplerHz: uplinkDopplerHz(s.dopplerHz, meta.freqHz, meta.uplinkHz) }));
}

/** The elevation panel's scale: 0 at the bottom, a round top. `headroom`
 *  (panel units) keeps that much clear above the peak for its label, which
 *  can take the top past 90; the panel then labels no tick above 90. Same
 *  shape as panelScale's result. */
export function elevationScale(values, height, headroom = 0) {
  const max = values.reduce((m, v) => (Number.isFinite(v) ? Math.max(m, v) : m), 0);
  const need = Math.max(max, 5) * height / Math.max(1, height - headroom);
  const nice = niceAxisMax(need);
  const hi = nice > 90 && need <= 90 ? 90 : nice;
  const fn = (v) => height - (Math.min(Math.max(v, 0), hi) / hi) * height;
  fn.lo = 0;
  fn.hi = hi;
  return fn;
}

/** Where to point along the pass, at the time axis's ticks so each reads
 *  against a time below: rise, set, the highest point in place of the tick
 *  nearest it, and the ticks between. Nearest sample, no interpolation (the
 *  samples are seconds apart). With `edges: false` (a 24-hour window of a
 *  satellite that never sets) the first and last are ordinary marks, not
 *  rise and set. */
export function pointingMarks(samples, count, { edges = true } = {}) {
  const ok = samples.filter((s) => Number.isFinite(s.azDeg) && Number.isFinite(s.elDeg));
  if (!ok.length) return [];
  const ticks = timeTicks(ok[0].tMs, ok[ok.length - 1].tMs, Math.max(3, count));
  const n = ticks.length;
  const peak = ok.reduce((a, b) => (b.elDeg > a.elDeg ? b : a));
  // The peak takes the nearest interior tick; with no rise and set (a
  // 24-hour window) it may take an end one too.
  const lo = edges ? 1 : 0, hi = edges ? n - 2 : n - 1;
  let pi = lo;
  for (let i = lo + 1; i <= hi; i++) {
    if (Math.abs(ticks[i] - peak.tMs) < Math.abs(ticks[pi] - peak.tMs)) pi = i;
  }
  const near = (t) => ok.reduce((a, b) => (Math.abs(b.tMs - t) < Math.abs(a.tMs - t) ? b : a));
  return ticks.map((t, i) => {
    const s = i === pi ? peak : i === 0 ? ok[0] : i === n - 1 ? ok[ok.length - 1] : near(t);
    const at = edges && i === 0 ? "rise" : edges && i === n - 1 ? "set" : i === pi ? "peak" : i < pi ? "up" : "down";
    return { at, tMs: s.tMs, azDeg: s.azDeg, elDeg: Math.max(0, s.elDeg) };
  });
}

/** Where the pass crosses each elevation in `degs`, rising and setting, with
 *  time and Doppler interpolated between the straddling samples (the same
 *  linear rule radio-pass.js uses for its summary). Every crossing: a pass
 *  has one each way, a day of a geosynchronous satellite can have several.
 *  Sorted by elevation, then time. Needs Doppler: with no frequency there is
 *  nothing to mark. */
export function elevationMarks(samples, degs = [10, 30]) {
  const out = [];
  for (const deg of degs) {
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      if (a.dopplerHz == null || b.dopplerHz == null) continue;
      const up = a.elDeg < deg && b.elDeg >= deg;
      const down = a.elDeg >= deg && b.elDeg < deg;
      if (!up && !down) continue;
      const f = b.elDeg === a.elDeg ? 0 : (deg - a.elDeg) / (b.elDeg - a.elDeg);
      out.push({ deg, leg: up ? "rise" : "set",
        tMs: a.tMs + f * (b.tMs - a.tMs), dopplerHz: a.dopplerHz + f * (b.dopplerHz - a.dopplerHz) });
    }
  }
  return out;
}

/** The largest Doppler shift each way: { high, low } samples ({ tMs,
 *  dopplerHz }), null where there is no Doppler. */
export function dopplerExtremes(samples) {
  let high = null, low = null;
  for (const x of samples) {
    if (x.dopplerHz == null) continue;
    if (!high || x.dopplerHz > high.dopplerHz) high = x;
    if (!low || x.dopplerHz < low.dopplerHz) low = x;
  }
  return {
    high: high && { tMs: high.tMs, dopplerHz: high.dopplerHz },
    low: low && { tMs: low.tMs, dopplerHz: low.dopplerHz },
  };
}

/** The headline numbers, as value and label pairs, most useful first. */
export function statTiles(series, meta) {
  const { samples, summary } = series;
  const maxEl = samples.reduce((m, s) => Math.max(m, s.elDeg ?? -90), -90);
  const tiles = [];
  if (meta.freqHz && summary.dopplerPeakToPeakHz != null) {
    tiles.push({ value: `${(summary.dopplerPeakToPeakHz / 1000).toFixed(2)} kHz`, label: "Doppler swing" });
    tiles.push({ value: `${fmtRate(summary.maxDopplerRateHzPerSec, 10)} Hz/s`, label: "max Doppler rate" });
  }
  tiles.push({ value: `${Math.round(maxEl)}°`, label: "max elevation" });
  tiles.push({ value: `${Math.round(summary.closestRangeM / 1000).toLocaleString("en-US")} km`, label: "closest range" });
  tiles.push({ value: `${summary.maxAngRateDegPerSec >= 0.01 ? summary.maxAngRateDegPerSec.toFixed(2) : fmtRate(summary.maxAngRateDegPerSec, Infinity)}°/s`, label: "max angular rate" });
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

const SANS = ATKINSON_STACK;

/** Average glyph advance as a fraction of font size, used to turn a pixel
 *  width into a character budget. Atkinson Hyperlegible Next measures
 *  0.43 to 0.53 em on this chart's copy (digits and capitals nearest the
 *  top); 0.6 keeps a margin of 13% over the 0.53 worst case for the system-ui fallback if the
 *  embedded face ever fails to load. */
export const ADVANCE_EM = 0.6;

// Role colours: blue while the satellite approaches (Doppler above zero, the
// signal blueshifted), red as it recedes (redshifted), teal for signal,
// violet for angular rate.
export const RADIO_ROLE_COLORS = { approach: "#7eb8ff", recede: "#ff7b6b", sig: "#7fe5d1", ang: "#c4a3ff" };
const C = RADIO_ROLE_COLORS;

const chartStyle = (F) => `
  /* Opaque canvas ground. Without it the exported PNG has a transparent
     background, which shows as white once the image is opened elsewhere. */
  .rc-canvas { fill: ${CHART_CANVAS}; }
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
  .rc-dot    { stroke: ${CHART_CANVAS}; stroke-width: 0.5; }
  .rc-tile   { fill: rgba(126, 184, 255, 0.06); stroke: rgba(126, 184, 255, 0.18); stroke-width: 0.3; }
  .rc-title  { fill: #e6eeff; font-size: ${F['rc-title']}px; font-weight: 600; font-family: ${SANS}; }
  .rc-head   { fill: #b8c4dc; font-size: ${F['rc-head']}px; font-family: ${SANS}; }
  .rc-label  { fill: #8aa0c8; font-size: ${F['rc-label']}px; font-family: ${SANS}; }
  .rc-meth   { fill: #6f80a0; font-size: ${F['rc-meth']}px; font-family: ${SANS}; }
  .rc-tick   { fill: #7386a8; font-size: ${F['rc-tick']}px; font-family: ${SANS}; font-variant-numeric: tabular-nums; }
  .rc-end    { font-weight: 600; }
  .rc-panel  { font-size: ${F['rc-panel']}px; font-weight: 600; font-family: ${SANS}; }
  .rc-axis   { fill: #6a7a9a; font-size: ${F['rc-axis']}px; font-family: ${SANS}; }
  .rc-tile-v { fill: #e6eeff; font-size: ${F['rc-tile-v']}px; font-weight: 600; font-family: ${SANS}; font-variant-numeric: tabular-nums; }
  .rc-tile-l { fill: #8aa0c8; font-size: ${F['rc-tile-l']}px; font-family: ${SANS}; letter-spacing: 0.04em; }
  .rc-mark   { font-size: ${F['rc-mark']}px; font-family: ${SANS}; font-variant-numeric: tabular-nums;
               paint-order: stroke; stroke: #04081a; stroke-width: 0.9; stroke-linejoin: round; }
`;
const CHART_STYLE = chartStyle(FONT_PX);

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
/** The chart's title (satellite and frequency) and subtitle (downlink,
 *  observer, UTC date). Shared with the phone view's HTML heading. */
export function radioChartHeading(series, meta) {
  const freqStr = meta.freqHz ? ` · ${(meta.freqHz / 1e6).toFixed(3)} MHz` : "";
  const t0 = series.samples[0]?.tMs;
  const dateStr = Number.isFinite(t0) ? new Date(t0).toISOString().slice(0, 10) : "";
  const sub = (meta.downlinkLabel ? `${meta.downlinkLabel} (${meta.duty ?? "unknown duty"}) · ` : "") +
    `${meta.observerName}${dateStr ? ` · ${dateStr}` : ""}`;
  return { title: `${meta.satelliteName}${freqStr}`, sub };
}

/** The one caption line under the full chart's tiles: what the swing, the
 *  bands and the dots mean. Shared with the phone view's HTML legend. */
export function radioChartCaption(series, meta) {
  const { summary } = series;
  const hasFreq = !!meta.freqHz;
  const hasJoint = meta.jointStartMs != null && meta.jointEndMs != null;
  const hasWorkable = meta.workableStartMs != null && meta.workableEndMs != null;
  const caption =
    (summary.dopplerPeakToPeakHz != null
      ? (meta.day
        ? "24 hours; it never sets here, so the swing is over the day. "
        : meta.clamped
        ? "WINDOW TRUNCATED at the search cap: rates, swing and duration are lower bounds, closest range an upper one. "
        : "Swing is horizon-to-horizon. ")
      : (meta.clamped ? "WINDOW TRUNCATED at the search cap: rates and duration are lower bounds, closest range an upper one. " : "")) +
    (hasWorkable ? `Shaded: above ${meta.minElevDeg}°. ` : "") +
    (hasJoint ? "Brighter: every observer can hear it. " : "") +
    (hasFreq
      ? (meta.day
        ? "Dots: the largest shift each way. Coloured on the left: the frequency at the start and end."
        : "Dots: Doppler at 10° and 30° up. Coloured on the left: the frequency at rise and set.")
      : "");
  return caption.trim();
}

/** The methods note at the foot of the full chart. Shared with the phone
 *  view's "About this prediction". */
export function radioMethodsNote(series, meta) {
  const { summary } = series;
  // Datum stated rather than absorbed (spec 12): geodeticToEcef consumes an
  // ellipsoidal height, so the undulation is uncorrected.
  const elevNote =
    `Observer elevation ${meta.elevM ?? 0} m (${meta.elevSource ?? "default"}), ` +
    `used as ellipsoidal; a looked-up value is orthometric, leaving the geoid ` +
    `undulation (±100 m) uncorrected, under 0.5 Hz.`;
  return meta.freqHz
    ? `Predicted; verify against your capture. Only the SHAPE is comparable: the ` +
      `transmitter's oscillator offset is unknown and constant ` +
      `(~±${txOscTolerance(meta.freqHz) ?? "unknown"}, assuming ${TX_OSC_PPM} ppm), ` +
      `so measure the null as the MIDPOINT of the swing, not as a crossing of ` +
      `${(meta.freqHz / 1e6).toFixed(3)} MHz. ` +
      (meta.uplinkHz > 0
        ? `Transmit is ${(meta.uplinkHz / 1e6).toFixed(3)} MHz corrected by the same range rate, so its ` +
          `offset is unknown in the same way. `
        : "") +
      `Free-space path loss at closest approach ${summary.absoluteFsplDb?.toFixed(1) ?? "n/a"} dB; ` +
      `Faraday rotation causes deep VHF nulls. ${elevNote}`
    : `Predicted; verify against your capture. No downlink frequency is set, so Doppler is ` +
      `not shown; range rate, elevation and angular rate are frequency-independent. ${elevNote}`;
}

/** The phone view's "Tune at" rows: the 10° and 30° crossings and closest
 *  approach, in time order, each with its local time (UTC when the zone is
 *  unusable), the frequency to tune to and the Doppler offset. Empty with no
 *  frequency. */
export function tuneRows(series, meta) {
  if (!meta.freqHz) return [];
  // A day of a satellite that never sets: its highest and lowest frequency.
  const ex = meta.day ? dopplerExtremes(series.samples) : null;
  const moments = meta.day
    ? [
        ex.high && { label: "Highest frequency", tMs: ex.high.tMs, dopplerHz: ex.high.dopplerHz },
        ex.low && { label: "Lowest frequency", tMs: ex.low.tMs, dopplerHz: ex.low.dopplerHz },
      ].filter(Boolean)
    : elevationMarks(series.samples).map((m) => ({
      label: `${m.deg}° ${m.leg === "rise" ? "rising" : "setting"}`,
      tMs: m.tMs, dopplerHz: m.dopplerHz,
    }));
  const tca = series.summary?.tcaMs;
  if (Number.isFinite(tca)) moments.push({ label: "Closest approach", tMs: tca, dopplerHz: 0 });
  moments.sort((a, b) => a.tMs - b.tMs);
  return moments.map((m) => {
    const ms = Math.round(m.tMs);
    return {
      label: m.label,
      tMs: m.tMs,
      time: formatLocalTime(ms, meta.tz) ?? new Date(ms).toISOString().slice(11, 19),
      dopplerHz: m.dopplerHz,
      tune: tuneLabel(meta.freqHz, m.dopplerHz / 1000),
      offset: m.dopplerHz === 0 ? "0.0 kHz" : fmtDopplerLeg(m.dopplerHz),
      // Where to transmit then, for a link with an uplink.
      transmit: meta.uplinkHz > 0
        ? tuneLabel(meta.uplinkHz, (uplinkDopplerHz(m.dopplerHz, meta.freqHz, meta.uplinkHz) ?? 0) / 1000)
        : null,
    };
  });
}

/** Draw the stacked panels from `geo.top` down. Returns the y just past the
 *  last panel's gap and the x mapping, for the time axis.
 *  geo: X0, W, top, GAP, heightOf(panel), idPrefix (clip ids, unique per
 *  chart on a page), markText (label the 10°/30° dots), tickPx (the tick
 *  type size, for spacing), rightHeadEnd (right edge for a right-aligned
 *  "Doppler (kHz)" heading, or null to start it at the right axis).
 *
 *  With a frequency the Doppler panel's left axis is the frequency to tune
 *  to, in MHz (the side people read first), and its right axis the shift in
 *  kHz. The rise and set frequencies sit on the left axis in the curve's
 *  colours; a plain tick that would crowd one is left out. */
function drawPanels(svg, series, meta, geo) {
  const { X0, W, GAP, heightOf, idPrefix, markText, rightHeadEnd, tickPx } = geo;
  const { summary } = series;
  const samples = withUplink(series.samples, meta);
  const t0 = samples[0].tMs, t1 = samples[samples.length - 1].tMs;
  const span = Math.max(1, t1 - t0);
  const xOf = (ms) => X0 + ((ms - t0) / span) * W;
  const hasFreq = !!meta.freqHz;
  // Band flags, computed once: the caption and the rect must never disagree.
  const hasJoint = meta.jointStartMs != null && meta.jointEndMs != null;
  const hasWorkable = meta.workableStartMs != null && meta.workableEndMs != null;

  const panels = panelsFor(hasFreq, meta.uplinkHz > 0);
  const jx0 = hasJoint ? Math.max(X0, xOf(meta.jointStartMs)) : 0;
  const jx1 = hasJoint ? Math.min(X0 + W, xOf(meta.jointEndMs)) : 0;
  const wx0 = hasWorkable ? Math.max(X0, xOf(meta.workableStartMs)) : 0;
  const wx1 = hasWorkable ? Math.min(X0 + W, xOf(meta.workableEndMs)) : 0;
  const tcaX = xOf(summary.tcaMs);

  let top = geo.top;
  panels.forEach((panel, i) => {
    const H = heightOf(panel);
    const g = el("g", { "data-layer": panel.key });
    const clipId = `${idPrefix}-${panel.key}`;
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

    const isEl = panel.key === "elDeg";
    // Elevation from the horizon (a refracted edge sample can sit a hair
    // below it) up to a round top no higher than the zenith.
    const vals = samples.map((s) => {
      const v = (s[panel.key] ?? 0) * panel.scale;
      return isEl ? Math.max(0, v) : v;
    });
    const markPx = geo.markPx ?? FONT_PX["rc-mark"];
    const yOf = isEl ? elevationScale(vals, H, markPx + 2) : panelScale(vals, H);
    const zeroY = top + yOf(0);
    const ticks = axisTicks(yOf.lo, yOf.hi, H > 40 ? 5 : 3).filter((v) => !isEl || v <= 90);
    // A label's baseline for a value: inside the panel at its top and bottom.
    const labelY = (gy) => (Math.abs(gy - top) < 0.05 ? gy + 2.4 : Math.abs(gy - (top + H)) < 0.05 ? gy - 0.4
      : Math.min(top + H - 0.4, Math.max(top + 2.4, gy + 0.9)));
    // The tune panels: receive (Doppler) and transmit. Their left axis is the
    // frequency to set, their right the shift. Approaching is blue: the
    // downlink is heard high then (blueshift), and the uplink sent low.
    const dop = panel.key === "dopplerHz";
    const up = panel.key === "uplinkDopplerHz";
    const tune = dop || up;
    const baseHz = up ? meta.uplinkHz : meta.freqHz;
    const approachAbove = !up;
    // The rise and set frequencies, from the first and last samples.
    const withDop = tune ? samples.filter((s) => s[panel.key] != null) : [];
    const ends = [];
    if (withDop.length) {
      for (const s of [withDop[0], withDop[withDop.length - 1]]) {
        const v = s[panel.key] / 1000;
        const ly = labelY(top + yOf(v));
        // A pass with almost no swing: the set label would sit on the rise one.
        if (ends.some((e) => Math.abs(e.ly - ly) < tickPx * 1.2)) continue;
        ends.push({ v, ly, color: (v >= 0) === approachAbove ? C.approach : C.recede });
      }
    }
    for (const tv of ticks) {
      const gy = top + yOf(tv);
      const atEdge = Math.abs(gy - top) < 0.05 || Math.abs(gy - (top + H)) < 0.05;
      if (tv !== 0 && !atEdge) g.appendChild(el("line", { x1: X0, y1: gy, x2: X0 + W, y2: gy, class: "rc-grid" }));
      const ly = labelY(gy);
      if (!tune) {
        g.appendChild(el("text", { x: X0 - 2.5, y: ly, class: "rc-tick", "text-anchor": "end" },
          isEl ? `${Math.round(tv)}°` : fmtTick(tv)));
        continue;
      }
      // Left the frequency to tune to, right the signed shift, unless a rise
      // or set label is at that height.
      if (ends.some((e) => Math.abs(e.ly - ly) < tickPx * 1.2)) continue;
      g.appendChild(el("text", { x: X0 - 2.5, y: ly, class: "rc-tick", "text-anchor": "end" }, tuneLabel(baseHz, tv)));
      g.appendChild(el("text", { x: X0 + W + 2.5, y: ly, class: "rc-tick" }, signedTick(tv)));
    }
    // The class sets the tick fill, so the colour goes in as a style.
    for (const e of ends) {
      g.appendChild(el("text", { x: X0 - 2.5, y: e.ly, class: "rc-tick rc-end", style: `fill: ${e.color}`, "text-anchor": "end" },
        tuneLabel(baseHz, e.v)));
      g.appendChild(el("text", { x: X0 + W + 2.5, y: e.ly, class: "rc-tick rc-end", style: `fill: ${e.color}` },
        signedTick(e.v)));
    }
    if (!isEl) g.appendChild(el("line", { x1: X0, y1: zeroY, x2: X0 + W, y2: zeroY, class: "rc-zero" }));

    const pts = samples
      .map((s, j) => (s[panel.key] == null ? null : [xOf(s.tMs), top + yOf(vals[j])]))
      .filter(Boolean);
    if (pts.length) {
      const line = pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
      if (panel.cls === "dop" || panel.cls === "up") {
        // Approaching blue, receding red: the same curve painted twice,
        // each copy clipped to its half. Doppler is above zero while it
        // approaches; range rate and the transmit shift are below.
        const hot = panel.key === "dopplerHz";
        const halves = [
          { id: `${clipId}-up`, y: top, h: zeroY - top, color: hot ? C.approach : C.recede },
          { id: `${clipId}-dn`, y: zeroY, h: top + H - zeroY, color: hot ? C.recede : C.approach },
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
        if (hasFreq && dop) {
          // Beside the zero rule under the largest shift each way, where the
          // curve is farthest from it: the far edges of a pass, wherever the
          // peaks fall in a day. Kept inside the panel; a side the curve
          // never reaches gets no label.
          const ex = dopplerExtremes(samples);
          const place = (m, text, y, fill) => {
            const tw = text.length * markPx * ADVANCE_EM;
            const x = Math.min(X0 + W - 2 - tw / 2, Math.max(X0 + 2 + tw / 2, xOf(m.tMs)));
            g.appendChild(el("text", { x, y, class: "rc-mark", fill, "text-anchor": "middle" }, text));
          };
          if (ex.high && ex.high.dopplerHz > 0) place(ex.high, "approaching", zeroY - 1.4, C.approach);
          if (ex.low && ex.low.dopplerHz < 0) place(ex.low, "receding", zeroY + 3.4, C.recede);
        }
      } else {
        const color = isEl ? C.sig : C.ang;
        const base = top + H;
        const area = `${pts[0][0].toFixed(2)},${base} ${line} ${pts[pts.length - 1][0].toFixed(2)},${base}`;
        const hg = el("g", { "clip-path": `url(#${clipId})` });
        hg.appendChild(el("polygon", { points: area, fill: color, "fill-opacity": 0.12 }));
        hg.appendChild(el("polyline", { points: line, class: "rc-trace", stroke: color }));
        g.appendChild(hg);
      }
    }

    const color = panel.cls === "dop" ? (hasFreq ? C.approach : C.recede) : up ? C.recede : isEl ? C.sig : C.ang;
    const head = dop ? "Tune (MHz)" : up ? "Transmit (MHz)" : isEl ? "Elevation and direction" : `${panel.label} (${panel.unit})`;
    g.appendChild(el("text", { x: X0, y: top - 2, class: "rc-panel", fill: color }, head));
    // Where to point: a dot on the curve at each time tick, labelled with
    // the compass direction, azimuth and elevation. Rise and set labels sit
    // in the top corners (the curve starts and ends on the horizon), rising
    // ones up and to the left of their dot and setting ones up and to the
    // right (the curve is lower on those sides), the highest above its dot
    // beside the TCA rule.
    // The phone's narrow chart drops the elevation (its tiles give the peak).
    if (isEl) {
      for (const m of pointingMarks(samples, geo.timeCount ?? 5, { edges: !meta.day })) {
        const mx = xOf(m.tMs), my = top + yOf(m.elDeg);
        const edge = m.at === "rise" || m.at === "set";
        if (!edge) g.appendChild(el("circle", { cx: mx, cy: my, r: 0.9, fill: C.sig, class: "rc-dot" }));
        const text = `${compassPoint(m.azDeg)} ${Math.round(m.azDeg)}°` +
          (markText && !edge ? ` · ${Math.round(m.elDeg)}°` : "");
        const tw = text.length * markPx * ADVANCE_EM;
        let anchor, x, y;
        if (edge) {
          anchor = m.at === "rise" ? "start" : "end";
          x = m.at === "rise" ? X0 + 1.5 : X0 + W - 1.5;
          y = top + markPx + 0.8;
        } else if (m.at === "peak") {
          // In the headroom above the peak, beside the TCA rule that runs
          // through it: on its right, or its left near the right edge.
          const right = mx + 1.6 + tw <= X0 + W - 1;
          anchor = right ? "start" : "end";
          x = mx + (right ? 1.6 : -1.6);
          y = my - 1.4;
        } else {
          anchor = m.at === "up" ? "end" : "start";
          x = mx + (m.at === "up" ? -1.4 : 1.4);
          // Kept inside the panel: a mark at either end of a 24-hour window
          // sits on the edge.
          if (anchor === "end" && x - tw < X0) { anchor = "start"; x = mx + 1.4; }
          else if (anchor === "start" && x + tw > X0 + W) { anchor = "end"; x = mx - 1.4; }
          // Above the dot, unless that runs out of the top of the panel.
          y = my - 1.6 - markPx < top ? my + markPx + 1.2 : my - 1.6;
        }
        g.appendChild(el("text", { x, y, class: "rc-mark", fill: C.sig, "text-anchor": anchor }, text));
      }
    }
    if (dop) {
      const head = `${panel.label} (${panel.unit})`;
      g.appendChild(rightHeadEnd == null
        ? el("text", { x: X0 + W + 2.5, y: top - 2, class: "rc-axis" }, head)
        : el("text", { x: rightHeadEnd, y: top - 2, class: "rc-axis", "text-anchor": "end" }, head));
    }

    // One TCA rule through every panel: Doppler crosses zero and angular
    // rate peaks at that instant (elevation peaks within a few seconds).
    g.appendChild(el("line", { x1: tcaX, y1: top, x2: tcaX, y2: top + H, class: "rc-tca" }));
    if (i === 0) {
      // Over a day the curve crosses zero at every nearest and farthest
      // point; the rule marks the nearest of the day, so it says so.
      g.appendChild(el("text", { x: tcaX, y: top - 2, class: "rc-mark", fill: "#e6eeff", "text-anchor": "middle" }, meta.day ? "Closest" : "TCA"));
    }

    // A day of a satellite that never sets: the largest shift each way, with
    // its time, on the curve (elevation crossings mean little here).
    if (panel.key === "dopplerHz" && meta.day) {
      const ex = dopplerExtremes(samples);
      for (const m of [ex.high, ex.low]) {
        if (!m) continue;
        const mx = xOf(m.tMs), my = top + yOf(m.dopplerHz / 1000);
        const above = m.dopplerHz >= 0;
        const c = above ? C.approach : C.recede;
        g.appendChild(el("circle", { cx: mx, cy: my, r: 1.1, fill: c, class: "rc-dot" }));
        if (!markText) continue;
        const clock = formatLocalTime(m.tMs, meta.tz) ?? new Date(m.tMs).toISOString().slice(11, 19);
        const text = `${fmtDopplerLeg(m.dopplerHz)} at ${clock.slice(0, 5)}`;
        const tw = text.length * markPx * ADVANCE_EM;
        // Centred on the peak, on its inner side (under a high, over a low),
        // where the flat top keeps the curve clear; kept inside the panel.
        const x = Math.min(X0 + W - 1 - tw / 2, Math.max(X0 + 1 + tw / 2, mx));
        g.appendChild(el("text", {
          x, y: my + (above ? 5 : -2.8),
          class: "rc-mark", fill: c, "text-anchor": "middle",
        }, text));
      }
    }
    // Doppler at 10 and 30 degrees, rising and setting, on the curve itself.
    if (panel.key === "dopplerHz" && !meta.day) {
      for (const m of elevationMarks(samples)) {
        const mx = xOf(m.tMs), my = top + yOf(m.dopplerHz / 1000);
        const c = m.dopplerHz >= 0 ? C.approach : C.recede;
        g.appendChild(el("circle", { cx: mx, cy: my, r: 1.1, fill: c, class: "rc-dot" }));
        if (!markText) continue;
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
  return { top, xOf, t0, t1 };
}

/** The UTC time row and, when the zone resolves, the local row under it.
 *  Returns the baseline of the last row drawn. */
function drawTimeAxis(svg, { t0, t1, xOf, X0, axisY, tz, count }) {
  const ticks = timeTicks(t0, t1, count);
  const tickAnchor = (i) => (i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle");
  // Seconds matter across a pass, not across a day: a long window reads HH:MM.
  const cut = t1 - t0 > 2 * 3_600_000 ? 16 : 19;
  ticks.forEach((ms, i) => {
    svg.appendChild(el("text", { x: xOf(ms), y: axisY, class: "rc-tick", "text-anchor": tickAnchor(i) },
      new Date(ms).toISOString().slice(11, cut)));
  });
  svg.appendChild(el("text", { x: X0 - 2.5, y: axisY, class: "rc-axis", "text-anchor": "end" }, "UTC"));

  // Second axis row: observer-local time (spec §15), skipped without a zone.
  const localLabels = ticks.map((ms) => formatLocalTime(ms, tz)?.slice(0, cut - 11) ?? null);
  if (!localLabels.every((l) => l != null)) return axisY;
  const localY = axisY + 4;
  ticks.forEach((ms, i) => {
    svg.appendChild(el("text", { x: xOf(ms), y: localY, class: "rc-tick", "text-anchor": tickAnchor(i) }, localLabels[i]));
  });
  svg.appendChild(el("text", { x: X0 - 2.5, y: localY, class: "rc-axis", "text-anchor": "end" },
    formatZoneAbbr(t0, tz) ?? tz));
  return localY;
}

/** Paint the chart. `series` is the radioPassSamples result; `meta` carries
 *  satelliteName, observerName, freqHz, downlinkLabel, duty, tz, elevM,
 *  elevSource, minElevDeg, clamped, workableStartMs/workableEndMs and
 *  optionally jointStartMs/jointEndMs (the multi-observer joint window). */
export function paintRadioChart(svg, series, meta) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  // The embedded Exo 2 first, so the watermark has its font in the PNG too.
  svg.appendChild(el("style", {}, EXO2_FONT_FACE + ATKINSON_FONT_FACE + CHART_STYLE + BRAND_STYLE));
  const canvas = el("rect", { x: 0, y: 0, width: 320, height: 0, class: "rc-canvas" });
  svg.appendChild(canvas);

  const { samples } = series;
  if (!samples.length) {
    // Size the canvas before bailing, so an empty series is not transparent.
    canvas.setAttribute("height", "40");
    svg.setAttribute("viewBox", "0 0 320 40");
    return;
  }
  // Room on the left for the Doppler panel's tune-to axis ("10489.5500").
  const X0 = 34, W = 250, GAP = 11;
  const budget = (cls) => Math.floor(W / (FONT_PX[cls] * ADVANCE_EM));

  // Title: the satellite and frequency, then what it is and where from.
  let y = 10;
  const heading = radioChartHeading(series, meta);
  for (const l of wrapText(heading.title, budget("rc-title"))) {
    svg.appendChild(el("text", { x: X0, y, class: "rc-title" }, l));
    y += 6.4;
  }
  for (const l of wrapText(heading.sub, budget("rc-head"))) {
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
  for (const l of wrapText(radioChartCaption(series, meta), budget("rc-label"))) {
    svg.appendChild(el("text", { x: X0, y, class: "rc-label" }, l));
    y += 4;
  }
  const Y0 = y + 6;

  const drawn = drawPanels(svg, series, meta, {
    X0, W, top: Y0, GAP, heightOf: (p) => p.height, idPrefix: "rc-clip", markText: true, rightHeadEnd: null,
    tickPx: FONT_PX["rc-tick"], markPx: FONT_PX["rc-mark"], timeCount: 5,
  });
  const bottomY = drawTimeAxis(svg, {
    t0: drawn.t0, t1: drawn.t1, xOf: drawn.xOf, X0, axisY: drawn.top - GAP + 5.5, tz: meta.tz, count: 5,
  });

  const methods = el("g", { "data-layer": "methods" });
  // Wrapped a little short of the plot width, to leave the watermark its corner.
  const notes = wrapText(radioMethodsNote(series, meta), Math.floor((W - 6) / (FONT_PX["rc-meth"] * ADVANCE_EM)));
  notes.forEach((line, i) => methods.appendChild(
    el("text", { x: X0, y: bottomY + 7 + i * 3.6, class: "rc-meth" }, line)));
  svg.appendChild(methods);

  // The SeekSat watermark in the bottom-right corner, in the right margin
  // beside the methods note (which wraps inside the plot width), and below
  // the time axis however short the note is.
  const notesEnd = bottomY + 7 + (notes.length - 1) * 3.6 + 5;
  const canvasH = Math.ceil(Math.max(notesEnd, bottomY + 4 + BRAND_PX.wordmark + BRAND_LINE_GAP + 3));
  paintBrandMark(svg, 316, canvasH - 3 - BRAND_LINE_GAP);
  canvas.setAttribute("height", String(canvasH));
  svg.setAttribute("viewBox", `0 0 320 ${canvasH}`);
}

/** Type sizes for the phone chart, in its own viewBox units. Slightly larger
 *  than the full chart's, since the phone viewBox is drawn about 3.4 to 3.7
 *  px per unit. */
export const COMPACT_FONT_PX = {
  ...FONT_PX,
  "rc-panel": 3.2,
  "rc-tick": 2.9,
  "rc-axis": 2.9,
  "rc-mark": 2.8,
};

// The phone chart is drawn larger per unit, so thinner strokes keep the
// traces at about the full chart's on-screen weight.
const COMPACT_STYLE = chartStyle(COMPACT_FONT_PX) + `
  .rc-trace { stroke-width: 0.7; }
  .rc-tca   { stroke-width: 0.3; }
  .rc-zero  { stroke-width: 0.3; }
  .rc-dot   { stroke-width: 0.35; }
  .rc-mark  { stroke-width: 0.7; }
`;

/** Phone geometry: room for a 10-character tune label ("10489.5500") on the
 *  left and "+10.0" on the right. */
const COMPACT = { VW: 96, X0: 20, W: 64, GAP: 9, TOP: 6, heights: { dop: 40, up: 22, el: 22, ang: 14 } };

/** Paint the phone chart: the panels and time axis only, at phone width.
 *  The title, tiles, caption and methods note are HTML around it. Clip ids
 *  differ from the full chart's, because both live on the page at once. */
export function paintRadioChartCompact(svg, series, meta) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.appendChild(el("style", {}, COMPACT_STYLE));
  const canvas = el("rect", { x: 0, y: 0, width: COMPACT.VW, height: 0, class: "rc-canvas" });
  svg.appendChild(canvas);
  if (!series.samples.length) {
    canvas.setAttribute("height", "20");
    svg.setAttribute("viewBox", `0 0 ${COMPACT.VW} 20`);
    return;
  }
  const { X0, W, GAP } = COMPACT;
  const drawn = drawPanels(svg, series, meta, {
    X0, W, top: COMPACT.TOP, GAP,
    heightOf: (p) => COMPACT.heights[p.cls] ?? p.height,
    idPrefix: "rcp-clip", markText: false, rightHeadEnd: COMPACT.VW - 0.5,
    tickPx: COMPACT_FONT_PX["rc-tick"], markPx: COMPACT_FONT_PX["rc-mark"], timeCount: 3,
  });
  const bottomY = drawTimeAxis(svg, {
    t0: drawn.t0, t1: drawn.t1, xOf: drawn.xOf, X0, axisY: drawn.top - GAP + 5.5, tz: meta.tz, count: 3,
  });
  const h = Math.ceil(bottomY + 2.5);
  canvas.setAttribute("height", String(h));
  svg.setAttribute("viewBox", `0 0 ${COMPACT.VW} ${h}`);
}
