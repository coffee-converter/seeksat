"use client";

import { useEffect, useRef } from "react";
import { type PassObserver } from "@/lib/pass-finder-store";
import { paintPolarPlot } from "@/lib/scene-bridge";

// Polar plot SVG that lives inside each ObserverCard. React renders
// the static skeleton (horizon disc, 30°/60° altitude rings, cardinal
// labels, empty groups for bodies/arc/events, ISS-dot placeholder);
// the scene bridge's paintPolarPlot fills the dynamic groups (sun /
// moon, ISS arc, start/peak/end markers, current ISS-dot position).
// Per-frame ISS-dot updates continue to walk all .polar-plot[data-
// obs-id="..."] SVGs in the DOM, so we keep those attributes here.
//
// React's reconciler doesn't touch DOM children it didn't create, so
// the scene appending into `g.bodies` / `g.arc` / `g.events` doesn't
// race with future React renders of this component.

const INNER_R = 45;       // horizon circle radius (in viewBox units)
const ALT_RING_DEGS = [60, 30];

export default function PolarPlot({ obs }: { obs: PassObserver }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    paintPolarPlot(svg, obs.id);
  }, [obs.id]);

  return (
    <svg
      ref={svgRef}
      className="polar-plot"
      data-obs-id={obs.id}
      viewBox="0 0 100 100"
    >
      <circle className="horizon" cx={50} cy={50} r={INNER_R} />
      {ALT_RING_DEGS.map((altDeg) => (
        <circle
          key={altDeg}
          className="grid"
          cx={50}
          cy={50}
          r={((90 - altDeg) / 90) * INNER_R}
        />
      ))}
      {/* Cardinal labels - sky-chart convention (looking up):
          N top, E LEFT, W RIGHT, matching altAzToSvg's negated-sin
          projection. Positioned just outside the horizon ring;
          CSS sets overflow: visible so they render past the viewBox. */}
      <text className="cardinal" x={50}  y={-2}  textAnchor="middle" dominantBaseline="central">N</text>
      <text className="cardinal" x={-2}  y={50}  textAnchor="middle" dominantBaseline="central">E</text>
      <text className="cardinal" x={50}  y={102} textAnchor="middle" dominantBaseline="central">S</text>
      <text className="cardinal" x={102} y={50}  textAnchor="middle" dominantBaseline="central">W</text>
      {/* Empty groups + placeholder dot - scene paints into these. */}
      <g className="bodies" />
      <g className="arc" />
      <g className="events" />
      <circle className="iss-dot" r={2.5} />
    </svg>
  );
}
