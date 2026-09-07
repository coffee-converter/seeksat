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

const COLUMNS = [
  "time_utc", "az_deg", "el_deg", "range_m", "range_rate_mps",
  "doppler_hz", "rx_freq_hz", "doppler_rate_hz_s", "rel_signal_db",
];

const num = (v, dp) => (v == null || !Number.isFinite(v) ? "" : v.toFixed(dp));

export function radioPassCsv(samples, meta = {}) {
  const lines = [];
  lines.push(`# satellite: ${meta.satelliteName ?? "unknown"}`);
  if (meta.noradId != null) lines.push(`# norad_id: ${meta.noradId}`);
  lines.push(`# observer: ${meta.observerName ?? "unknown"}`);
  // Every value below is derived from this position. Without it the file
  // cannot be reproduced or checked against another prediction.
  if (meta.latDeg != null && meta.lonDeg != null) {
    lines.push(`# observer_lat_deg: ${meta.latDeg.toFixed(6)}`);
    lines.push(`# observer_lon_deg: ${meta.lonDeg.toFixed(6)}`);
  }
  lines.push(`# downlink_hz: ${meta.freqHz ?? ""}`);
  if (meta.downlinkLabel) lines.push(`# downlink: ${meta.downlinkLabel}`);

  // Pass envelope, so a sequencer does not have to scan the rows to find
  // where the pass starts, peaks and ends.
  if (samples.length) {
    const first = samples[0], last = samples[samples.length - 1];
    lines.push(`# aos_utc: ${new Date(first.tMs).toISOString()}`);
    if (meta.tcaMs != null && Number.isFinite(meta.tcaMs)) {
      lines.push(`# tca_utc: ${new Date(Math.round(meta.tcaMs)).toISOString()}`);
    }
    lines.push(`# los_utc: ${new Date(last.tMs).toISOString()}`);
    lines.push(`# duration_s: ${((last.tMs - first.tMs) / 1000).toFixed(0)}`);
    const maxEl = samples.reduce((m, x) => (x.elDeg > m ? x.elDeg : m), -90);
    lines.push(`# max_elevation_deg: ${maxEl.toFixed(1)}`);
    if (samples.length > 1) {
      lines.push(`# step_s: ${((samples[1].tMs - first.tMs) / 1000).toFixed(0)}`);
    }
  }
  if (meta.tleEpochMs != null && Number.isFinite(meta.tleEpochMs) && samples.length) {
    const epoch = new Date(meta.tleEpochMs);
    lines.push(`# tle_epoch: ${epoch.toISOString()}`);
    const ageDays = (samples[0].tMs - meta.tleEpochMs) / 86400000;
    const suffix = ageDays < 0 ? " (before epoch)" : "";
    lines.push(`# tle_epoch_age_days: ${Math.abs(ageDays).toFixed(1)}${suffix}`);
  }
  if (meta.elevM != null) {
    lines.push(`# observer_elev_m: ${meta.elevM} (${meta.elevSource ?? "unknown"})`);
  }
  if (meta.clockSkewMs != null) lines.push(`# clock_skew_ms: ${meta.clockSkewMs}`);
  // The elements the whole file was propagated from. With these two lines
  // anyone can re-derive every row independently - the cheapest possible
  // reproducibility guarantee, and the thing that makes a disagreement
  // diagnosable rather than just a disagreement.
  if (meta.tleLine1 && meta.tleLine2) {
    lines.push(`# tle_line1: ${meta.tleLine1}`);
    lines.push(`# tle_line2: ${meta.tleLine2}`);
  }
  if (meta.generatedAtMs != null) {
    lines.push(`# generated_utc: ${new Date(meta.generatedAtMs).toISOString()}`);
  }
  lines.push("# az/el are apparent: refracted");
  lines.push("# range_rate_mps is in the inertial (TEME) frame, not ECEF");
  lines.push("# rx_freq_hz = downlink_hz + doppler_hz: the frequency to tune to.");
  lines.push("# Its ABSOLUTE accuracy is ~+/-1.1 kHz, not the 1 Hz shown - the");
  lines.push("# transmitter's own oscillator offset is unknown and unmodelled.");
  lines.push("# doppler_hz (the shape) is good to ~1 Hz; rx_freq_hz is not.");
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
