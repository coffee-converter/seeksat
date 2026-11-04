import { test } from "node:test";
import assert from "node:assert/strict";
import { ogResponse } from "../../lib/og/og-response.mjs";

test("missing ?s redirects (302) to /og.png", async () => {
  const res = await ogResponse(new Request("https://seeksat.com/api/og"));
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get("location"), "https://seeksat.com").pathname, "/og.png");
});

test("malformed ?s redirects (302) to /og.png", async () => {
  const res = await ogResponse(new Request("https://seeksat.com/api/og?s=%%%not-base64%%%"));
  assert.equal(res.status, 302);
});

import { encodeStateBlob } from "../../lib/pass-finder/state-blob.js";

test("a valid blob whose satellite has no record redirects to /og.png", async () => {
  const s = encodeStateBlob({ observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }], mode: "visual", minElevDeg: 10 });
  const res = await ogResponse(new Request(`https://seeksat.com/api/og?s=${encodeURIComponent(s)}&id=99998`),
    { getRecord: async () => null });
  assert.equal(res.status, 302);
});

test("a bad id is ignored (falls back to the ISS)", async () => {
  const s = encodeStateBlob({ observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }], mode: "visual", minElevDeg: 10 });
  const seen = [];
  await ogResponse(new Request(`https://seeksat.com/api/og?s=${encodeURIComponent(s)}&id=12abc`),
    { getRecord: async (id) => { seen.push(id); return null; } });
  await ogResponse(new Request(`https://seeksat.com/api/og?s=${encodeURIComponent(s)}&id=1000000000`),
    { getRecord: async (id) => { seen.push(id); return null; } });
  assert.deepEqual(seen, [25544, 25544]);
});

test("the page's id param wins over the blob's satellite", async () => {
  const s = encodeStateBlob({ noradId: 33333, observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }], mode: "visual", minElevDeg: 10 });
  const seen = [];
  await ogResponse(new Request(`https://seeksat.com/api/og?s=${encodeURIComponent(s)}&id=25544`),
    { getRecord: async (id) => { seen.push(id); return null; } });
  assert.deepEqual(seen, [25544]);
});
