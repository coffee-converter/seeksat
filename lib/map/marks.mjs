// lib/map/marks.mjs - satellite and observer mark geometry, shared by the
// painter (draw.mjs) and the label picker (labels.mjs) so they agree on
// where marks land.

/** Satellite dot radius; the focused satellite's is one larger. */
export const DOT_RADIUS = 4;
/** A ghost is a faint dot with no name. */
export const GHOST_RADIUS = 3;
/** Gap between a dot's edge and its name. */
export const NAME_GAP_PX = 5;
/** Within this many px of the right edge, a name flips to the dot's left. */
export const NAME_FLIP_PX = 90;
/** The observer crosshair's half extent (ring 5 px, arms 9 px), plus a pixel of room. */
export const OBSERVER_HALF_PX = 10;

/** Dot radius for an emphasis: focus, normal or ghost. */
export function dotRadius(emphasis) {
  return emphasis === 'ghost' ? GHOST_RADIUS : emphasis === 'focus' ? DOT_RADIUS + 1 : DOT_RADIUS;
}

/** Whether a name at x flips to the left of its dot. */
export function nameFlips(x, width) {
  return width != null && x > width - NAME_FLIP_PX;
}
