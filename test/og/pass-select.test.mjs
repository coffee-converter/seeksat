import { test } from "node:test";
import assert from "node:assert/strict";
import { firstObserver, selectPass } from "../../lib/og/pass-select.mjs";
import { issEcefAtFactory } from "../../lib/og/tle.mjs";
import { ISS_TLE } from "./fixtures/iss-tle.mjs";

test("firstObserver clamps lat/lon and trims name", () => {
  const o = firstObserver({ observers: [
    { name: "x".repeat(80), latDeg: 200, lonDeg: -400 },
  ] });
  assert.equal(o.name.length, 40);
  assert.ok(o.latDeg <= 90 && o.latDeg >= -90);
  assert.ok(o.lonDeg <= 180 && o.lonDeg >= -180);
});

test("firstObserver returns null when no valid station", () => {
  assert.equal(firstObserver({ observers: [] }), null);
  assert.equal(firstObserver(null), null);
});

test("selectPass with no t finds a real above-horizon window", () => {
  const at = issEcefAtFactory(ISS_TLE);
  const decoded = { observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }],
                    passTimeMs: null, mode: "visual", minElevDeg: 10 };
  // Bound the scan to the fixture epoch so the test is fast + deterministic.
  const res = selectPass(decoded, at, { nowMs: Date.parse("2026-03-01T00:00:00Z"), scanDays: 3 });
  assert.ok(res, "a pass should be found");
  assert.ok(res.win.endMs > res.win.startMs);
  assert.ok(res.peakMs >= res.win.startMs && res.peakMs <= res.win.endMs);
  assert.ok(res.maxAlt > 0);
});

test("selectPass ignores an absurd/out-of-range passTimeMs and falls back", () => {
  const at = issEcefAtFactory(ISS_TLE);
  const nowMs = Date.parse("2026-03-01T00:00:00Z");
  const base = { observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }],
                 mode: "visual", minElevDeg: 10 };
  for (const t of [1e18, -1, 0, nowMs + 9000 * 86400_000]) {
    const res = selectPass({ ...base, passTimeMs: t }, at, { nowMs, scanDays: 5 });
    assert.ok(res, `should fall back for t=${t}`);
    assert.notEqual(res.peakMs, t);          // did not honour the bogus t
    assert.ok(res.maxAlt > 0);               // rendered a real pass instead
  }
});
