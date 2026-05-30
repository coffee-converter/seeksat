// lib/og/dom.mjs — a lightweight server-side DOM so the pass-finder's
// DOM-based SVG painters (which call the global `document`, classList,
// dataset, style, querySelector…) run in Node, both in the build script
// and the serverless OG route.
//
// Uses linkedom rather than jsdom: jsdom's dependency tree (via
// html-encoding-sniffer → @exodus/bytes) hits an ESM/CJS `require()`
// incompatibility on Vercel's Node runtime that crashes the /api/og
// function at module load (ERR_REQUIRE_ESM — every request 500s before
// the handler runs). linkedom is ESM-native, far lighter, and
// purpose-built for headless DOM manipulation + serialization.
// Importing this module installs the global `document` once; each render
// creates its own <svg> via newSvgRoot, so concurrent renders never
// share element state (document is only an element factory here).
import { parseHTML } from "linkedom";

export const SVG_NS = "http://www.w3.org/2000/svg";

const { document } = parseHTML("<!doctype html><html><body></body></html>");
globalThis.document = globalThis.document ?? document;

export function newSvgRoot(viewBox) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  return svg;
}

export function serialize(svgEl) {
  return svgEl.toString();
}
