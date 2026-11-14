// lib/pass-finder/brand-mark.js - the SeekSat mark, wordmark + URL watermark
// for the saved chart images (sky chart and radio chart). Exo 2 comes from the
// embedded @font-face (exo2-embed.js), so the PNG export, which cannot fetch
// fonts, still draws it.

import { SVG_NS } from "./sky-helpers.js";
import { EXO2_FONT_FACE } from "./exo2-embed.js";
import { COMPASS } from "../brand/marks.mjs";

/** The watermark's two type sizes, in viewBox units. */
export const BRAND_PX = { wordmark: 8, url: 4.2 };
/** From the wordmark's baseline down to the URL's. */
export const BRAND_LINE_GAP = 6.5;
/** Its width, right-anchored, at the conservative glyph advance the charts use. */
export const BRAND_WIDTH = "SeekSat".length * BRAND_PX.wordmark * 0.6;
/** "SeekSat" in Exo 2 SemiBold, in font units of 1000 per em: the share
 *  cards' WORDMARK_PATHS.width (a test keeps the two equal). */
export const WORDMARK_EM_WIDTH = 3750;
/** The mark left of the wordmark: its size and the gap, in viewBox units. */
export const BRAND_MARK = { size: 8.5, gap: 2 };
/** The wordmark as drawn: its glyphs plus letter-spacing (0.01em) between them. */
export const WORDMARK_DRAWN_WIDTH = (WORDMARK_EM_WIDTH / 1000 + 6 * 0.01) * BRAND_PX.wordmark;

/** The watermark rules. Put EXO2_FONT_FACE first in the same <style>. */
export const BRAND_STYLE = `
  /* Two-tone wordmark: "Seek" muted, "Sat" in the accent blue. Falls back to
     system sans if the embedded font fails to load. */
  .brand-wordmark { font-family: 'Exo 2', -apple-system, BlinkMacSystemFont, sans-serif; font-weight: 600; font-size: ${BRAND_PX.wordmark}px; letter-spacing: 0.01em; }
  .brand-seek { fill: #8aa0c8; }
  .brand-sat  { fill: #7eb8ff; }
  .brand-url  { font-family: 'Exo 2', -apple-system, BlinkMacSystemFont, sans-serif; font-weight: 400; font-size: ${BRAND_PX.url}px; letter-spacing: 0.07em; fill: #6a7a9a; }
`;

export { EXO2_FONT_FACE };

/** Append the mark, the wordmark and the URL, right-anchored at x, the
 *  wordmark's baseline at y: the mark sits left of the wordmark, centred on
 *  its capitals. Append it last, so it paints above everything else. */
export function paintBrandMark(svg, x, y) {
  const { size, gap } = BRAND_MARK;
  const mark = document.createElementNS(SVG_NS, "svg");
  mark.setAttribute("x", String(x - WORDMARK_DRAWN_WIDTH - gap - size));
  mark.setAttribute("y", String(y - 0.35 * BRAND_PX.wordmark - size / 2));
  mark.setAttribute("width", String(size));
  mark.setAttribute("height", String(size));
  mark.setAttribute("viewBox", "0 0 64 64");
  mark.classList.add("brand-mark");
  // Shape by shape (not innerHTML, which a server-side DOM parses as HTML).
  for (const [, tag, attrs] of COMPASS.matchAll(/<(circle|path)\b([^>]*?)\/>/g)) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [, k, v] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) el.setAttribute(k, v);
    mark.appendChild(el);
  }
  svg.appendChild(mark);
  const wordmark = document.createElementNS(SVG_NS, "text");
  wordmark.setAttribute("x", x);
  wordmark.setAttribute("y", y);
  wordmark.setAttribute("text-anchor", "end");
  wordmark.classList.add("brand-wordmark");
  for (const [cls, text] of [["brand-seek", "Seek"], ["brand-sat", "Sat"]]) {
    const span = document.createElementNS(SVG_NS, "tspan");
    span.classList.add(cls);
    span.textContent = text;
    wordmark.appendChild(span);
  }
  svg.appendChild(wordmark);
  const url = document.createElementNS(SVG_NS, "text");
  url.setAttribute("x", x);
  url.setAttribute("y", y + BRAND_LINE_GAP);
  url.setAttribute("text-anchor", "end");
  url.classList.add("brand-url");
  url.textContent = "seeksat.com";
  svg.appendChild(url);
}
