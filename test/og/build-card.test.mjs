import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCardSVG } from "../../lib/og/build-card.mjs";

test("buildCardSVG nests the chart and adds the wordmark", () => {
  const chart = `<svg viewBox="-8 -8 216 216"><circle/></svg>`;
  const card = buildCardSVG(chart);
  assert.match(card, /width="1200" height="630"/);
  assert.match(card, /Seek<\/tspan>/);
  assert.match(card, /Sat<\/tspan>/);
  assert.match(card, /font-family="Exo 2"/);
  assert.match(card, /seeksat\.com/);
  // chart nested with a placement box
  assert.match(card, /<svg x="\d+" y="\d+" width="478" height="478"/);
});
