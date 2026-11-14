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

// A pass that starts and ends on the horizon (min elevation 0) is about half
// a degree below it geometrically at its edges (the window uses refracted
// altitude). Its start and end markers still draw, so the direction shows.
test("start and end markers draw for a horizon-to-horizon pass", () => {
  const at = ecefAtFactory(ISS_TLE);
  const sel = selectPass(
    { observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }],
      passTimeMs: null, mode: "radio", minElevDeg: 0 },
    at, { nowMs: Date.parse("2026-03-01T00:00:00Z"), scanDays: 5 });
  const svg = renderPassChartSVG({ ...sel, ecefAt: at });
  // Three on the chart plus the three info-row diamonds; before, only the
  // peak drew on the chart.
  const markers = svg.match(/class="event-marker"/g) ?? [];
  assert.equal(markers.length, 6);
});

test("the full chart's watermark carries the SeekSat mark, drawn shape by shape; the cropped card drops it", async () => {
  const at = ecefAtFactory(ISS_TLE);
  const sel = selectPass(
    { observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }], passTimeMs: null, mode: "visual", minElevDeg: 10 },
    at, { nowMs: Date.parse("2026-03-01T00:00:00Z"), scanDays: 5 });
  const full = renderPassChartSVG({ ...sel, ecefAt: at, full: true });
  const mark = full.match(/<svg[^>]*class="brand-mark"[^>]*>([\s\S]*?)<\/svg>/);
  assert.ok(mark, "mark present");
  assert.equal((mark[1].match(/<circle\b/g) || []).length, 3);
  assert.equal((mark[1].match(/<path\b/g) || []).length, 2);
  assert.doesNotMatch(renderPassChartSVG({ ...sel, ecefAt: at }), /class="brand-mark"/);
  // The mark is placed from the wordmark's real width, which the share cards' outlines also hold.
  const { WORDMARK_EM_WIDTH } = await import("../../lib/pass-finder/brand-mark.js");
  const { WORDMARK_PATHS } = await import("../../lib/og/wordmark-paths.mjs");
  assert.equal(WORDMARK_EM_WIDTH, WORDMARK_PATHS.width);
});
