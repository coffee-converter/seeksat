// lib/pass-finder/polar-events.js — fullscreen polar-modal event
// painter: start / peak / end markers on the sky chart, with an
// info row beneath the chart showing time · alt · az per event.
//
// Pulled out so the scene file doesn't have to host the diamond
// geometry, the overlap-split logic, and the row-layout constants
// alongside everything else. Pure given (svg, obs, peakMs, win) +
// a `deps` bag that threads scene-coupled bits (modalGeom,
// issEcefAtFn, polarArcColor).

import { SVG_NS, altAzToSvg } from "./sky-helpers.js";
import { issAltAzDeg, issAltitudeDeg } from "./visibility.js";

// Pass-event annotation: small colored diamond on the chart at each
// of start / peak / end, plus a 3-column info row BELOW the chart
// with time · alt · az for each. Colors visually tie the chart
// markers to the matching info block (teal=start, gold=peak, red=end).
export const EVENT_STYLE = [
  { label: "Start", color: "#34d399" }, // green
  { label: "Peak",  color: "#facc15" }, // gold
  { label: "End",   color: "#f87171" }, // red
];
// Info-row column centers (chosen to span the viewBox with breathing
// room: viewBox spans x = -24..224, so left/mid/right at 20/100/180).
export const EVENT_COLS = [20, 100, 180];
// Top placement: events row sits between the tz line (y=-37) and the
// chart's cardinal N (y=2), with breathing room on both sides.
export const EVENT_ROW_TITLE_Y = -25;
export const EVENT_ROW_TIME_Y  = -17;
export const EVENT_ROW_POS_Y   = -9;

// Diamond-marker geometry. A diamond at (cx, cy) with half-extent r
// is rotated by `ang` so its long diagonal points ALONG the path —
// gives the marker a sense of direction. Vertices in marker-local
// (before rotation): forward (+r,0), perp (0,+r), backward (−r,0),
// anti-perp (0,−r). After rotating each by `ang`:
export function diamondVerts(cx, cy, r, ang) {
  const cosA = Math.cos(ang), sinA = Math.sin(ang);
  return {
    fwd:  [cx + r * cosA,  cy + r * sinA],
    perp: [cx - r * sinA,  cy + r * cosA],
    back: [cx - r * cosA,  cy - r * sinA],
    anti: [cx + r * sinA,  cy - r * cosA],
  };
}

export function diamondPath(cx, cy, r, ang) {
  const v = diamondVerts(cx, cy, r, ang);
  return `M ${v.fwd[0].toFixed(2)},${v.fwd[1].toFixed(2)} `
       + `L ${v.perp[0].toFixed(2)},${v.perp[1].toFixed(2)} `
       + `L ${v.back[0].toFixed(2)},${v.back[1].toFixed(2)} `
       + `L ${v.anti[0].toFixed(2)},${v.anti[1].toFixed(2)} Z`;
}

// Split diamond: divided by its perpendicular diagonal into two
// triangles. Returns the two halves + the full outline so the caller
// can stack fill (per half) + stroke (full outline) in one place.
export function splitDiamondPaths(cx, cy, r, ang) {
  const v = diamondVerts(cx, cy, r, ang);
  const tri = (a, b, c) =>
    `M ${a[0].toFixed(2)},${a[1].toFixed(2)} `
    + `L ${b[0].toFixed(2)},${b[1].toFixed(2)} `
    + `L ${c[0].toFixed(2)},${c[1].toFixed(2)} Z`;
  return {
    forward:  tri(v.fwd,  v.perp, v.anti),
    backward: tri(v.back, v.perp, v.anti),
    full: `M ${v.fwd[0].toFixed(2)},${v.fwd[1].toFixed(2)} `
        + `L ${v.perp[0].toFixed(2)},${v.perp[1].toFixed(2)} `
        + `L ${v.back[0].toFixed(2)},${v.back[1].toFixed(2)} `
        + `L ${v.anti[0].toFixed(2)},${v.anti[1].toFixed(2)} Z`,
  };
}

// Path-tangent direction (unit vector in SVG coords) for the ISS arc
// at time `ms`, sampled by finite difference. Used to orient the
// split of overlapping event-marker diamonds so the "earlier" half
// sits on the side the path came from and "later" on the side it
// heads toward. Returns null if either sample falls below the
// horizon or off-chart.
export function pathTangentSvg(obs, ms, modalGeom, issEcefAtFn) {
  const DT = 2000; // ±2s window — fine enough for a well-defined tangent
  const ePrev = issEcefAtFn(new Date(ms - DT));
  const eNext = issEcefAtFn(new Date(ms + DT));
  if (!ePrev || !eNext) return null;
  const p1 = issAltAzDeg(obs, ePrev);
  const p2 = issAltAzDeg(obs, eNext);
  if (p1.alt < 0 || p2.alt < 0) return null;
  const [x1, y1] = altAzToSvg(p1.alt, p1.az, modalGeom.cx, modalGeom.cy, modalGeom.R);
  const [x2, y2] = altAzToSvg(p2.alt, p2.az, modalGeom.cx, modalGeom.cy, modalGeom.R);
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  return { x: dx / len, y: dy / len };
}

