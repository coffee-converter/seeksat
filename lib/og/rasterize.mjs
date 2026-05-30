// lib/og/rasterize.mjs — SVG card -> PNG via @resvg/resvg-js. The server
// has no system fonts, so we load the bundled buffers explicitly:
// Arimo (chart labels + tagline) via defaultFontFamily, Exo 2 (wordmark)
// by name. resvg renders the chart's class-based <style> CSS natively.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const FONT_DIR = fileURLToPath(new URL("./fonts/", import.meta.url));
const FONT_BUFFERS = [
  "Arimo-Regular.ttf", "Arimo-Bold.ttf", "Exo2-Regular.ttf", "Exo2-SemiBold.ttf",
].map((f) => readFileSync(FONT_DIR + f));

export async function rasterizeCard(cardSVG) {
  const resvg = new Resvg(cardSVG, {
    fitTo: { mode: "width", value: 1200 },
    font: { loadSystemFonts: false, fontBuffers: FONT_BUFFERS, defaultFontFamily: "Arimo" },
  });
  return Buffer.from(resvg.render().asPng());
}
