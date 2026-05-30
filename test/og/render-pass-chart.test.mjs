import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPassChartSVG } from "../../lib/og/render-pass-chart.mjs";
import { selectPass } from "../../lib/og/pass-select.mjs";
import { issEcefAtFactory } from "../../lib/og/tle.mjs";
import { ISS_TLE } from "./fixtures/iss-tle.mjs";

test("renderPassChartSVG returns a cropped chart SVG (no header/legend/bg)", () => {
  const at = issEcefAtFactory(ISS_TLE);
  const sel = selectPass(
    { observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }],
      passTimeMs: null, mode: "visual", minElevDeg: 10 },
    at, { nowMs: Date.parse("2026-03-01T00:00:00Z"), scanDays: 5 });
  const svg = renderPassChartSVG({ ...sel, issEcefAt: at });
  assert.match(svg, /viewBox="-8 -8 216 216"/);     // cropped to the disc
  assert.match(svg, /class="arc"/);                  // the pass arc group
  assert.match(svg, />N</);                           // cardinal label
  // Header/legend/bg ELEMENTS are gone (orphan CSS rules in <style> are
  // harmless, so we assert on rendered elements, not bare class strings).
  assert.doesNotMatch(svg, /class="meta-title"/);     // header text removed
  assert.doesNotMatch(svg, /class="legend-/);         // legend not painted
  assert.doesNotMatch(svg, /class="bg"/);             // bg rect removed
});
