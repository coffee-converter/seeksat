"use client";

import { useMemo } from "react";
import { orbitDiagram } from "@/lib/sat/orbit-diagram.mjs";
import { SAT_PALETTE } from "@/lib/map/draw.mjs";

type Diagram = {
  size: number;
  earth: { cx: number; cy: number; r: number };
  ellipse: { cx: number; cy: number; rx: number; ry: number };
  perigee: { x: number; y: number };
  apogee: { x: number; y: number };
  dot: { x: number; y: number } | null;
};

export default function OrbitDiagram({ track, nowMs }: { track: unknown; nowMs: number }) {
  // Repaints every 10 s.
  const tick = Math.floor(nowMs / 10_000) * 10_000;
  const d = useMemo(
    () => (orbitDiagram as (t: unknown, n: number) => Diagram)(track, tick),
    [track, tick],
  );
  const labelDy = (y: number) => (y > d.size / 2 ? -8 : 14);
  return (
    <figure className="sat-diagram">
      <h2 className="home-heading">Orbit diagram</h2>
      <svg viewBox={`0 0 ${d.size} ${d.size}`} role="img" aria-label="The orbit drawn to scale in its own plane">
        <ellipse cx={d.ellipse.cx} cy={d.ellipse.cy} rx={d.ellipse.rx} ry={d.ellipse.ry}
          fill="none" stroke="rgba(126,184,255,0.6)" strokeWidth="1.5" />
        <circle cx={d.earth.cx} cy={d.earth.cy} r={d.earth.r} fill="#1d3b63" stroke="#4a78b0" />
        <circle cx={d.perigee.x} cy={d.perigee.y} r="3" fill="#e6edf7" />
        <text x={d.perigee.x} y={d.perigee.y + labelDy(d.perigee.y)} textAnchor="end" className="sat-diagram-label">perigee</text>
        <circle cx={d.apogee.x} cy={d.apogee.y} r="3" fill="#e6edf7" />
        <text x={d.apogee.x} y={d.apogee.y + labelDy(d.apogee.y)} textAnchor="start" className="sat-diagram-label">apogee</text>
        {d.dot ? <circle cx={d.dot.x} cy={d.dot.y} r="5" fill={SAT_PALETTE[0]} stroke="#fff" strokeWidth="1" /> : null}
      </svg>
      <figcaption className="home-note">
        Drawn to scale in the orbit&apos;s own plane, from mean elements. Earth&apos;s center is at one focus.
      </figcaption>
    </figure>
  );
}
