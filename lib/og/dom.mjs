// lib/og/dom.mjs — a jsdom-backed DOM so the pass-finder's DOM-based
// SVG painters (which call the global `document`, classList, dataset,
// style, querySelector…) run in Node, both in the build script and the
// serverless OG route. Importing this module installs the globals once;
// each render creates its own <svg> via newSvgRoot, so concurrent
// renders never share element state (document is only an element
// factory here).
import { JSDOM } from "jsdom";

export const SVG_NS = "http://www.w3.org/2000/svg";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.document = globalThis.document ?? dom.window.document;
globalThis.XMLSerializer = globalThis.XMLSerializer ?? dom.window.XMLSerializer;
globalThis.location = globalThis.location ?? dom.window.location;
globalThis.URLSearchParams = globalThis.URLSearchParams ?? dom.window.URLSearchParams;

export function newSvgRoot(viewBox) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  return svg;
}

export function serialize(svgEl) {
  return new XMLSerializer().serializeToString(svgEl);
}
