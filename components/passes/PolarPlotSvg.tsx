"use client";

import { forwardRef } from "react";

// The small polar plot's static skeleton: horizon disc, 30°/60° altitude
// rings, cardinal labels, empty groups for bodies/arc/events and the
// satellite-dot placeholder. Painters fill the dynamic groups through
// the ref: the scene bridge for observer cards (PolarPlot), or
// paintPassCard in lib/passes/card-chart.js where there is no scene.
//
// React's reconciler doesn't touch DOM children it didn't create, so
// painters appending into `g.bodies` / `g.arc` / `g.events` don't race
// with future React renders of this component.

const INNER_R = 45;       // horizon circle radius (in viewBox units)
const ALT_RING_DEGS = [60, 30];
/** What the plot shows, as its accessible name and hover title. */
export const POLAR_CAPTION = "Looking up (east on the left)";
/** The pass card's plot: a compass, as the map and the live view are. */
export const COMPASS_CAPTION = "Compass view (north up)";

const PolarPlotSvg = forwardRef<SVGSVGElement, { obsId?: string }>(
  function PolarPlotSvg({ obsId }, ref) {
    return (
      <svg
        ref={ref}
        className="polar-plot"
        data-obs-id={obsId}
        viewBox="0 0 100 100"
        role="img"
        aria-label={COMPASS_CAPTION}
      >
        <title>{COMPASS_CAPTION}</title>
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
        {/* Cardinal labels: N top, E RIGHT, W LEFT, as a compass (the map
            and the live view). Painters draw in the sky-chart projection
            (altAzToSvg, E left), so their groups are mirrored left to right
            below. Positioned just outside the horizon ring; CSS sets
            overflow: visible so they render past the viewBox. */}
        <text className="cardinal" x={50}  y={-2}  textAnchor="middle" dominantBaseline="central">N</text>
        <text className="cardinal" x={102} y={50}  textAnchor="middle" dominantBaseline="central">E</text>
        <text className="cardinal" x={50}  y={102} textAnchor="middle" dominantBaseline="central">S</text>
        <text className="cardinal" x={-2}  y={50}  textAnchor="middle" dominantBaseline="central">W</text>
        {/* Empty groups + placeholder dot - painters fill these. */}
        <g transform="matrix(-1 0 0 1 100 0)">
          <g className="bodies" />
          <g className="arc" />
          <g className="events" />
          <circle className="iss-dot" r={2.5} />
        </g>
      </svg>
    );
  },
);

export default PolarPlotSvg;
