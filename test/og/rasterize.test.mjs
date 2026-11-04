import { test } from "node:test";
import assert from "node:assert/strict";
import { rasterizeCard, rasterizeSvg } from "../../lib/og/rasterize.mjs";

test("rasterizeCard renders a 1200x630 PNG with Exo 2 (no system fonts)", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#0a0e1a"/>
    <text x="100" y="300" font-family="Exo 2" font-weight="600" font-size="90" fill="#7eb8ff">SeekSat</text>
    <text x="100" y="380" font-family="Atkinson Hyperlegible Next" font-size="30" fill="#aab8d4">N 30 60 90</text>
  </svg>`;
  const png = await rasterizeCard(svg);
  assert.ok(Buffer.isBuffer(png));
  // PNG magic number.
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  // IHDR width/height (bytes 16-23) = 1200 x 630.
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test('rasterizeSvg renders a standalone SVG to PNG bytes at the given width', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123"/></svg>';
  const png = await rasterizeSvg(svg, { width: 64 });
  assert.ok(Buffer.isBuffer(png) && png.length > 0);
  assert.equal(png.subarray(0, 4).toString('hex'), '89504e47'); // PNG magic
});

test('resvg resolves the bundled Atkinson faces (family and weight)', async () => {
  const draw = (family, weight) => rasterizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60"><rect width="300" height="60" fill="#000"/>` +
    `<text x="10" y="40" font-family="${family}" font-weight="${weight}" font-size="30" fill="#fff">Hamburg 0123</text></svg>`,
    { width: 300 });
  const a400 = await draw('Atkinson Hyperlegible Next', 400);
  const a600 = await draw('Atkinson Hyperlegible Next', 600);
  const missing = await draw('No Such Family', 400); // falls to defaultFontFamily (Atkinson)
  assert.ok(!a400.equals(a600), 'SemiBold must be a distinct face from Regular');
  assert.ok(a400.equals(missing), 'unknown family falls back to the bundled Atkinson default');
  const blank = await rasterizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60"><rect width="300" height="60" fill="#000"/></svg>`, { width: 300 });
  assert.ok(!a400.equals(blank), 'text actually rendered');
});
