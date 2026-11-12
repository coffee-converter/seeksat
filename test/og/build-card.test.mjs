import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCardSVG } from "../../lib/og/build-card.mjs";
import { wordmarkSvg } from "../../lib/og/wordmark.mjs";
import { WORDMARK_PATHS } from "../../lib/og/wordmark-paths.mjs";

test("buildCardSVG nests the chart and adds the wordmark", () => {
  const chart = `<svg viewBox="-8 -8 216 216"><circle/></svg>`;
  const card = buildCardSVG(chart);
  assert.match(card, /width="1200" height="630"/);
  // The wordmark and URL are Exo 2 outlines (resvg does not draw the font).
  assert.ok(card.includes(WORDMARK_PATHS.seek[0][1]), "Seek outlines");
  assert.ok(card.includes(WORDMARK_PATHS.url[0][1]), "URL outlines");
  assert.match(card, /fill="#8aa0c8"/);
  assert.match(card, /fill="#7eb8ff"/);
  assert.doesNotMatch(card, /font-family="Exo 2"/);
  // chart nested with a placement box
  assert.match(card, /<svg x="\d+" y="\d+" width="478" height="478"/);
});

test("the wordmark is two-tone, one path per glyph, centred when asked", () => {
  const svg = wordmarkSvg({ x: 600, y: 100, size: 100, anchor: "middle", seekFill: "#111", satFill: "#222" });
  assert.equal((svg.match(/fill="#111"/g) ?? []).length, 4, "S e e k");
  assert.equal((svg.match(/fill="#222"/g) ?? []).length, 3, "S a t");
  const left = Number(svg.match(/translate\(([-\d.]+) 100\)/)[1]);
  assert.ok(Math.abs(left - (600 - WORDMARK_PATHS.width / 20)) < 0.01, "centred on x");
});
