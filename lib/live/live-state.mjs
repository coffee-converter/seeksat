// lib/live/live-state.mjs - what the live pass view shows at one instant,
// interpolated from a pass sampled once (radioSeries, 1 s steps).

const LIVE_LEAD_MS = 30 * 60_000;

const lerp = (a, b, f) => a + (b - a) * f;
const lerpOrNull = (a, b, f) => (a == null || b == null ? null : lerp(a, b, f));

/** Azimuth between two samples, the short way round (350 to 10 passes north). */
function lerpAz(a, b, f) {
  const d = ((b - a + 540) % 360) - 180;
  return (((a + d * f) % 360) + 360) % 360;
}

const NONE = { azDeg: null, elDeg: null, rangeKm: null, dopplerHz: null, rateHzPerSec: null };

/** Phase, position, Doppler and countdowns at `nowMs`. */
export function liveState(samples, nowMs) {
  const first = samples[0];
  const last = samples[samples.length - 1];
  let peak = first;
  for (const s of samples) if (s.elDeg > peak.elDeg) peak = s;
  const base = {
    peakElDeg: peak.elDeg,
    peakAzDeg: peak.azDeg,
    msToPeak: peak.tMs > nowMs ? peak.tMs - nowMs : null,
    msToRise: null,
    msToSet: null,
  };
  if (nowMs < first.tMs) {
    return {
      ...base, phase: 'before', msToRise: first.tMs - nowMs,
      azDeg: first.azDeg, elDeg: first.elDeg, rangeKm: first.rangeM / 1000,
      dopplerHz: first.dopplerHz ?? null, rateHzPerSec: first.dopplerRateHzPerSec ?? null,
    };
  }
  if (nowMs >= last.tMs) return { ...base, ...NONE, phase: 'after', msToPeak: null };
  let i = 0;
  while (i < samples.length - 2 && samples[i + 1].tMs <= nowMs) i++;
  const a = samples[i], b = samples[i + 1];
  const f = (nowMs - a.tMs) / (b.tMs - a.tMs || 1);
  return {
    ...base,
    phase: 'during',
    msToSet: last.tMs - nowMs,
    azDeg: lerpAz(a.azDeg, b.azDeg, f),
    elDeg: lerp(a.elDeg, b.elDeg, f),
    rangeKm: lerp(a.rangeM, b.rangeM, f) / 1000,
    dopplerHz: lerpOrNull(a.dopplerHz, b.dopplerHz, f),
    rateHzPerSec: lerpOrNull(a.dopplerRateHzPerSec, b.dopplerRateHzPerSec, f),
  };
}

/** A pass worth opening live: up now, or rising within 30 minutes. */
export function liveAvailable(pass, nowMs) {
  return nowMs < pass.endMs && pass.startMs - nowMs <= LIVE_LEAD_MS;
}

/** "0:05", "4:05", "1:02:03". */
export function clockText(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
