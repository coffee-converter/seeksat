import { test } from "node:test";
import assert from "node:assert/strict";
import { firstObserver, selectPass } from "../../lib/og/pass-select.mjs";
import { ecefAtFactory } from "../../lib/og/tle.mjs";
import { satAltAzDeg } from "../../lib/pass-finder/visibility.js";
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
  const at = ecefAtFactory(ISS_TLE);
  const decoded = { observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }],
                    passTimeMs: null, mode: "visual", minElevDeg: 10 };
  // Bound the scan to the fixture epoch so the test is fast + deterministic.
  const res = selectPass(decoded, at, { nowMs: Date.parse("2026-03-01T00:00:00Z"), scanDays: 3 });
  assert.ok(res, "a pass should be found");
  assert.ok(res.win.endMs > res.win.startMs);
  assert.ok(res.peakMs >= res.win.startMs && res.peakMs <= res.win.endMs);
  assert.ok(res.maxAlt > 0);
  // peakMs is the window's TRUE peak: ISS altitude there ≈ maxAlt.
  assert.ok(Math.abs(satAltAzDeg(res.observer, at(new Date(res.peakMs))).alt - res.maxAlt) < 1);
});

test("explicit t locates the pass but the chart anchors on the true peak", () => {
  const at = ecefAtFactory(ISS_TLE);
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
  assert.ok(Math.abs(satAltAzDeg(res.observer, at(new Date(res.peakMs))).alt - res.maxAlt) < 1);
});

test("selectPass ignores an absurd/out-of-range passTimeMs and falls back", () => {
  const at = ecefAtFactory(ISS_TLE);
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

// A GPS-like orbit (12 h period, 55 deg): passes last hours.
const GPS_TLE = {
  name: "GPS TEST",
  line1: "1 24876U 97035A   26060.50000000  .00000010  00000-0  00000+0 0  9001",
  line2: "2 24876  55.5000 100.0000 0050000  50.0000 310.0000  2.00560000 10001",
};

test("walkOptsForRecord: LEO keeps the short walk, a 12 h orbit walks up to its period", async () => {
  const { walkOptsForRecord } = await import("../../lib/og/tle.mjs");
  assert.equal(walkOptsForRecord(ISS_TLE).maxEdgeMs, 15 * 60 * 1000);
  const gps = walkOptsForRecord(GPS_TLE);
  assert.ok(Math.abs(gps.maxEdgeMs - 86_400_000 / 2.0056) < 1000);
});

test("selectPass charts the whole of an hours-long pass, not 30 minutes of it", async () => {
  const { walkOptsForRecord } = await import("../../lib/og/tle.mjs");
  const ecefAt = ecefAtFactory(GPS_TLE);
  const obs = { name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 };
  const epochMs = Date.UTC(2026, 2, 1, 12);
  let t = epochMs;
  while (satAltAzDeg(obs, ecefAt(new Date(t))).alt < 30 && t < epochMs + 86_400_000) t += 5 * 60_000;
  assert.ok(t < epochMs + 86_400_000, "no high pass found in a day");
  const sel = selectPass({ observers: [obs], passTimeMs: t, mode: "radio", minElevDeg: 10 }, ecefAt,
    { nowMs: epochMs, walk: walkOptsForRecord(GPS_TLE) });
  assert.ok(sel.win.endMs - sel.win.startMs > 2 * 3_600_000, `window ${(sel.win.endMs - sel.win.startMs) / 60000} min`);
});
