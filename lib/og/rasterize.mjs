// lib/og/rasterize.mjs — SVG card -> PNG via @resvg/resvg-wasm. The server
// has no system fonts, so we load the bundled buffers explicitly: Arimo
// (chart labels + tagline) via defaultFontFamily, Exo 2 (wordmark) by
// name. resvg renders the chart's class-based <style> CSS natively.
//
// Why WASM, not the native @resvg/resvg-js: the native linux-x64-gnu
// binary silently drops ALL text on Vercel even when fontBuffers are
// supplied (the macOS binary renders it fine), so share-link cards came
// out as a textless disc. The WASM build is the same bytecode on every
// platform — verified locally, guaranteed identical on Vercel.
//
// Both the wasm bytes (./resvg-wasm-embed.mjs) and fonts (./fonts-embed.mjs)
// are base64-embedded modules, not files on disk: reading them with
// readFileSync(__dirname/...) breaks in the bundled serverless function
// (webpack inlines __dirname to the build path; the files aren't there at
// runtime → ENOENT). Embedding sidesteps the filesystem entirely.
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { RESVG_WASM } from "./resvg-wasm-embed.mjs";
import { FONT_BUFFERS } from "./fonts-embed.mjs";

// initWasm must run exactly once per process before any render. Cache the
// promise so concurrent first requests share a single initialisation and
// warm instances skip it.
let wasmReady = null;
function ensureWasm() {
  if (!wasmReady) wasmReady = initWasm(RESVG_WASM);
  return wasmReady;
}

export async function rasterizeCard(cardSVG) {
  await ensureWasm();
  const resvg = new Resvg(cardSVG, {
    fitTo: { mode: "width", value: 1200 },
    font: { loadSystemFonts: false, fontBuffers: FONT_BUFFERS, defaultFontFamily: "Arimo" },
  });
  return Buffer.from(resvg.render().asPng());
}
