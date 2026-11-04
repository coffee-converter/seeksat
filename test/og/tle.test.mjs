import { test } from "node:test";
import assert from "node:assert/strict";
import { ecefAtFactory } from "../../lib/og/tle.mjs";
import { ISS_TLE } from "./fixtures/iss-tle.mjs";

test("ecefAtFactory returns a finite ECEF metre triple", () => {
  const at = ecefAtFactory(ISS_TLE);
  const e = at(new Date("2026-03-01T12:00:00Z"));
  assert.equal(e.length, 3);
  for (const v of e) assert.ok(Number.isFinite(v));
  // ISS orbital radius ~6.78e6 m from Earth centre.
  const r = Math.hypot(...e);
  assert.ok(r > 6.6e6 && r < 7.0e6, `radius ${r}`);
});

test("getIssTle reads the mirror snapshot and never calls fetch", async (t) => {
  const { getIssTle } = await import("../../lib/og/tle.mjs");
  const fetched = [];
  t.mock.method(globalThis, "fetch", async (url) => { fetched.push(String(url)); throw new Error("no network"); });
  const reader = { getSnapshotRecord: async (id) => (id === 25544 ? { name: "ISS (ZARYA)", ...ISS_TLE } : null) };
  const tle = await getIssTle(Date.parse("2030-01-01T00:00:00Z"), reader);
  assert.equal(tle.name, "ISS (ZARYA)");
  assert.equal(tle.line1, ISS_TLE.line1);
  assert.deepEqual(fetched, []);
});

test("getIssTle falls back to the CORS mirrors, never CelesTrak", async (t) => {
  const { getIssTle } = await import("../../lib/og/tle.mjs");
  const fetched = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    fetched.push(String(url));
    return new Response(JSON.stringify({ header: "ISS (ZARYA)", line1: ISS_TLE.line1, line2: ISS_TLE.line2 }));
  });
  const reader = { getSnapshotRecord: async () => { throw new Error("blob down"); } };
  const tle = await getIssTle(Date.parse("2031-01-01T00:00:00Z"), reader);
  assert.equal(tle.line1, ISS_TLE.line1);
  assert.equal(fetched.length, 1);
  assert.ok(!fetched.some((u) => u.includes("celestrak")));
});

test("getOgRecord reads any id from the snapshot, cached per id", async (t) => {
  const { getOgRecord } = await import("../../lib/og/tle.mjs");
  t.mock.method(globalThis, "fetch", async () => { throw new Error("no network"); });
  let calls = 0;
  const reader = { getSnapshotRecord: async (id) => { calls++; return id === 25485 ? { noradId: 25485, ...ISS_TLE, name: "MOLNIYA" } : null; } };
  const now = Date.parse("2040-01-01T00:00:00Z");
  const a = await getOgRecord(25485, now, reader);
  assert.equal(a.name, "MOLNIYA");
  await getOgRecord(25485, now + 1000, reader);
  assert.equal(calls, 1);
});

test("getOgRecord throws for a missing non-ISS id without fetching", async (t) => {
  const { getOgRecord } = await import("../../lib/og/tle.mjs");
  const fetched = [];
  t.mock.method(globalThis, "fetch", async (u) => { fetched.push(String(u)); throw new Error("no"); });
  await assert.rejects(() => getOgRecord(99998, Date.now(), { getSnapshotRecord: async () => null }));
  assert.deepEqual(fetched, []);
});

test("ecefAtFactory works for an OMM-only record", async () => {
  const { ISS_OMM } = await import("../fixtures/omm-iss.mjs");
  const at = ecefAtFactory({ noradId: 270001, name: "X", omm: ISS_OMM });
  const r = Math.hypot(...at(new Date("2026-03-01T12:00:00Z")));
  assert.ok(r > 6.6e6 && r < 7.0e6);
});
