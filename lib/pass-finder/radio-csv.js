// lib/pass-finder/radio-csv.js - the sample series as CSV, for driving a
// rig or a camera trigger.
//
// Elevation is APPARENT (refracted), so it is a pointing angle rather than
// a geometric one. Azimuth is unaffected: refraction acts vertically, in
// the plane spanned by the line of sight and the local vertical, so the
// horizontal component is untouched.
//
// The header block carries the inputs that bound the accuracy: TLE epoch
// age (ISS along-track drift is ~1 km/day, 0.13 s of pass timing per km),
// the detected browser clock skew, and the observer elevation with its
// provenance. Sub-second camera triggering needs an NTP-disciplined clock;
// the app cannot provide one.

import { TX_OSC_PPM, txOscTolerance, wrapText } from "./radio-format.js";

// Column name, unit, what it is, and any caveats - kept beside the column
// list so the legend and the data row cannot drift apart: add a column here
// and it is documented by construction. A test asserts every emitted column
// has a non-empty description.
//
// `what` is one line saying what the quantity is; `caveats` is prose - or a
// function of meta returning prose - wrapped at emit time so hand-fitting
// cannot overflow the column. Keeping the two separate matters: running
// definition and warning together meant a reader scanning for a unit had to
// parse a sentence to find it.
const COLUMN_DOCS = [
  { name: "time_utc", unit: "UTC",
    what: "Timestamp of this row, ISO 8601 with milliseconds." },
  { name: "az_deg", unit: "deg",
    what: "Apparent azimuth, clockwise from true north.",
    caveats: "Unaffected by refraction, which acts vertically: aim a " +
      "rotator at this directly." },
  { name: "el_deg", unit: "deg",
    what: "Apparent elevation above the horizon.",
    caveats: "Refracted, so aim an elevation rotator at this rather than " +
      "a geometric angle. This is OPTICAL refraction; radio refracts " +
      "~10-15% more near the horizon, which matters most at low elevation." },
  { name: "range_m", unit: "m",
    what: "Slant range from observer to satellite." },
  { name: "range_rate_mps", unit: "m/s",
    what: "Rate of change of range. Positive means receding.",
    caveats: "Inertial (TEME) frame; an ECEF figure differs by up to 30 m/s." },
  { name: "doppler_hz", unit: "Hz",
    what: "Shift from the nominal carrier. Positive means approaching.",
    caveats: "The SHAPE is the comparable quantity: a constant carrier " +
      "offset cancels out of it. Prediction error is ~1 Hz, but a real " +
      "transmitter also drifts - 0.1 ppm is ~44 Hz at 70 cm over a pass." },
  { name: "rx_freq_hz", unit: "Hz",
    what: "The frequency to tune to: downlink_hz + doppler_hz.",
    // Printed to the nearest Hz because a rig wants integer Hz - not
    // because the value is good to a Hz. It is not, and by a wide margin.
    caveats: (meta) => {
      const tol = txOscTolerance(meta.freqHz);
      if (!tol) return "Empty without a downlink frequency.";
      return `Rounded to whole Hz because a rig wants whole Hz, but good ` +
        `only to ~+/-${tol}: the satellite's own transmit oscillator sits ` +
        `an unknown amount off nominal (assumed ${TX_OSC_PPM} ppm). This ` +
        `does not affect doppler_hz.`;
    } },
  { name: "doppler_rate_hz_s", unit: "Hz/s",
    what: "Rate of change of doppler_hz.",
    caveats: "Sets how often a rig has to retune." },
  { name: "rel_signal_db", unit: "dB",
    what: "Signal relative to this pass's peak.",
    caveats: "Free-space path loss only; assumes circular polarisation. " +
      "Terrain and antenna pattern are not modelled." },
];

const COLUMNS = COLUMN_DOCS.map((c) => c.name);

