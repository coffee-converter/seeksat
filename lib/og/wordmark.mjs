// lib/og/wordmark.mjs - the two-tone Exo 2 SeekSat wordmark and the URL for
// the share cards, drawn as outlines (lib/og/wordmark-paths.mjs): resvg does
// not draw the Exo 2 subset, so as text they fell back to Atkinson.

import { WORDMARK_PATHS as P } from './wordmark-paths.mjs';

const scaleOf = (size) => size / P.unitsPerEm;

/** Left edge for a run `width` font units wide at `size` px, anchored at x. */
function leftOf(x, width, size, anchor) {
  const w = width * scaleOf(size);
  return anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
}

const f = (n) => Math.round(n * 1000) / 1000;

/** One run's glyphs, each moved to its x, as paths in font units. */
// `gap` is extra space after each glyph, in font units (CSS letter-spacing).
const glyphs = (run, fill, gap = 0, from = 0) => run.map(([x, d], i) =>
  `<path transform="translate(${f(x + (from + i) * gap)} 0)" fill="${fill}" d="${d}"/>`).join('');

/** "Seek" in seekFill and "Sat" in satFill, baseline at y, `size` px per em. */
export function wordmarkSvg({ x, y, size, anchor = 'start', seekFill, satFill, letterSpacing = 0 }) {
  const s = scaleOf(size);
  const gap = letterSpacing / s;
  const n = P.seek.length + P.sat.length;
  const t = `translate(${f(leftOf(x, P.width + gap * (n - 1), size, anchor))} ${f(y)}) scale(${f(s)} ${f(-s)})`;
  return `<g transform="${t}">${glyphs(P.seek, seekFill, gap)}${glyphs(P.sat, satFill, gap, P.seek.length)}</g>`;
}

/** "seeksat.com" in Exo 2 Regular, baseline at y. */
export function wordmarkUrlSvg({ x, y, size, anchor = 'start', fill, letterSpacing = 0 }) {
  const s = scaleOf(size);
  const gap = letterSpacing / s;
  const t = `translate(${f(leftOf(x, P.urlWidth + gap * (P.url.length - 1), size, anchor))} ${f(y)}) scale(${f(s)} ${f(-s)})`;
  return `<g transform="${t}">${glyphs(P.url, fill, gap)}</g>`;
}
