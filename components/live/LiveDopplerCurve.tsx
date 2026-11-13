import { useMemo } from "react";
import { dopplerCurve } from "@/lib/live/doppler-curve.mjs";

const W = 300;
const H = 56;
const curveOf = dopplerCurve as (
  s: Array<{ tMs: number; dopplerHz: number | null }>,
  o: { width: number; height: number; pad?: number },
) => { points: string; maxHz: number; zeroY: number; at: (tMs: number) => { x: number; y: number } | null } | null;

const khz = (hz: number) => `${(hz / 1000).toFixed(1)} kHz`;

/** The Doppler shift over the whole pass for the chosen downlink, with a
 *  dot at now. */
export default function LiveDopplerCurve({ samples, nowMs }: {
  samples: Array<{ tMs: number; dopplerHz: number | null }>;
  nowMs: number;
}) {
  // The curve is fixed for the pass; only the dot moves.
  const shape = useMemo(() => curveOf(samples, { width: W, height: H, pad: 4 }), [samples]);
  if (!shape) return null;
  const now = shape.at(nowMs);
  return (
    <figure className="live-doppler">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Doppler shift over the pass, up to ${khz(shape.maxHz)} either way`}
      >
        <line x1={0} y1={shape.zeroY} x2={W} y2={shape.zeroY} className="live-doppler__zero" />
        <polyline points={shape.points} className="live-doppler__curve" />
        {now && <line x1={now.x} y1={0} x2={now.x} y2={H} className="live-doppler__now-line" />}
        {now && <circle cx={now.x} cy={now.y} r={4} className="live-doppler__now" />}
        {/* The curve falls from top left to bottom right: the scale goes in
            the empty corners. */}
        <text x={W - 2} y={11} textAnchor="end" className="live-doppler__label">{`+${khz(shape.maxHz)}`}</text>
        <text x={2} y={H - 3} className="live-doppler__label">{`−${khz(shape.maxHz)}`}</text>
      </svg>
      <figcaption className="live-doppler__caption">Doppler over the pass</figcaption>
    </figure>
  );
}
