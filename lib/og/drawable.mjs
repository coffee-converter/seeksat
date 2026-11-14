// lib/og/drawable.mjs - what the server-rendered images (share cards, the
// MCP sky chart) can draw. resvg has only the bundled fonts (lib/og/fonts):
// Latin, Latin-1 and Latin Extended-A, and a few symbols. Anything else
// (Cyrillic, Greek, CJK, Hangul...) would print as empty boxes.

const DRAWABLE = /^[ -~ -ſΔμ–—‘’“”•…−≈≤≥]*$/;

/** True when every character of text is in the bundled fonts. */
export const isDrawable = (text) => DRAWABLE.test(text ?? '');

/** "35.7°N, 139.7°E". */
export function coordsText(latDeg, lonDeg) {
  const f = (v, pos, neg) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`;
  return `${f(latDeg, 'N', 'S')}, ${f(lonDeg, 'E', 'W')}`;
}

/** A place's name for an image: the name when the fonts can draw it, else
 *  its coordinates; null for a place without a name. */
export function placeName({ name, latDeg, lonDeg }) {
  if (!name) return null;
  return isDrawable(name) ? name : coordsText(latDeg, lonDeg);
}
