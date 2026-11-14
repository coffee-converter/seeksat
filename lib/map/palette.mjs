// lib/map/palette.mjs - satellite colours and emphasis, shared by the map, the
// pages and the share images.
//
// One palette for both themes. Picked by optimisation in OKLab: the closest
// pair is as far apart as it can be in normal vision and in simulated
// deuteranopia and protanopia, every pair also differs in hue or saturation
// (not lightness alone), there is one colour per hue family (red, orange,
// yellow, green, teal, cyan, blue, violet, magenta, pink), and none sits near
// the map's observer, graticule, sun, moon or accent colours. Ordered so each
// prefix is as spread as possible: a map with three satellites gets the three
// most different colours. Slot 1 is the SeekSat orange, also the share
// images' pass colour.
//
// Each colour has at least 3:1 contrast (WCAG 1.4.11) against SAT_CASING, the
// outline drawn under every track, dot and label, so the line reads on any
// land, water, day or night beneath it.
export const SAT_PALETTE = ['#ff9b54', '#667efe', '#86efff', '#d37a97', '#f7e612', '#fa3511', '#cf9bfd', '#e90bca', '#35ddb5', '#c4f8ab'];

/** Kept per theme for callers that index by theme: the same colours in both. */
export const SAT_PALETTES = { dark: SAT_PALETTE, light: SAT_PALETTE };

/** The outline under satellite marks: the dark map's water, and near-black on
 *  the light map (the bright colours need a dark edge on pale land). */
export const SAT_CASING = { dark: '#131a26', light: '#1f2430' };

/** Labels on the light map (names, heights, time ticks): each colour darkened
 *  with its hue kept, to 4.5:1 on SAT_LABEL_HALO.light, so small text reads
 *  as dark ink on a thin light halo rather than bright text in a heavy dark
 *  outline. Same order as SAT_PALETTE. The dark map labels in the colours. */
export const SAT_LABEL_INK = ['#ac5600', '#4e61de', '#037986', '#a6526f', '#786f02', '#d52500', '#8a57b3', '#c801ad', '#037c63', '#4b7932'];

/** The halo behind satellite labels: the casing on the dark map, the light
 *  map's land colour on the light one. */
export const SAT_LABEL_HALO = { dark: SAT_CASING.dark, light: '#f2f3f0' };

/** A satellite colour's label colour on the light map (itself when it is not
 *  a palette colour). */
export function labelInkOf(color) {
  const i = SAT_PALETTE.indexOf(String(color).toLowerCase());
  return i >= 0 ? SAT_LABEL_INK[i] : color;
}

/** focus, normal, ghost or hidden; a sat without one is focus when selected. */
export function emphasisOf(s) {
  return s.emphasis ?? (s.selected ? 'focus' : 'normal');
}
