// scripts/build-og-image.mjs - write public/og.png (and og-mcp.png, the MCP
// page's): the site's own share
// image (the SeekSat wordmark over the globe, with a real upcoming ISS pass
// from a default place). Same lib/og pipeline as the live /api/og route.
//
// OG_RECORD_FILE: an orbit record (an /api/sats response or one object from
// it) to use instead of fetching one. OG_NOW: an ISO time to look for passes
// from. OBS_NAME/OBS_LAT/OBS_LON: the place.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

const opts = { home: true };
if (process.env.OG_RECORD_FILE) {
  const raw = JSON.parse(readFileSync(process.env.OG_RECORD_FILE, "utf8"));
  const record = raw.objects ? raw.objects[0] : raw;
  opts.getRecord = async () => record;
}
if (process.env.OG_NOW) opts.nowMs = Date.parse(process.env.OG_NOW);

mkdirSync(fileURLToPath(new URL("../public/", import.meta.url)), { recursive: true });
const write = async (name, o) => {
  const png = await renderOgPng(decoded, o);
  writeFileSync(fileURLToPath(new URL(`../public/${name}`, import.meta.url)), png);
  console.log(`Wrote public/${name} (${png.length} bytes)`);
};
await write("og.png", opts);
// The MCP page's card: the same globe and pass, for developers and agents.
await write("og-mcp.png", { ...opts, card: {
  // "SeekSat" in the wordmark's two tones (lib/og/globe-card.mjs), "MCP" in the text white.
  title: "SeekSat MCP",
  titleColor: "#e6ecf8",
  lines: ["Satellite passes and radio for AI agents", "Endpoint: seeksat.com/api/mcp"],
} });
