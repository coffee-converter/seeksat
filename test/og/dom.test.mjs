import { test } from "node:test";
import assert from "node:assert/strict";
import { SVG_NS, newSvgRoot, serialize } from "../../lib/og/dom.mjs";

test("newSvgRoot returns an svg element with the given viewBox", () => {
  const svg = newSvgRoot("-8 -8 216 216");
  assert.equal(svg.getAttribute("viewBox"), "-8 -8 216 216");
  assert.equal(svg.namespaceURI, SVG_NS);
});

test("painters can use global document; serialize yields a string", () => {
  const svg = newSvgRoot("0 0 10 10");
  const c = document.createElementNS(SVG_NS, "circle");
  c.classList.add("dot"); c.setAttribute("r", "3");
  svg.appendChild(c);
  const xml = serialize(svg);
  assert.match(xml, /<circle[^>]*class="dot"[^>]*\/?>/);
  assert.match(xml, /r="3"/);
});
