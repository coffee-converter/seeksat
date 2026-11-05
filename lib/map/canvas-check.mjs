// lib/map/canvas-check.mjs - is the map's canvas drawn at its box's size and
// shape? MapLibre keeps them together as its container resizes; this is the
// check that they really are (a phone once showed the globe stretched into an
// egg on a first visit). FlatMap refits the map and reports when it fails.

/** Pixels the canvas may differ from its box (a resize is mid-flight). */
const SLACK_PX = 2;
/** Relative difference in width/height ratio that counts as stretched. */
const SLACK_RATIO = 0.02;

const ratioOff = (aw, ah, bw, bh) => Math.abs((aw / ah) / (bw / bh) - 1) > SLACK_RATIO;

/**
 * What is wrong, as a short line for a report, or null when the canvas fits.
 * Null too when anything is zero or missing (hidden, or not drawn yet).
 * @param {{ boxW: number, boxH: number, cssW: number, cssH: number,
 *   bufW: number, bufH: number, drawW?: number | null, drawH?: number | null }} s
 *   box and css in CSS px (the container, the canvas as shown); buf the
 *   canvas's pixel size; draw the WebGL drawing buffer's, when known.
 */
export function canvasMismatch({ boxW, boxH, cssW, cssH, bufW, bufH, drawW = null, drawH = null }) {
  if (![boxW, boxH, cssW, cssH, bufW, bufH].every((v) => Number.isFinite(v) && v > 0)) return null;
  const drawKnown = Number.isFinite(drawW) && Number.isFinite(drawH) && drawW > 0 && drawH > 0;
  const wrong = [];
  if (Math.abs(boxW - cssW) > SLACK_PX || Math.abs(boxH - cssH) > SLACK_PX) wrong.push('size');
  if (ratioOff(bufW, bufH, cssW, cssH)) wrong.push('aspect');
  if (drawKnown && ratioOff(drawW, drawH, bufW, bufH)) wrong.push('buffer');
  if (!wrong.length) return null;
  const r = Math.round;
  return `Map canvas ${wrong.join('+')}: box ${r(boxW)}x${r(boxH)}, shown ${r(cssW)}x${r(cssH)}, pixels ${bufW}x${bufH}` +
    (drawKnown ? `, drawn ${drawW}x${drawH}` : '');
}
