// lib/passes/geo-motion.mjs - how much a geosynchronous satellite moves in
// your sky over a day, from engine.mjs stationaryPointing: station-kept ones
// hold within about 0.1 deg, older drifting ones wander a degree or two, and
// inclined ones (SDO) trace a loop tens of degrees across that a dish must
// follow. One rule for the satellite page and the MCP server.

/** Larger of the elevation and azimuth ranges, in degrees, still read as fixed. */
export const FIXED_SPAN_DEG = 0.5;
/** ... and as nearly fixed. */
export const NEARLY_FIXED_SPAN_DEG = 3;

/** The day's azimuth range, across north without wrapping. */
export function azSpanDeg(p) {
  if (p?.azMinDeg == null || p?.azMaxDeg == null) return 0;
  return (((p.azMaxDeg - p.azMinDeg) % 360) + 360) % 360;
}

/** 'fixed', 'nearly' or 'moving', for a stationaryPointing entry. */
export function geoMotion(p) {
  const span = Math.max((p?.elMaxDeg ?? 0) - (p?.elMinDeg ?? 0), azSpanDeg(p));
  return span <= FIXED_SPAN_DEG ? 'fixed' : span <= NEARLY_FIXED_SPAN_DEG ? 'nearly' : 'moving';
}
