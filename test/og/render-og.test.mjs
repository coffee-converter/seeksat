import { test } from "node:test";
import assert from "node:assert/strict";
import { renderOgPng } from "../../lib/og/render-og.mjs";
import { ISS_OMM } from "../fixtures/omm-iss.mjs";
import { ISS_TLE } from "./fixtures/iss-tle.mjs";

const decoded = {
  observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }],
  passTimeMs: null, mode: "visual", minElevDeg: 10,
};

test("renderOgPng returns a 1200x630 PNG for a decoded blob", async () => {
  const png = await renderOgPng(decoded, {
    getRecord: async () => ISS_TLE,
    nowMs: Date.parse("2026-03-01T00:00:00Z"), scanDays: 5,
  });
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test("renderOgPng throws when no station/pass", async () => {
  await assert.rejects(() => renderOgPng({ observers: [] }, { getRecord: async () => ISS_TLE }));
});

const opts = { nowMs: Date.parse("2026-03-01T00:00:00Z"), scanDays: 5 };
const isPng = (png) => assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

test("renderOgPng renders a non-ISS record via the injected getRecord", async () => {
  const seen = [];
  const png = await renderOgPng(decoded, { ...opts, noradId: 57166,
    getRecord: async (id) => { seen.push(id); return { noradId: 57166, name: "METEOR-M2 3", ...ISS_TLE }; } });
  isPng(png);
  assert.deepEqual(seen, [57166]);
});

test("renderOgPng renders an OMM-only record with a six-digit id", async () => {
  const png = await renderOgPng(decoded, { ...opts, noradId: 270001,
    getRecord: async () => ({ noradId: 270001, name: "BIG ID", omm: ISS_OMM }) });
  isPng(png);
});

// The card shades the arc with the satellite's own brightness: the same
// orbit drawn for the ISS and for a satellite with no published magnitude
// gives different pictures (the plain arc for the unknown one).
test("renderOgPng shades the arc only for a satellite with a known magnitude", async () => {
  const getRecord = async (id) => ({ ...ISS_TLE, noradId: id, name: "SAME ORBIT" });
  const iss = await renderOgPng(decoded, { ...opts, noradId: 25544, getRecord });
  const unknown = await renderOgPng(decoded, { ...opts, noradId: 270001, getRecord });
  assert.notDeepEqual(iss, unknown);
});
