import { test } from "node:test";
import assert from "node:assert/strict";
import { renderOgPng } from "../../lib/og/render-og.mjs";
import { ISS_TLE } from "./fixtures/iss-tle.mjs";

const decoded = {
  observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }],
  passTimeMs: null, mode: "visual", minElevDeg: 10,
};

test("renderOgPng returns a 1200x630 PNG for a decoded blob", async () => {
  const png = await renderOgPng(decoded, {
    getTle: async () => ISS_TLE,
    nowMs: Date.parse("2026-03-01T00:00:00Z"), scanDays: 5,
  });
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test("renderOgPng throws when no station/pass", async () => {
  await assert.rejects(() => renderOgPng({ observers: [] }, { getTle: async () => ISS_TLE }));
});
