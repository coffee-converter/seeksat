import { test } from "node:test";
import assert from "node:assert/strict";
import { firstObserver, selectPass } from "../../lib/og/pass-select.mjs";
import { issEcefAtFactory } from "../../lib/og/tle.mjs";
import { issAltAzDeg } from "../../lib/pass-finder/visibility.js";
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
  // peakMs is the window's TRUE peak: ISS altitude there ≈ maxAlt.
  assert.ok(Math.abs(issAltAzDeg(res.observer, at(new Date(res.peakMs))).alt - res.maxAlt) < 1);
});

test("explicit t locates the pass but the chart anchors on the true peak", () => {
  const at = issEcefAtFactory(ISS_TLE);
  const nowMs = Date.parse("2026-03-01T00:00:00Z");
  // First find a real pass, then pretend the sharer's t was its rise edge.
  const found = selectPass(
    { observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }],
      passTimeMs: null, mode: "visual", minElevDeg: 10 },
    at, { nowMs, scanDays: 5 });
  const riseT = found.win.startMs;                 // a non-peak moment in the pass
  const res = selectPass(
    { observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }],
      passTimeMs: riseT, mode: "visual", minElevDeg: 10 },
    at, { nowMs });
  // Same pass (window contains the shared time) ...
  assert.ok(riseT >= res.win.startMs && riseT <= res.win.endMs);
  // ... but the anchor is the true peak, not the shared rise time.
  assert.ok(res.peakMs > res.win.startMs);
  assert.ok(Math.abs(issAltAzDeg(res.observer, at(new Date(res.peakMs))).alt - res.maxAlt) < 1);
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
