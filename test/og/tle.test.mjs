import { test } from "node:test";
import assert from "node:assert/strict";
import { issEcefAtFactory } from "../../lib/og/tle.mjs";
import { ISS_TLE } from "./fixtures/iss-tle.mjs";

test("issEcefAtFactory returns a finite ECEF metre triple", () => {
  const at = issEcefAtFactory(ISS_TLE);
  const e = at(new Date("2026-03-01T12:00:00Z"));
  assert.equal(e.length, 3);
  for (const v of e) assert.ok(Number.isFinite(v));
  // ISS orbital radius ~6.78e6 m from Earth centre.
  const r = Math.hypot(...e);
  assert.ok(r > 6.6e6 && r < 7.0e6, `radius ${r}`);
});
