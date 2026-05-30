// scripts/build-og-image.mjs — write public/og.png: the default static
// OG card, a real upcoming pass for a default location. Uses the same
// lib/og pipeline as the live /api/og route, so static and dynamic cards
// are identical in style. env OBS_NAME/OBS_LAT/OBS_LON override.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderOgPng } from "../lib/og/render-og.mjs";

const decoded = {
  observers: [{
    name: process.env.OBS_NAME || "Chicago",
    latDeg: process.env.OBS_LAT ? +process.env.OBS_LAT : 41.8781,
    lonDeg: process.env.OBS_LON ? +process.env.OBS_LON : -87.6298,
  }],
  passTimeMs: null, mode: "visual", minElevDeg: 10,
};

const out = fileURLToPath(new URL("../public/og.png", import.meta.url));
const png = await renderOgPng(decoded);
mkdirSync(fileURLToPath(new URL("../public/", import.meta.url)), { recursive: true });
writeFileSync(out, png);
console.log(`Wrote public/og.png (${png.length} bytes)`);
