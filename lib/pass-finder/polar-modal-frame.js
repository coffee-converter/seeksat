// lib/pass-finder/polar-modal-frame.js — paints the static base of
// the fullscreen polar modal (header metadata, sky-shaded horizon
// disc, alt rings, az spokes + labels, cardinals) and ships the
// embedded CSS so PNG/SVG exports render standalone.
//
// Dynamic layers (constellations, stars, sun/moon, arc, events) are
// emitted as empty <g data-layer="..."> children at the end and
// filled in by other painters. Pure given (svg, obs, frameOpts).

import { SVG_NS, altAzToSvg, skyShadeRgb, skyShadeForSunAlt, chartPalette } from "./sky-helpers.js";
import { EXO2_FONT_FACE } from "./exo2-embed.js";

// CSS embedded inside the SVG so the chart still renders correctly
// when serialized to a standalone file (PNG export / right-click
// save). Page CSS in pass-finder.css covers the on-screen display,
// but a blob-loaded <img> only sees what's inside the SVG itself.
export const MODAL_SVG_STYLE = `
  .horizon { fill: rgba(4, 8, 20, 0.95); stroke: rgba(126, 184, 255, 0.55); stroke-width: 0.8; }
  /* Grid + spokes get their stroke set inline per chart, picked from
     a luminance-aware palette derived from the horizon disc shade —
     light grays on dark sky, dark grays on bright sky, asymmetric
     deltas tuned for legibility at each end. */
  .grid           { fill: none; stroke-width: 0.3; }
  .spoke          { stroke-width: 0.3; }
  .spoke-minor    { stroke-width: 0.15; }
  .spoke-cardinal { stroke-width: 0.45; }
  .cardinal { fill: #6a7a9a; font-size: 11px; letter-spacing: 0.08em; font-weight: 700; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .az-num       { fill: #6a7a9a; font-size: 4.6px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .az-num-minor { fill: #6a7a9a; font-size: 3.4px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  /* Altitude ring labels — small tick text tucked just inside the
     ring at the south spoke. Dark halo keeps the digits readable
     wherever a star or pass arc crosses. */
  .alt-num {
    fill: #6a7a9a; font-size: 2.0px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    paint-order: stroke;
    /* Thin halo (stroke is set per-label inline from the sky-shade
       palette so the outline stays subtle on bright + dark skies). */
    stroke-width: 0.3; stroke-linejoin: round;
  }
  /* Arc stroke set inline per chart (luminance-aware palette). Each
     <line> child carries its own stroke-opacity so the visual-mode
     arc can fade with apparent magnitude across the pass; radio mode
     paints all segments at a uniform opacity.
     stroke-linecap: butt is critical here — round caps on each segment
     overlap their neighbors and double the alpha at every junction,
     producing a visible bead pattern when stroke-opacity varies. */
  .arc      { fill: none; stroke-width: 1.6; stroke-linecap: butt; }
  /* Constellation outlines — deepest backdrop layer. Stroke + opacity
     are set inline per-line (palette-derived gray + sky-brightness
     scaled opacity) so they match the prevailing chart shade. */
  .const-line { stroke-width: 0.22; stroke-linecap: round; }
  /* Legend text below the chart — small, low-contrast so it reads as
     a reference key rather than competing with the chart content. */
  .legend-text {
    fill: #8aa0c8; font-size: 3.0px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  }
  .legend-heading {
    fill: #6a7a9a; font-size: 3.6px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    text-transform: uppercase; letter-spacing: 0.12em; font-weight: 600;
  }
  .iss-dot  { fill: #ffffff; stroke: #7eb8ff; stroke-width: 0.7; }
  .star-dot { }
  /* paint-order=stroke ensures the dark halo paints BEHIND the fill,
     so star names stay legible where they cross the pass arc. */
  .star-name {
    fill: #b8c4dc; font-size: 2.8px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    paint-order: stroke;
    /* halo matched to .planet-glyph (0.45) — was 0.8 which read as
       a noticeably heavier border than the glyph treatment */
    stroke: rgba(10, 14, 26, 0.85); stroke-width: 0.45; stroke-linejoin: round;
    opacity: 0.65;
  }
  .body-glyph {
    font-size: 2.3px; font-weight: 700;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  }
  /* Planet glyphs: colored astrological symbol with a thin dark halo.
     paint-order=stroke renders the stroke first so the fill paints
     over it — gives an outline effect without thickening the strokes
     inside the glyph. */
  .planet-glyph {
    font-weight: 700;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    paint-order: stroke;
    stroke: rgba(10, 14, 26, 0.85);
    stroke-width: 0.45;
    stroke-linejoin: round;
  }
  .meta-title { fill: #cfe0ff; font-size: 7px; font-weight: 700; letter-spacing: 0.04em; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .meta-sub   { fill: #8aa0c8; font-size: 5px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .meta-tz    { fill: #6a7a9a; font-size: 4px; font-style: italic; letter-spacing: 0.04em; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .event-marker { stroke: #0a0e1a; stroke-width: 0.5; opacity: 0.78; }
  /* opacity matches .event-marker so the label color reads identical
     to its companion diamond (both fills are inline style.color; the
     0.78 alpha applies the same darken to both). */
  .event-block-title { font-size: 5.2px; font-weight: 700; letter-spacing: 0.06em; font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-transform: uppercase; opacity: 0.78; }
  .event-block-time  { fill: #ffffff; font-size: 6.2px; font-family: 'SF Mono', 'Fira Code', Menlo, monospace; }
  .event-block-pos   { fill: #aab8d4; font-size: 4.6px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .bg { fill: #0a0e1a; }
  /* SeekSat wordmark + URL watermark, bottom-right corner. Exo 2 is
     embedded as base64 @font-face (EXO2_FONT_FACE) so it renders in the
     PNG export too; falls back to system sans if the font fails to load.
     Two-tone wordmark: "Seek" muted, "Sat" in the accent blue. */
  .brand-wordmark { font-family: 'Exo 2', -apple-system, BlinkMacSystemFont, sans-serif; font-weight: 600; font-size: 8px; letter-spacing: 0.01em; }
  .brand-seek { fill: #8aa0c8; }
  .brand-sat  { fill: #7eb8ff; }
  .brand-url  { font-family: 'Exo 2', -apple-system, BlinkMacSystemFont, sans-serif; font-weight: 400; font-size: 4.2px; letter-spacing: 0.07em; fill: #6a7a9a; }
`;