// Wide enough for the legend's three aligned columns; the TLE lines in the
// provenance section already run to about this length.
const RULE_WIDTH = 94;
const KEY_WIDTH = 22;
// Legend geometry: name column, then unit, then the description.
const DOC_NAME_WIDTH = 20;
const DOC_UNIT_WIDTH = 8;
const DOC_INDENT = DOC_NAME_WIDTH + DOC_UNIT_WIDTH;

/** `# --- Title ------...` to the standard rule width. */
function section(title) {
  const head = `# --- ${title} `;
  return head + "-".repeat(Math.max(3, RULE_WIDTH - head.length));
}

/** `# key:              value`, key column aligned. */
function field(key, value) {
  return `# ${(key + ":").padEnd(KEY_WIDTH)}${value}`;
}

const num = (v, dp) => (v == null || !Number.isFinite(v) ? "" : v.toFixed(dp));

export function radioPassCsv(samples, meta = {}) {
  const lines = [];
  const rule = "# " + "=".repeat(RULE_WIDTH - 2);
  lines.push(rule);
  lines.push("# SeekSat radio pass prediction");
  lines.push(rule);

  lines.push(section("Satellite"));
  lines.push(field("satellite", meta.satelliteName ?? "unknown"));
  if (meta.noradId != null) lines.push(field("norad_id", meta.noradId));
  lines.push(field("downlink_hz", meta.freqHz ?? ""));
  if (meta.downlinkLabel) lines.push(field("downlink", meta.downlinkLabel));

  lines.push(section("Observer"));
  // Geocoded names run long and the field is unbounded, so clip it to what
  // the rule width allows rather than letting one value break the block.
  const obsName = String(meta.observerName ?? "unknown");
  const obsMax = RULE_WIDTH - 2 - KEY_WIDTH;
  lines.push(field("observer",
    obsName.length > obsMax ? `${obsName.slice(0, obsMax - 1)}…` : obsName));
  // Every value below is derived from this position. Without it the file
  // cannot be reproduced or checked against another prediction.
  if (meta.latDeg != null && meta.lonDeg != null) {
    lines.push(field("observer_lat_deg", meta.latDeg.toFixed(6)));
    lines.push(field("observer_lon_deg", meta.lonDeg.toFixed(6)));
  }
  if (meta.elevM != null) {
    lines.push(field("observer_elev_m",
      `${meta.elevM} (${meta.elevSource ?? "unknown"}, orthometric)`));
  }

  // Pass envelope, so a sequencer does not have to scan the rows to find
  // where the pass starts, peaks and ends.
  if (samples.length) {
    const first = samples[0], last = samples[samples.length - 1];
    lines.push(section("Pass"));
    lines.push(field("aos_utc", new Date(first.tMs).toISOString()));
    if (meta.tcaMs != null && Number.isFinite(meta.tcaMs)) {
      lines.push(field("tca_utc",
        new Date(Math.round(meta.tcaMs)).toISOString()));
    }
    lines.push(field("los_utc", new Date(last.tMs).toISOString()));
    lines.push(field("duration_s", ((last.tMs - first.tMs) / 1000).toFixed(0)));
    const maxEl = samples.reduce((m, x) => (x.elDeg > m ? x.elDeg : m), -90);
    lines.push(field("max_elevation_deg", `${maxEl.toFixed(1)} (apparent)`));
    // Rows span the full geometric pass so the numbers do not shift with a
    // search-filter setting. The threshold is reported, not applied.
    if (meta.minElevDeg != null) {
      lines.push(field("min_elevation_deg", meta.minElevDeg > 0
        ? `${meta.minElevDeg} (reported, not applied - rows span the full pass)`
        : "0 (no filter set)"));
      if (meta.workableStartMs != null && meta.workableEndMs != null) {
        lines.push(field("above_min_elev_from",
          new Date(meta.workableStartMs).toISOString()));
        lines.push(field("above_min_elev_to",
          new Date(meta.workableEndMs).toISOString()));
      }
    }
    if (samples.length > 1) {
      lines.push(field("step_s", ((samples[1].tMs - first.tMs) / 1000).toFixed(0)));
    }
  }

  lines.push(section("Provenance"));
  if (meta.tleEpochMs != null && Number.isFinite(meta.tleEpochMs) && samples.length) {
    lines.push(field("tle_epoch", new Date(meta.tleEpochMs).toISOString()));
    const ageDays = (samples[0].tMs - meta.tleEpochMs) / 86400000;
    const suffix = ageDays < 0 ? " (before epoch)" : "";
    lines.push(field("tle_epoch_age_days",
      `${Math.abs(ageDays).toFixed(1)}${suffix}`));
  }
  // The elements the whole file was propagated from. With these two lines
  // anyone can re-derive every row independently - the cheapest possible
  // reproducibility guarantee, and the thing that makes a disagreement
  // diagnosable rather than just a disagreement.
  if (meta.tleLine1 && meta.tleLine2) {
    lines.push(field("tle_line1", meta.tleLine1));
    lines.push(field("tle_line2", meta.tleLine2));
  }
  if (meta.generatedAtMs != null) {
    lines.push(field("generated_utc", new Date(meta.generatedAtMs).toISOString()));
  }
  if (meta.clockSkewMs != null) {
    lines.push(field("clock_skew_ms",
      `${meta.clockSkewMs} (browser clock vs server; sub-second triggering needs NTP)`));
  }

  lines.push(section("Columns"));
  lines.push(`# ${"column".padEnd(DOC_NAME_WIDTH)}${"unit".padEnd(DOC_UNIT_WIDTH)}meaning`);
  lines.push(`# ${"-".repeat(DOC_NAME_WIDTH - 2).padEnd(DOC_NAME_WIDTH)}` +
    `${"-".repeat(DOC_UNIT_WIDTH - 2).padEnd(DOC_UNIT_WIDTH)}` +
    "-".repeat(RULE_WIDTH - 2 - DOC_INDENT));
  const pad = " ".repeat(DOC_INDENT);
  COLUMN_DOCS.forEach((c, i) => {
    // A blank comment line between entries: without it a wrapped caveat sits
    // flush against the next column name and the block reads as one run-on.
    if (i > 0) lines.push("#");
    lines.push(`# ${c.name.padEnd(DOC_NAME_WIDTH)}${c.unit.padEnd(DOC_UNIT_WIDTH)}${c.what}`);
    const prose = typeof c.caveats === "function" ? c.caveats(meta) : c.caveats;
    // Always wrapped, never hand-broken: the description column is narrow
    // and every hand-fitted caveat so far has overflowed it on edit.
    for (const l of wrapText(prose ?? "", RULE_WIDTH - 2 - DOC_INDENT)) {
      lines.push(`# ${pad}${l}`);
    }
  });

  lines.push(section("Notes"));
  for (const line of wrapText(
    "Predicted, not measured. Only the SHAPE of doppler_hz is comparable to a " +
    "capture: the transmitter's oscillator offset is unknown and constant, so " +
    "measure the null as the MIDPOINT of the swing rather than as a crossing of " +
    "the nominal carrier. Terrain masking is not modelled, and a ridge on the " +
    "horizon outweighs every error term above.",
    RULE_WIDTH - 2)) {
    lines.push(`# ${line}`);
  }
  lines.push(rule);
  lines.push(COLUMNS.join(","));

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    lines.push([
      new Date(s.tMs).toISOString(),
      num(s.azDeg, 3),
      num(s.elDeg, 3),
      num(s.rangeM, 1),
      num(s.rangeRateMps, 3),
      num(s.dopplerHz, 1),
      // Absolute tune frequency. A rig takes an absolute value, not an
      // offset, and making the reader add these two columns by hand is
      // where a sign error costs them the pass.
      s.dopplerHz == null || meta.freqHz == null
        ? "" : String(Math.round(meta.freqHz + s.dopplerHz)),
      num(s.dopplerRateHzPerSec, 2),
      num(s.relSignalDb, 2),
    ].join(","));
  }
  return lines.join("\n") + "\n";
}
