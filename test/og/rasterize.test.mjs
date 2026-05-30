import { test } from "node:test";
import assert from "node:assert/strict";
import { rasterizeCard } from "../../lib/og/rasterize.mjs";

test("rasterizeCard renders a 1200x630 PNG with Exo 2 (no system fonts)", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#0a0e1a"/>
    <text x="100" y="300" font-family="Exo 2" font-weight="600" font-size="90" fill="#7eb8ff">SeekSat</text>
    <text x="100" y="380" font-family="Arimo" font-size="30" fill="#aab8d4">N 30 60 90</text>
  </svg>`;
  const png = await rasterizeCard(svg);
  assert.ok(Buffer.isBuffer(png));
  // PNG magic number.
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  // IHDR width/height (bytes 16-23) = 1200 x 630.
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
