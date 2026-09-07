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

// Column name paired with its documentation, so the header legend and the
// data row can never drift apart: add a column here and it is documented by
// construction. A test asserts every emitted column has a non-empty doc.
const COLUMN_DOCS = [
  ["time_utc", [
    "ISO 8601 UTC, millisecond precision.",
  ]],
  ["az_deg", [
    "Apparent azimuth, degrees clockwise from true north.",
    "Refracted - point a rotator at this, not at a geometric bearing.",
  ]],
  ["el_deg", [
    "Apparent elevation, degrees above the horizon. Refracted.",
  ]],
  ["range_m", [
    "Slant range from observer to satellite, metres.",
  ]],
  ["range_rate_mps", [
    "Range rate, m/s. Positive = receding.",
    "Inertial (TEME) frame; the ECEF figure differs by up to ~30 m/s.",
  ]],
  ["doppler_hz", [
    "Doppler shift, Hz. Positive = received above the nominal carrier,",
    "i.e. the satellite is approaching. Good to ~1 Hz.",
  ]],
  ["rx_freq_hz", [
    "downlink_hz + doppler_hz: the frequency to tune to.",
    "ABSOLUTE accuracy is ~+/-1.1 kHz, NOT the 1 Hz printed - the",
    "transmitter's own oscillator offset is unknown and unmodelled.",
  ]],
  ["doppler_rate_hz_s", [
    "Rate of change of doppler_hz, Hz/s. Sets how often a rig must retune.",
  ]],
  ["rel_signal_db", [
    "Received signal relative to this pass's peak, dB. Free-space path",
    "loss only; an envelope valid for circular polarisation.",
  ]],
];

const COLUMNS = COLUMN_DOCS.map(([name]) => name);

const RULE_WIDTH = 74;
const KEY_WIDTH = 22;
const DOC_WIDTH = 19;

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
  for (const [name, doc] of COLUMN_DOCS) {
    doc.forEach((line, i) => {
      lines.push(`# ${(i === 0 ? name : "").padEnd(DOC_WIDTH)} ${line}`);
    });
  }

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
