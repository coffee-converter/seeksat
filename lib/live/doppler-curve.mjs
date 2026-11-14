// lib/live/doppler-curve.mjs - the live view's small Doppler curve: the shift
// over the whole pass for the chosen downlink, with a marker at now.

const MAX_POINTS = 120;

/**
 * The curve for samples ({ tMs, dopplerHz }) drawn in a width x height box,
 * zero across the middle, scaled to the largest shift either way:
 * { points, maxHz, zeroY, at } where `points` is an SVG polyline string and
 * at(tMs) is { x, y } on the curve then (null outside the pass), for the now
 * marker: the curve is built once a pass, the marker read each tick. Null
 * when the samples carry no Doppler. `pad` keeps the curve off the top and
 * bottom.
 */
export function dopplerCurve(samples, { width, height, pad = 2 }) {
  const pts = samples.filter((s) => Number.isFinite(s.dopplerHz));
  if (pts.length < 2) return null;
  const t0 = pts[0].tMs, t1 = pts[pts.length - 1].tMs;
  if (!(t1 > t0)) return null;
  let maxHz = 0;
  for (const s of pts) maxHz = Math.max(maxHz, Math.abs(s.dopplerHz));
  if (!(maxHz > 0)) return null;
  const zeroY = height / 2;
  const x = (t) => ((t - t0) / (t1 - t0)) * width;
  const y = (hz) => zeroY - (hz / maxHz) * (zeroY - pad);
  const step = Math.max(1, Math.ceil(pts.length / MAX_POINTS));
  const picked = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const points = picked.map((s) => `${x(s.tMs).toFixed(1)},${y(s.dopplerHz).toFixed(1)}`).join(' ');
  const at = (tMs) => {
    if (!(tMs >= t0 && tMs <= t1)) return null;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].tMs <= tMs) lo = mid; else hi = mid;
    }
    const a = pts[lo], b = pts[hi];
    const f = (tMs - a.tMs) / (b.tMs - a.tMs || 1);
    return { x: x(tMs), y: y(a.dopplerHz + (b.dopplerHz - a.dopplerHz) * f) };
  };
  return { points, maxHz, zeroY, at };
}
