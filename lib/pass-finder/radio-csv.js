// lib/pass-finder/radio-csv.js - the sample series as CSV, for driving a
// rig or a camera trigger.
//
// Azimuth and elevation are APPARENT (refracted, light-time retarded), so
// they are pointing angles rather than geometric ones.
//
// The header block carries the inputs that bound the accuracy: TLE epoch
// age (ISS along-track drift is ~1 km/day, 0.13 s of pass timing per km),
// the detected browser clock skew, and the observer elevation with its
// provenance. Sub-second camera triggering needs an NTP-disciplined clock;
// the app cannot provide one.

const COLUMNS = [
  "time_utc", "az_deg", "el_deg", "range_m", "range_rate_mps",
  "doppler_hz", "doppler_rate_hz_s", "rel_signal_db",
];

const num = (v, dp) => (v == null || !Number.isFinite(v) ? "" : v.toFixed(dp));

export function radioPassCsv(samples, meta = {}) {
  const lines = [];
  lines.push(`# satellite: ${meta.satelliteName ?? "unknown"}`);
  lines.push(`# observer: ${meta.observerName ?? "unknown"}`);
  lines.push(`# downlink_hz: ${meta.freqHz ?? ""}`);
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
  lines.push("# az/el are apparent: refracted and light-time retarded");
  lines.push(COLUMNS.join(","));

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    let rate = null;
    if (i > 0 && s.dopplerHz != null && samples[i - 1].dopplerHz != null) {
      const dt = (s.tMs - samples[i - 1].tMs) / 1000;
      if (dt > 0) rate = (s.dopplerHz - samples[i - 1].dopplerHz) / dt;
    }
    lines.push([
      new Date(s.tMs).toISOString(),
      num(s.azDeg, 3),
      num(s.elDeg, 3),
      num(s.rangeM, 1),
      num(s.rangeRateMps, 3),
      num(s.dopplerHz, 1),
      num(rate, 2),
      num(s.relSignalDb, 2),
    ].join(","));
  }
  return lines.join("\n") + "\n";
}