// Render the metadata header (title, date, coords, tz tag) + chart
// base (horizon disc, alt rings, az spokes + labels, cardinals).
// Stashes per-chart palette colors on dataset for the arc/legend
// painters to pick up. Emits empty <g> placeholders for the dynamic
// layers in z-order at the end.
//
// `opts.modalGeom` is { cx, cy, R }. `opts.tzRefMs` is the moment
// used to resolve the displayed UTC-offset tag for the observer's
// timezone (typically the pass start, so DST applies to when the
// pass actually happens — not "now"). Falls back to anchorMs.
export function paintPolarModalStatic(svg, obs, anchorMs, sunAltDeg, opts) {
  const { modalGeom, tzRefMs } = opts;
  const { cx, cy, R } = modalGeom;
  svg.replaceChildren();
  // Embedded styles — duplicated from pass-finder.css so the exported
  // standalone SVG/PNG still looks right.
  const styleEl = document.createElementNS(SVG_NS, "style");
  // Embedded Exo 2 @font-face FIRST so the wordmark rules below resolve
  // it — both on-screen and in the standalone PNG/SVG export.
  styleEl.textContent = EXO2_FONT_FACE + MODAL_SVG_STYLE;
  svg.appendChild(styleEl);
  // Background fills the entire viewBox (incl. metadata/az-number
  // margins) so the exported image isn't transparent.
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", -24); bg.setAttribute("y", -68);
  bg.setAttribute("width", 248); bg.setAttribute("height", 278);
  bg.classList.add("bg");
  svg.appendChild(bg);

  // ---- Metadata header (top of viewBox) ---------------------------
  // Title and observer details are embedded in the SVG so PNG/SVG
  // exports keep their context (observer, date, lat/lon, tz).
  const anchor = new Date(anchorMs);
  // Date is formatted in the OBSERVER's timezone too, so passes that
  // happen at local midnight don't display the user's tomorrow.
  const dateOpts = { year: "numeric", month: "short", day: "numeric" };
  if (obs.tz) dateOpts.timeZone = obs.tz;
  const dateStr = anchor.toLocaleDateString(undefined, dateOpts);
  const latHemi = obs.latDeg >= 0 ? "N" : "S";
  const lonHemi = obs.lonDeg >= 0 ? "E" : "W";
  const coordStr = `${Math.abs(obs.latDeg).toFixed(4)}°${latHemi}, `
                 + `${Math.abs(obs.lonDeg).toFixed(4)}°${lonHemi}`;
  // Resolve a "UTC±H" tag for the tz at the tzRefMs instant — pass
  // start, typically — so DST reflects the pass's actual moment, not
  // (e.g.) winter offset applied to a summer pass.
  const refMs = tzRefMs ?? anchor.getTime();
  let tzOffsetTag = "";
  if (obs.tz) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: obs.tz, timeZoneName: "shortOffset",
      }).formatToParts(new Date(refMs));
      const raw = parts.find(p => p.type === "timeZoneName")?.value ?? "";
      // "GMT-5" → "UTC-5"; "GMT" alone → "UTC"
      tzOffsetTag = raw.replace(/^GMT/, "UTC") || "";
    } catch {}
  }
  const tzStr = obs.tz
    ? (tzOffsetTag ? `times in ${obs.tz} (${tzOffsetTag})` : `times in ${obs.tz}`)
    : "times in browser local (tz lookup unavailable)";
  const titleT = document.createElementNS(SVG_NS, "text");
  titleT.setAttribute("x", cx);
  titleT.setAttribute("y", -54);
  titleT.setAttribute("text-anchor", "middle");
  titleT.classList.add("meta-title");
  // satName threaded from the scene (the selected satellite); fall back to
  // a generic title for callers that don't pass one (e.g. OG render).
  const satName = opts?.satName;
  titleT.textContent = satName
    ? `${obs.name} — ${satName} pass sky chart`
    : `${obs.name} — pass sky chart`;
  svg.appendChild(titleT);
  const subT = document.createElementNS(SVG_NS, "text");
  subT.setAttribute("x", cx);
  subT.setAttribute("y", -44);
  subT.setAttribute("text-anchor", "middle");
  subT.classList.add("meta-sub");
  subT.textContent = `${dateStr} · ${coordStr}`;
  svg.appendChild(subT);
  const tzT = document.createElementNS(SVG_NS, "text");
  tzT.setAttribute("x", cx);
  tzT.setAttribute("y", -37);
  tzT.setAttribute("text-anchor", "middle");
  tzT.classList.add("meta-tz");
  tzT.textContent = tzStr;
  svg.appendChild(tzT);

  // ---- Chart base -----------------------------------------------
  // Disc shade is twilight-aware: bright blue in daylight, deep navy
  // once the sun is well below astronomical twilight. Inline fill
  // overrides the static .horizon CSS so PNG exports carry the right
  // shade for this pass.
  const horizon = document.createElementNS(SVG_NS, "circle");
  horizon.setAttribute("cx", cx); horizon.setAttribute("cy", cy);
  horizon.setAttribute("r", R);
  horizon.classList.add("horizon");
  if (sunAltDeg != null) {
    // Inline style — `fill` as a presentation attribute loses to the
    // `.horizon` class rule, but an inline style beats class CSS.
    horizon.style.fill = skyShadeForSunAlt(sunAltDeg);
  }
  svg.appendChild(horizon);
  // Grid + spoke + arc strokes pulled from a luminance-aware palette
  // so they stay readable against whatever sky shade was just set.
  const palette = sunAltDeg != null
    ? chartPalette(sunAltDeg)
    : { grid: "#aab8d4", spoke: "#7eb8ff", minorSpoke: "#5a6f8a", arc: "#aab8d4" };
  // Azimuth spokes every 30°. Regular majors stop at 75° altitude
  // (15° zenith cap). Cardinals (N/E/S/W) extend all the way to the
  // zenith (alt=90) since the four of them just cross at the center
  // — a classic compass crosshair — rather than crowding it.
  const SPOKE_INNER_ALT = 75;
  const CARDINAL_INNER_ALT = 90;
  for (let az = 0; az < 360; az += 30) {
    const isCardinal = az % 90 === 0;
    const innerAlt = isCardinal ? CARDINAL_INNER_ALT : SPOKE_INNER_ALT;
    const [xOut, yOut] = altAzToSvg(0, az, cx, cy, R);
    const [xIn,  yIn]  = altAzToSvg(innerAlt, az, cx, cy, R);
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", xIn.toFixed(2));  l.setAttribute("y1", yIn.toFixed(2));
    l.setAttribute("x2", xOut.toFixed(2)); l.setAttribute("y2", yOut.toFixed(2));
    l.classList.add(isCardinal ? "spoke-cardinal" : "spoke");
    // Cardinals get the same gray as the altitude rings and regular
    // spokes — just thicker, not brighter. That's enough to read as
    // the chart's primary orientation cue without competing with the
    // pass arc for contrast attention.
    l.style.stroke = palette.spoke;
    svg.appendChild(l);
  }
  // Minor spokes every 15° (offset from majors), only along the outer
  // chart — from horizon up to 60° altitude. Near the horizon the
  // major spokes are far apart in chart units and a finer azimuth
  // grid is useful; the inner zenith cap stays uncluttered. Drawn
  // thinner AND fainter than the major spokes so they read as
  // secondary structural lines.
  const MINOR_SPOKE_INNER_ALT = 45;
  for (let az = 15; az < 360; az += 30) {
    const [xOut, yOut] = altAzToSvg(0, az, cx, cy, R);
    const [xIn,  yIn]  = altAzToSvg(MINOR_SPOKE_INNER_ALT, az, cx, cy, R);
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", xIn.toFixed(2));  l.setAttribute("y1", yIn.toFixed(2));
    l.setAttribute("x2", xOut.toFixed(2)); l.setAttribute("y2", yOut.toFixed(2));
    l.classList.add("spoke-minor");
    l.style.stroke = palette.minorSpoke;
    svg.appendChild(l);
  }
  // Altitude rings: 30°, 60°
  for (const altRing of [60, 30]) {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", cx); c.setAttribute("cy", cy);
    c.setAttribute("r", ((90 - altRing) / 90) * R);
    c.classList.add("grid");
    c.style.stroke = palette.grid;
    svg.appendChild(c);
    // Ring label tucked just east of the N-S line and clearly above
    // each ring (not touching). Positioned in SVG pixel space (not in
    // az/alt) so every ring sits the same screen distance from the
    // cardinal — azimuth-based placement looked progressively farther
    // on rings closer to the horizon.
    const ringR = ((90 - altRing) / 90) * R;
    const labelX = cx + 0.8;
    const labelY = cy + ringR - 1.4;  // ~1.4px clearance above ring
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", labelX.toFixed(2));
    t.setAttribute("y", labelY.toFixed(2));
    t.setAttribute("text-anchor", "start");
    t.setAttribute("dominant-baseline", "auto");
    t.classList.add("alt-num");
    // Sky-shade-aware fill + halo. Fill is computed inline at a
    // luminance delta between palette.grid (±45) and palette.arc
    // (±150) — splits the difference so the labels are clearly
    // readable on bright skies without shouting on dark skies.
    if (sunAltDeg != null) {
      const bg = skyShadeRgb(sunAltDeg);
      const bgLuma = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
      const delta = bgLuma >= 128 ? -90 : 80;
      const v = Math.max(0, Math.min(255, Math.round(bgLuma + delta)));
      t.style.fill = `rgb(${v}, ${v}, ${v})`;
      t.style.stroke = skyShadeForSunAlt(sunAltDeg);
      t.style.strokeOpacity = "0.9";
    }
    t.textContent = `${altRing}°`;
    svg.appendChild(t);
  }
  // Stash the arc color AND the sky disc shade on the SVG root so
  // paintPolarModalArc + paintPolarModalLegend can pick them up
  // without recomputing the palette.
  svg.dataset.arcStroke = palette.arc;
  if (sunAltDeg != null) svg.dataset.skyShade = skyShadeForSunAlt(sunAltDeg);
  // Cardinal labels — sky-chart convention (E LEFT, W RIGHT) with
  // breathing room outside the ring.
  const cards = [
    { l: "N", x: cx,         y: cy - R - 8 },
    { l: "E", x: cx - R - 9, y: cy },
    { l: "S", x: cx,         y: cy + R + 8 },
    { l: "W", x: cx + R + 9, y: cy },
  ];
  for (const c of cards) {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", c.x); t.setAttribute("y", c.y);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("dominant-baseline", "central");
    t.classList.add("cardinal");
    t.textContent = c.l;
    svg.appendChild(t);
  }
  // Azimuth labels — radius is computed per-label so the INNER edge
  // of every label's bounding box sits the same distance from the
  // horizon ring, regardless of label width or position around the
  // chart. Without this, "30°" near North reads close to the ring
  // (only its short edge points inward) while "120°" near East reads
  // far away (its wide edge points inward).
  const placeAzLabel = (az, label, klass, fontPx, gap) => {
    // Approximate text bbox at this font size. 0.55 captures sans-
    // serif average glyph width well enough to keep within ±0.5px.
    const w = label.length * fontPx * 0.55;
    const h = fontPx;
    const radAz = az * Math.PI / 180;
    // Half-extent of an axis-aligned bbox projected onto the radial
    // direction = |sin(az)| * W/2 + |cos(az)|*H/2.
    const halfRadial = Math.abs(Math.sin(radAz)) * w / 2
                     + Math.abs(Math.cos(radAz)) * h / 2;
    const r = R + gap + halfRadial;
    const [x, y] = altAzToSvg(0, az, cx, cy, r);
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", x.toFixed(2));
    t.setAttribute("y", y.toFixed(2));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("dominant-baseline", "central");
    t.classList.add(klass);
    t.textContent = label;
    svg.appendChild(t);
  };
  // Major labels (non-cardinals: 30/60/120/150/210/240/300/330)
  for (let az = 30; az < 360; az += 30) {
    if (az % 90 === 0) continue;
    placeAzLabel(az, `${az}°`, "az-num", 4.6, 3.5);
  }
  // Minor labels (15° offset from majors) — smaller font, gap nearly
  // matching the majors so the two rings of labels read at similar
  // visual distance from the chart edge.
  for (let az = 15; az < 360; az += 30) {
    placeAzLabel(az, `${az}°`, "az-num-minor", 3.4, 3.2);
  }
  // Layer order: constellation lines first (deepest backdrop, faint),
  // then stars on top so the dots cover the line endpoints; then sun/
  // moon, then the pass arc and Start/Peak/End markers. Star names
  // rely on their paint-order=stroke halo to stay readable where the
  // arc crosses them.
  const constG = document.createElementNS(SVG_NS, "g");
  constG.dataset.layer = "constellations";
  svg.appendChild(constG);
  const starsG = document.createElementNS(SVG_NS, "g");
  starsG.dataset.layer = "stars";
  svg.appendChild(starsG);
  const bodiesG = document.createElementNS(SVG_NS, "g");
  bodiesG.dataset.layer = "bodies";
  svg.appendChild(bodiesG);
  // Arc is a <g> rather than a single polyline so paintPolarModalArc
  // can populate it with per-segment <line> elements — that's what
  // lets the visual-mode arc fade with apparent magnitude along the
  // pass.
  const arc = document.createElementNS(SVG_NS, "g");
  arc.classList.add("arc");
  svg.appendChild(arc);
  const eventsG = document.createElementNS(SVG_NS, "g");
  eventsG.dataset.layer = "events";
  svg.appendChild(eventsG);

  // ---- SeekSat brand watermark (bottom-right corner) --------------
  // Appended LAST so it paints above every dynamic layer. Mirrors the
  // bottom-left legend across the chart. Right-anchored ~3px in from
  // the viewBox right edge (x=224); two stacked lines (wordmark + URL).
  const brandX = 221;
  const wordmark = document.createElementNS(SVG_NS, "text");
  wordmark.setAttribute("x", brandX);
  wordmark.setAttribute("y", 200);
  wordmark.setAttribute("text-anchor", "end");
  wordmark.classList.add("brand-wordmark");
  const seek = document.createElementNS(SVG_NS, "tspan");
  seek.classList.add("brand-seek");
  seek.textContent = "Seek";
  const sat = document.createElementNS(SVG_NS, "tspan");
  sat.classList.add("brand-sat");
  sat.textContent = "Sat";
  wordmark.appendChild(seek);
  wordmark.appendChild(sat);
  svg.appendChild(wordmark);
  const url = document.createElementNS(SVG_NS, "text");
  url.setAttribute("x", brandX);
  url.setAttribute("y", 206.5);
  url.setAttribute("text-anchor", "end");
  url.classList.add("brand-url");
  url.textContent = "seeksat.com";
  svg.appendChild(url);
}
