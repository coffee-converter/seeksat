// lib/pass-finder/brand-mark.js - the SeekSat wordmark + URL watermark for
// the saved chart images (sky chart and radio chart). Exo 2 comes from the
// embedded @font-face (exo2-embed.js), so the PNG export, which cannot fetch
// fonts, still draws it.

import { SVG_NS } from "./sky-helpers.js";
import { EXO2_FONT_FACE } from "./exo2-embed.js";

/** The watermark's two type sizes, in viewBox units. */
export const BRAND_PX = { wordmark: 8, url: 4.2 };
/** From the wordmark's baseline down to the URL's. */
export const BRAND_LINE_GAP = 6.5;
/** Its width, right-anchored, at the conservative glyph advance the charts use. */
export const BRAND_WIDTH = "SeekSat".length * BRAND_PX.wordmark * 0.6;

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

/** Append the wordmark and URL, right-anchored at x, the wordmark's baseline
 *  at y. Append it last, so it paints above everything else. */
export function paintBrandMark(svg, x, y) {
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
