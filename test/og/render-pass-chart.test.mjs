import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPassChartSVG } from "../../lib/og/render-pass-chart.mjs";
import { selectPass } from "../../lib/og/pass-select.mjs";
import { ecefAtFactory } from "../../lib/og/tle.mjs";
import { ISS_TLE } from "./fixtures/iss-tle.mjs";

test("renderPassChartSVG returns a cropped chart SVG (no header/legend/bg)", () => {
  const at = ecefAtFactory(ISS_TLE);
  const sel = selectPass(
    { observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }],
      passTimeMs: null, mode: "visual", minElevDeg: 10 },
    at, { nowMs: Date.parse("2026-03-01T00:00:00Z"), scanDays: 5 });
  const svg = renderPassChartSVG({ ...sel, ecefAt: at });
  assert.match(svg, /viewBox="-8 -8 216 216"/);     // cropped to the disc
  assert.match(svg, /class="arc"/);                  // the pass arc group
  assert.match(svg, />N</);                           // cardinal label
  // Header/legend/bg ELEMENTS are gone (orphan CSS rules in <style> are
  // harmless, so we assert on rendered elements, not bare class strings).
  assert.doesNotMatch(svg, /class="meta-title"/);     // header text removed
  assert.doesNotMatch(svg, /class="legend-/);         // legend not painted
  assert.doesNotMatch(svg, /class="bg"/);             // bg rect removed
});

// The arc's solid segments' opacities (dashed runs are polylines).
const arcLineOpacities = (svg) => {
  const arc = svg.match(/<g class="arc"[^>]*>([\s\S]*?)<\/g>/)[1];
  return [...arc.matchAll(/<line\b[^>]*stroke-opacity="([\d.]+)"/g)].map((m) => m[1]);
};
const chicagoPass = () => {
  const at = ecefAtFactory(ISS_TLE);
  const sel = selectPass(
    { observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }],
      passTimeMs: null, mode: "visual", minElevDeg: 10 },
    at, { nowMs: Date.parse("2026-03-01T00:00:00Z"), scanDays: 5 });
  return { ...sel, ecefAt: at };
};

// A satellite with no published brightness is not drawn as if it were the
// ISS: its lit arc keeps the plain uniform opacity, as in the app's charts.
test("renderPassChartSVG draws a plain arc when the standard magnitude is unknown", () => {
  for (const full of [false, true]) {
    const ops = arcLineOpacities(renderPassChartSVG({ ...chicagoPass(), standardMag: null, full }));
    assert.ok(ops.length > 0);
    assert.deepEqual(new Set(ops), new Set(["0.650"]));
  }
});

test("renderPassChartSVG shades the arc by magnitude when the standard magnitude is known", () => {
  const ops = arcLineOpacities(renderPassChartSVG({ ...chicagoPass(), standardMag: -1.8 }));
  assert.ok(new Set(ops).size > 1);
  // A fainter satellite draws a fainter arc.
  const faint = arcLineOpacities(renderPassChartSVG({ ...chicagoPass(), standardMag: 1.0 }));
  const mean = (xs) => xs.reduce((s, x) => s + Number(x), 0) / xs.length;
  assert.ok(mean(faint) < mean(ops));
});