// ms timestamp of the apparent-alt peak for a window at observer obs.
// 240-sample sweep is overkill spatially but cheap and lets the same
// peak anchor the sky backdrop, so any non-monotonic edge case lands
// on the same point as the event marker.
export function passPeakMs(w, obs, issEcefAtFn) {
  const SAMPLES = 240;
  let peakMs = w.startMs, peakAlt = -Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = w.startMs + (w.endMs - w.startMs) * i / SAMPLES;
    const e = issEcefAtFn(new Date(t));
    if (!e) continue;
    const a = issAltitudeDeg(obs, e);
    if (a > peakAlt) { peakAlt = a; peakMs = t; }
  }
  return peakMs;
}

export function paintPolarModalEvents(svg, obs, peakMs, win, deps) {
  const eventsG = svg.querySelector('[data-layer="events"]');
  if (!eventsG) return;
  eventsG.replaceChildren();
  if (!win) return;
  const { modalGeom, issEcefAtFn, polarArcColor } = deps;
  const eventTimes = [win.startMs, peakMs, win.endMs];
  const { cx, cy, R } = modalGeom;

  // ---- Compute positions for all three events --------------------
  const pts = eventTimes.map((ms, i) => {
    const style = EVENT_STYLE[i];
    const e = issEcefAtFn(new Date(ms));
    if (!e) return { ms, style, valid: false };
    const { alt, az } = issAltAzDeg(obs, e);
    const altClamped = Math.max(0, alt);
    const valid = alt >= -0.5;
    const [x, y] = altAzToSvg(altClamped, az, cx, cy, R);
    return { ms, style, valid, alt: altClamped, az, x, y };
  });

  // ---- Marker rendering with overlap handling --------------------
  // Markers are DIAMONDS so they're visually distinct from the
  // circular sun/moon discs. If two adjacent events (start↔peak or
  // peak↔end) land within one diamond extent of each other, render
  // a SPLIT diamond — rotated to align one of its diagonals with the
  // path tangent, then cut by the perpendicular diagonal into two
  // triangles. Earlier-color sits on the inbound side, later-color
  // on the outbound side.
  const MARKER_R = 2.4;
  const OVERLAP_THRESHOLD = 2 * MARKER_R + 0.5;
  const consumed = new Set();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (!a.valid || !b.valid) continue;
    if (Math.hypot(b.x - a.x, b.y - a.y) >= OVERLAP_THRESHOLD) continue;
    const midMs = (a.ms + b.ms) / 2;
    let dir = pathTangentSvg(obs, midMs, modalGeom, issEcefAtFn);
    if (!dir) {
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      dir = { x: dx / len, y: dy / len };
    }
    const ang = Math.atan2(dir.y, dir.x);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const sd = splitDiamondPaths(mx, my, MARKER_R, ang);
    // Inbound (backward) triangle gets the earlier event color.
    const back = document.createElementNS(SVG_NS, "path");
    back.classList.add("event-marker");
    back.setAttribute("d", sd.backward);
    back.setAttribute("fill", a.style.color);
    back.setAttribute("stroke", "none");
    eventsG.appendChild(back);
    // Outbound (forward) triangle gets the later event color.
    const front = document.createElementNS(SVG_NS, "path");
    front.classList.add("event-marker");
    front.setAttribute("d", sd.forward);
    front.setAttribute("fill", b.style.color);
    front.setAttribute("stroke", "none");
    eventsG.appendChild(front);
    // Outer diamond outline so the split shape carries the same dark
    // edge as un-split markers.
    const ring = document.createElementNS(SVG_NS, "path");
    ring.classList.add("event-marker");
    ring.setAttribute("d", sd.full);
    ring.setAttribute("fill", "none");
    eventsG.appendChild(ring);
    consumed.add(i); consumed.add(i + 1);
  }
  pts.forEach((p, i) => {
    if (!p.valid || consumed.has(i)) return;
    let dir = pathTangentSvg(obs, p.ms, modalGeom, issEcefAtFn);
    if (!dir) dir = { x: 1, y: 0 };
    const ang = Math.atan2(dir.y, dir.x);
    const m = document.createElementNS(SVG_NS, "path");
    m.classList.add("event-marker");
    m.setAttribute("d", diamondPath(p.x, p.y, MARKER_R, ang));
    m.setAttribute("fill", p.style.color);
    eventsG.appendChild(m);
  });

  // ---- Info row beneath the chart (one column per event) ---------
  // Info-row diamonds are IDENTICAL to chart markers (same size,
  // unrotated — "along the path" of the horizontal info row), each
  // sitting just left of its centered label. Two gray segments
  // connect "right of START text" → "left of PEAK diamond" and
  // "right of PEAK text" → "left of END diamond", mirroring the
  // chart's path-arc thickness/color/alpha so the row reads as a
  // mini route line of the pass.
  const INFO_DIAMOND_R = MARKER_R;
  const INFO_DIAMOND_Y = EVENT_ROW_TITLE_Y - 2;
  // Gap between the label glyphs and the diamond beside them (kept
  // tight so the diamond reads as belonging to that label).
  const INFO_LABEL_GAP = 1.8;
  // Two separate breathing-room gaps for the connector line: between
  // the previous label's right edge and the line start, and between
  // the line end and the next diamond's left vertex. Matching them
  // makes the segment look centered between text and diamond.
  const LINE_TEXT_GAP = 3.2;
  const LINE_DIAMOND_GAP = 2.6;
  // Approx half-width of an uppercase label rendered at the title
  // CSS (5.2px, letter-spacing 0.06em). Empirical constant scales
  // with character count — exact measurement would require getBBox
  // after the title is in the DOM, which adds layout cost we don't
  // need at this scale.
  const halfTextWidth = (label) => label.length * 1.85;
  const diamondCx = (i) =>
    EVENT_COLS[i] - halfTextWidth(EVENT_STYLE[i].label)
                  - INFO_LABEL_GAP - INFO_DIAMOND_R;
  for (let i = 0; i < pts.length - 1; i++) {
    const x1 = EVENT_COLS[i] + halfTextWidth(EVENT_STYLE[i].label) + LINE_TEXT_GAP;
    const x2 = diamondCx(i + 1) - INFO_DIAMOND_R - LINE_DIAMOND_GAP;
    if (x2 <= x1) continue;
    const ln = document.createElementNS(SVG_NS, "line");
    ln.setAttribute("x1", x1);
    ln.setAttribute("y1", INFO_DIAMOND_Y);
    ln.setAttribute("x2", x2);
    ln.setAttribute("y2", INFO_DIAMOND_Y);
    ln.setAttribute("stroke", polarArcColor);
    ln.setAttribute("stroke-width", "1.6");
    ln.setAttribute("stroke-linecap", "round");
    ln.setAttribute("opacity", "0.65");
    eventsG.appendChild(ln);
  }
  pts.forEach((p, i) => {
    const ms = p.ms;
    const style = p.style;
    const altClamped = p.alt ?? 0;
    const az = p.az ?? 0;
    // ---- Info block below the chart ----
    const colX = EVENT_COLS[i];
    const timeOpts = {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    };
    if (obs.tz) timeOpts.timeZone = obs.tz;
    const timeStr = new Date(ms).toLocaleTimeString([], timeOpts);
    const altStr = `${Math.round(altClamped)}°`;
    const azStr  = `${Math.round(((az % 360) + 360) % 360)}°`;
    // Info-row diamond: identical to the chart marker (same size,
    // ang=0 so the long diagonal runs along the horizontal info-row
    // line), nudged left of the centered label by a small gap.
    const dia = document.createElementNS(SVG_NS, "path");
    dia.classList.add("event-marker");
    dia.setAttribute("d", diamondPath(
      diamondCx(i), INFO_DIAMOND_Y, INFO_DIAMOND_R, 0,
    ));
    dia.setAttribute("fill", style.color);
    eventsG.appendChild(dia);
    const title = document.createElementNS(SVG_NS, "text");
    title.classList.add("event-block-title");
    title.setAttribute("x", colX);
    title.setAttribute("y", EVENT_ROW_TITLE_Y);
    title.setAttribute("text-anchor", "middle");
    title.setAttribute("fill", style.color);
    title.textContent = style.label;
    eventsG.appendChild(title);
    const time = document.createElementNS(SVG_NS, "text");
    time.classList.add("event-block-time");
    time.setAttribute("x", colX);
    time.setAttribute("y", EVENT_ROW_TIME_Y);
    time.setAttribute("text-anchor", "middle");
    time.textContent = timeStr;
    eventsG.appendChild(time);
    const pos = document.createElementNS(SVG_NS, "text");
    pos.classList.add("event-block-pos");
    pos.setAttribute("x", colX);
    pos.setAttribute("y", EVENT_ROW_POS_Y);
    pos.setAttribute("text-anchor", "middle");
    pos.textContent = `alt ${altStr} · az ${azStr}`;
    eventsG.appendChild(pos);
  });
}
