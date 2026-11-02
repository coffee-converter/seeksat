// lib/map/palette.mjs - satellite colours and emphasis, shared by the map and the pages.
// Each slot is one hue in both themes; slot 6 is the neutral, white on the
// dark map and near-black on the light one.
// Colour-blind separation is weaker past six, so the map always labels dots.
export const SAT_PALETTE = ['#ff9b54', '#7fe5d1', '#c084fc', '#facc15', '#fb5c99', '#dec4fb', '#ffffff', '#6fa5cb'];

export const SAT_PALETTES = {
  dark: SAT_PALETTE,
  light: ['#c0501f', '#0b7d6b', '#8b3fd9', '#5d4304', '#950e4f', '#541081', '#1f2430', '#144d6e'],
};

/** focus, normal, ghost or hidden; a sat without one is focus when selected. */
export function emphasisOf(s) {
  return s.emphasis ?? (s.selected ? 'focus' : 'normal');
}
