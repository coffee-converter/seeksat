// scripts/build-icons.mjs - write the site icons from the two hand-drawn
// marks below (no network, no orbit data):
//
//   COMPASS (A2)  the pass card's sky plot, simplified: rim, a faint inner
//                 ring, one bold pass with its rise ring and set arrow.
//   SMALL (A16)   the same with only the disc and the arc, for 16 and 32 px,
//                 where the ring and arrow would blur.
//
// Outputs:
//   public/icon.svg               COMPASS, for the manifest (any size)
//   app/icon1.png, app/icon2.png  SMALL at 16 and 32 px: browsers pick these
//                                 for tabs (Next links them with their sizes)
//   app/icon3.png                 COMPASS at 48 px
//   app/favicon.ico               SMALL at 16 and 32, COMPASS at 48 and 64,
//                                 for clients that ask for /favicon.ico
//   app/apple-icon.png            COMPASS on a full square, 180 px
//   public/icon-192.png, -512.png COMPASS on a full square, for the manifest
//
// Rerun after changing a mark: node scripts/build-icons.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rasterizeSvg } from "../lib/og/rasterize.mjs";
import { COMPASS, SMALL, onSquare } from "../lib/brand/marks.mjs";

/** An .ico holding PNG images (each { size, png }). */
export function icoFile(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const out = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const png = (svg, size) => rasterizeSvg(svg, { width: size });

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(out("public/icon.svg"), `${COMPASS}\n`);
  const small16 = await png(SMALL, 16);
  const small32 = await png(SMALL, 32);
  const compass48 = await png(COMPASS, 48);
  const compass64 = await png(COMPASS, 64);
  writeFileSync(out("app/icon1.png"), small16);
  writeFileSync(out("app/icon2.png"), small32);
  writeFileSync(out("app/icon3.png"), compass48);
  writeFileSync(out("app/favicon.ico"), icoFile([
    { size: 16, png: small16 }, { size: 32, png: small32 }, { size: 48, png: compass48 }, { size: 64, png: compass64 },
  ]));
  writeFileSync(out("app/apple-icon.png"), await png(onSquare(COMPASS), 180));
  for (const size of [192, 512]) writeFileSync(out(`public/icon-${size}.png`), await png(onSquare(COMPASS), size));
  console.log("Wrote public/icon.svg, app/icon1-3.png, app/favicon.ico, app/apple-icon.png, public/icon-192.png, public/icon-512.png");
}
