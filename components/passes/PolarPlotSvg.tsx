"use client";

import { forwardRef } from "react";

// The small polar plot's static skeleton: horizon disc, 30°/60° altitude
// rings, cardinal labels, empty groups for bodies/arc/events and the
// satellite-dot placeholder. Painters fill the dynamic groups through
// the ref: the scene bridge for observer cards (PolarPlot), or
// paintPassCard in lib/passes/charts.js where there is no scene.
//
// React's reconciler doesn't touch DOM children it didn't create, so
// painters appending into `g.bodies` / `g.arc` / `g.events` don't race
// with future React renders of this component.

const INNER_R = 45;       // horizon circle radius (in viewBox units)
const ALT_RING_DEGS = [60, 30];

const PolarPlotSvg = forwardRef<SVGSVGElement, { obsId?: string }>(
  function PolarPlotSvg({ obsId }, ref) {
    return (
      <svg
        ref={ref}
        className="polar-plot"
        data-obs-id={obsId}
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
        {/* Empty groups + placeholder dot - painters fill these. */}
        <g className="bodies" />
        <g className="arc" />
        <g className="events" />
        <circle className="iss-dot" r={2.5} />
      </svg>
    );
  },
);

export default PolarPlotSvg;
