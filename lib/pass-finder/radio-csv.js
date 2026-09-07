// lib/pass-finder/radio-csv.js - the sample series as CSV, for driving a
// rig or a camera trigger.
//
// Azimuth and elevation are APPARENT (refracted), so they are pointing
// angles rather than geometric ones.
//
// The header block carries the inputs that bound the accuracy: TLE epoch
// age (ISS along-track drift is ~1 km/day, 0.13 s of pass timing per km),
// the detected browser clock skew, and the observer elevation with its
// provenance. Sub-second camera triggering needs an NTP-disciplined clock;
// the app cannot provide one.

// Column name, unit, what it is, and any caveats - kept beside the column
// list so the legend and the data row cannot drift apart: add a column here
// and it is documented by construction. A test asserts every emitted column
// has a non-empty description.
//
// `what` is one line saying what the quantity is; `caveats` are separate
// lines, each a complete thought. Splitting them matters: the earlier
// version ran definition and warning together as prose, so a reader
// scanning for a unit had to parse a sentence to find it, and multi-line
// entries butted straight against the next column name.
// Assumed stability of the satellite's own transmit oscillator. A typical
// amateur-radio TCXO holds ~2.5 ppm; a good one is nearer 0.5. This is an
// ASSUMPTION, not a published figure for any specific spacecraft - stated
// in the file so a reader can substitute their own.
//
// It scales with the carrier, which is why the tolerance is computed rather
// than written down: 2.5 ppm is ~1.09 kHz at 437.800 MHz but only ~365 Hz
// at 145.800.
const TX_OSC_PPM = 2.5;

/** Greedy word wrap. The oscillator caveat's length changes with the
 *  carrier (a kHz figure is wider than a Hz one), so hand-fitting it to the
 *  description column would silently overflow on some frequencies. */
function wrap(text, maxChars) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (!line) { line = word; continue; }
    if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

/** Transmit-oscillator tolerance at `freqHz`, formatted for prose. */
export function txOscToleranceText(freqHz) {
  if (!freqHz) return null;
  const hz = (freqHz * TX_OSC_PPM) / 1e6;
  return hz >= 1000 ? `+/-${(hz / 1000).toFixed(2)} kHz` : `+/-${hz.toFixed(0)} Hz`;
}

const COLUMN_DOCS = [
  { name: "time_utc", unit: "UTC",
    what: "Timestamp of this row, ISO 8601 with milliseconds." },
  { name: "az_deg", unit: "deg",
    what: "Apparent azimuth, clockwise from true north.",
    caveats: ["Refracted: aim a rotator at this, not a geometric bearing."] },
  { name: "el_deg", unit: "deg",
    what: "Apparent elevation above the horizon.",
    caveats: ["Refracted, as with az_deg."] },
  { name: "range_m", unit: "m",
    what: "Slant range from observer to satellite." },
  { name: "range_rate_mps", unit: "m/s",
    what: "Rate of change of range. Positive means receding.",
    caveats: ["Inertial (TEME) frame; an ECEF figure differs by ~30 m/s."] },
  { name: "doppler_hz", unit: "Hz",
    what: "Shift from the nominal carrier. Positive means approaching.",
    caveats: ["Good to ~1 Hz. This is the trustworthy quantity here."] },
  { name: "rx_freq_hz", unit: "Hz",
    what: "The frequency to tune to: downlink_hz + doppler_hz.",
    // Printed to the nearest Hz because a rig wants integer Hz - not
    // because the value is good to a Hz. It is not, and by a wide margin.
    caveats: (meta) => {
      const tol = txOscToleranceText(meta.freqHz);
      if (!tol) return ["Empty without a downlink frequency."];
      return wrap(
        `Rounded to whole Hz because a rig wants whole Hz, but good only ` +
        `to ~${tol}: the satellite's own transmit oscillator sits an ` +
        `unknown amount off nominal (assumed ${TX_OSC_PPM} ppm). This ` +
        `does not affect doppler_hz.`,
        RULE_WIDTH - 2 - DOC_INDENT);
    } },
  { name: "doppler_rate_hz_s", unit: "Hz/s",
    what: "Rate of change of doppler_hz.",
    caveats: ["Sets how often a rig has to retune."] },
  { name: "rel_signal_db", unit: "dB",
    what: "Signal relative to this pass's peak.",
    caveats: [
      "Free-space path loss only; assumes circular polarisation.",
      "Terrain and antenna pattern are not modelled.",
    ] },
];

const COLUMNS = COLUMN_DOCS.map((c) => c.name);

// Wide enough for the legend's three aligned columns; the TLE lines in the
// provenance section already run to about this length.
const RULE_WIDTH = 92;
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
  lines.push(field("observer", meta.observerName ?? "unknown"));
  // Every value below is derived from this position. Without it the file
  // cannot be reproduced or checked against another prediction.
  if (meta.latDeg != null && meta.lonDeg != null) {
    lines.push(field("observer_lat_deg", meta.latDeg.toFixed(6)));
    lines.push(field("observer_lon_deg", meta.lonDeg.toFixed(6)));
  }
  if (meta.elevM != null) {
    lines.push(field("observer_elev_m",
      `${meta.elevM} (${meta.elevSource ?? "unknown"})`));
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
    lines.push(field("max_elevation_deg", maxEl.toFixed(1)));
    // Rows span the full geometric pass so the numbers do not shift with a
    // search-filter setting. The threshold is reported, not applied.
    if (meta.minElevDeg != null && meta.minElevDeg > 0) {
      lines.push(field("min_elevation_deg",
        `${meta.minElevDeg} (reported, not applied - rows span the full pass)`));
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
    const caveats = typeof c.caveats === "function" ? c.caveats(meta) : c.caveats;
    for (const caveat of caveats ?? []) lines.push(`# ${pad}${caveat}`);
  });

  lines.push(section("Notes"));
  lines.push("# Predicted, not measured. Only the SHAPE of doppler_hz is comparable");
  lines.push("# to a capture: the transmitter's oscillator offset is unknown and");
  lines.push("# constant, so measure the null as the MIDPOINT of the swing rather");
  lines.push("# than as a crossing of the nominal carrier.");
  lines.push("# Terrain masking is not modelled - a ridge on the horizon outweighs");
  lines.push("# every error term above.");
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
