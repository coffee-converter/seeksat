"use client";

import { useEffect, useRef } from "react";
import { type PassObserver } from "@/lib/pass-finder-store";
import { paintPolarPlot } from "@/lib/scene-bridge";
import PolarPlotSvg from "./PolarPlotSvg";

// Polar plot SVG that lives inside each ObserverCard. PolarPlotSvg
// renders the static skeleton; the scene bridge's paintPolarPlot fills
// the dynamic groups (sun / moon, ISS arc, start/peak/end markers,
// current ISS-dot position). Per-frame ISS-dot updates continue to walk
// all .polar-plot[data-obs-id="..."] SVGs in the DOM, so the skeleton
// keeps those attributes.
export default function PolarPlot({ obs }: { obs: PassObserver }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    paintPolarPlot(svg, obs.id);
  }, [obs.id]);

  return <PolarPlotSvg ref={svgRef} obsId={obs.id} />;
}
