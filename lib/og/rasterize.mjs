// lib/og/rasterize.mjs — SVG card -> PNG via @resvg/resvg-js. The server
// has no system fonts, so we load the bundled buffers explicitly:
// Arimo (chart labels + tagline) via defaultFontFamily, Exo 2 (wordmark)
// by name. resvg renders the chart's class-based <style> CSS natively.
//
// Fonts come from ./fonts-embed.mjs (base64, GENERATED) rather than from
// disk: reading TTFs with readFileSync(__dirname/...) breaks in the
// bundled Vercel function — webpack inlines __dirname to the build path
// and the files aren't there at runtime (ENOENT). Embedding sidesteps the
// filesystem entirely.
import { Resvg } from "@resvg/resvg-js";
import { FONT_BUFFERS } from "./fonts-embed.mjs";

export async function rasterizeCard(cardSVG) {
  const resvg = new Resvg(cardSVG, {
    fitTo: { mode: "width", value: 1200 },
    font: { loadSystemFonts: false, fontBuffers: FONT_BUFFERS, defaultFontFamily: "Arimo" },
  });
  return Buffer.from(resvg.render().asPng());
}
