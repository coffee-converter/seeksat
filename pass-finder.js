// pass-finder.js -- ISS multi-observer pass finder.

import { parseDmsToDecimal, geodeticToEcef } from "./coords.js";
import { geocodeOne } from "./pass-finder/geocode.js";
import { fetchIssTle } from "./pass-finder/tle.js";
import { isVisibleAtAll, issAltitudeDeg, issAltAzDeg, issIlluminated, sunAltitudeDeg } from "./pass-finder/visibility.js";
import { sunPositionEcef } from "./pass-finder/sun.js";
import { findVisibilityWindows } from "./pass-finder/search.js";
import { tleOrbitTrackEcef } from "./truth.js";
import { fetchCloudForecast, cloudAt } from "./pass-finder/weather.js";
import { fetchTimezone } from "./pass-finder/timezone.js";
import { apparentAltDeg } from "./refraction.js";
import * as sat from "https://cdn.jsdelivr.net/npm/satellite.js@7.0.0/+esm";
import { makeViewer, wireSimTime } from "./viewer-setup.js";
import { wireCameraControls } from "./camera-controls.js";

const Cesium = window.Cesium;
const viewer = makeViewer("cesium-container");
wireSimTime(viewer);

window.__viewer = viewer;
console.log("Pass finder viewer ready");

// Used by entity-show callbacks to hide labels/markers that are on the far
// side of the globe from the camera. `cameraPosition` is updated each call
// before isPointVisible because the camera moves every frame.
const _occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84);
function isInFrontOfEarth(pointEcef) {
  _occluder.cameraPosition = viewer.camera.positionWC;
  return _occluder.isPointVisible(pointEcef);
}

// ---------------------------------------------------------------------------
// Task 8: Observer state + UI
// ---------------------------------------------------------------------------

const PALETTE = ["#ff9b54", "#7fe5d1", "#c084fc", "#facc15", "#f87171", "#34d399", "#a78bfa", "#fb923c"];

const state = {
  observers: [],
  clickToPlace: false,
  cloudForecasts: new Map(), // obs.id -> { startMs, hours[] } | null
};

const obsListEl = document.getElementById("obs-list");
const observerLayer = []; // Cesium entities, parallel to state.observers

// Observer id currently locked into first-person camera mode (or null).
// Declared early because renderObsList reads it during module init
// (via loadInitialObservers → addObserver → renderObsList) before the
// FPS-camera section near the bottom of the file would run.
let _fpsObserverId = null;

// Screen-space declutter for observer labels (both pin labels at the
// observer position AND alt/az midpoint labels). Recomputed each frame
// in preRender: collect screen positions of all visible labels, sort
// top-to-bottom, then greedily push each one down until it no longer
// overlaps any previously placed label. Each entity's pixelOffset
// CallbackProperty reads its dy from this map keyed by "pin:<id>" or
// "mid:<id>".
const labelOffsets = new Map();

// Approximate label box dimensions used by the declutter algorithm. Real
// widths vary with text, but a single conservative estimate is fine —
// the goal is preventing perceptible overlap, not pixel-perfect packing.
// Pin label spans 2 lines (name + clouds/sun) or 3 lines (when ISS is
// visible and alt/az/mag also appears). Reserve the worst-case 3-line
// height so the declutter algorithm avoids overlap in either state.
// HTML observer-label box: icon (30px) + gap (6px) + text + padding ≈ 220×60.
const PIN_LABEL_W = 220, PIN_LABEL_H = 60;

// Candidate offset slots (added to a label's natural pixel position) tried
// in priority order. The first slot that doesn't collide with any
// previously-placed label wins, so most labels stay at their natural
// position and only conflicting ones get bumped to a small set of nearby
// alternates — keeps every label close to its anchor (no long stack
// drift like an always-down algorithm).
const PIN_CANDIDATES = [
  { dx: 0,    dy:   0 },   // natural (upper-right of pin)
  { dx: 0,    dy:  64 },
  { dx: 0,    dy: -64 },
  { dx: 0,    dy: 128 },
  { dx: 0,    dy: -128 },
  { dx: -204, dy:   0 },   // flip to upper-left of pin
  { dx: -204, dy:  64 },
  { dx: -204, dy: -64 },
];

function newObsId() { return `obs-${Date.now()}-${Math.floor(Math.random() * 1000)}`; }

function addObserver(name, latDeg, lonDeg) {
  const idx = state.observers.length;
  const color = PALETTE[idx % PALETTE.length];
  const obs = { id: newObsId(), name: name || `Point ${idx + 1}`, color, latDeg, lonDeg };
  state.observers.push(obs);
  const ent = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lonDeg, latDeg, 0),
    point: {
      pixelSize: 12,
      color: Cesium.Color.fromCssColorString(color),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      // Render on top of geometry so the dot doesn't disappear when the
      // camera zooms in very close (depth-tested against the ground it's
      // clamped to). Visibility-behind-planet handled via the show
      // callback below, mirroring how the ISS dot and labels work.
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: new Cesium.CallbackProperty(
        () => isInFrontOfEarth(Cesium.Cartesian3.fromDegrees(lonDeg, latDeg, 0)),
        false,
      ),
    },
    // Label text + the polar-plot icon both live in an HTML overlay
    // (.observer-label inside #observer-icons), not on the Cesium
    // entity itself. That way the icon and text are one flex element
    // rather than a Cesium billboard with an HTML icon glued next to
    // it. See buildObserverLabel / per-frame update in preRender.
  });
  // Combined sightline + altitude label entity, visible only while ISS is
  // visible from THIS observer (alt >= 10°, ISS sunlit, observer in twilight).
  const obsPos = Cesium.Cartesian3.fromDegrees(lonDeg, latDeg, 0);
  // Visibility predicate evaluated per frame. Entity.show isn't reliably a
  // Property in Cesium 1.x, so we use polyline.show + label.show instead.
  const visibleNow = (time) => {
    const d = Cesium.JulianDate.toDate(time);
    const issEcef = issEcefAt(d);
    return !!(issEcef && isVisibleAtAll([obs], issEcef, d));
  };
  const visEntity = viewer.entities.add({
    position: new Cesium.CallbackProperty((time) => {
      const d = Cesium.JulianDate.toDate(time);
      const issEcef = issEcefAt(d);
      if (!issEcef) return Cesium.Cartesian3.ZERO;
      const issPos = Cesium.Cartesian3.fromElements(issEcef[0], issEcef[1], issEcef[2]);
      return Cesium.Cartesian3.midpoint(obsPos, issPos, new Cesium.Cartesian3());
    }, false),
    polyline: {
      show: new Cesium.CallbackProperty(visibleNow, false),
      positions: new Cesium.CallbackProperty((time) => {
        const d = Cesium.JulianDate.toDate(time);
        const issEcef = issEcefAt(d);
        if (!issEcef) return [obsPos, obsPos];
        return [obsPos, Cesium.Cartesian3.fromElements(issEcef[0], issEcef[1], issEcef[2])];
      }, false),
      width: 2,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.25,
        color: Cesium.Color.fromCssColorString(color),
      }),
      arcType: Cesium.ArcType.NONE,
    },
  });

  observerLayer.push({ pin: ent, visEntity });
  renderObsList();
  persistState();

  // Kick off cloud-cover forecast for this location (cached by lat/lon).
  fetchCloudForecast(latDeg, lonDeg).then(f => {
    state.cloudForecasts.set(obs.id, f);
    if (state.windows && state.windows.length) renderWindowsList();
  });

  // Resolve the observer's IANA timezone so polar-plot times can be
  // rendered in the clock someone standing at that lat/lon would
  // actually read. Browser local is used as a fallback if this fails.
  fetchTimezone(latDeg, lonDeg).then(tz => {
    if (tz) obs.tz = tz;
  });

  // If a search has been run, re-run with the new observer set.
  rerunSearchIfActive();

  return obs;
}

function removeObserver(id) {
  const idx = state.observers.findIndex(o => o.id === id);
  if (idx < 0) return;
  state.observers.splice(idx, 1);
  const entry = observerLayer[idx];
  viewer.entities.remove(entry.pin);
  viewer.entities.remove(entry.visEntity);
  observerLayer.splice(idx, 1);
  renderObsList();
  persistState();
  rerunSearchIfActive();
}

// SVG sky-chart polar plot — center = zenith, edge = horizon. ISS arc
// across the active pass window plus a live-updating dot at the current
// sim-time position.
//
// Uses the standard astronomical sky-chart convention: you're "lying
// on your back looking up." North is at the top, BUT east is on the
// LEFT and west on the RIGHT (mirrored vs. a top-down map). That's the
// effect of negating the sine of azimuth in the projection below.
const SVG_NS = "http://www.w3.org/2000/svg";

// Project alt/az onto an SVG circle of radius `R` centered at (cx,cy).
// Defaults match the small obs-card plot (100×100 viewBox, r=45 ring).
// Pass cx=cy=100, R=90 for the fullscreen modal (200×200 viewBox).
function altAzToSvg(altDeg, azDeg, cx = 50, cy = 50, R = 45) {
  const r = ((90 - altDeg) / 90) * R;
  const a = azDeg * Math.PI / 180;
  return [cx - r * Math.sin(a), cy - r * Math.cos(a)];
}

function buildPolarPlot(obs) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("polar-plot");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.dataset.obsId = obs.id;
  // Horizon disc + altitude grid rings (30°, 60°)
  const horizon = document.createElementNS(SVG_NS, "circle");
  horizon.setAttribute("cx", 50); horizon.setAttribute("cy", 50);
  horizon.setAttribute("r", 45);
  horizon.classList.add("horizon");
  svg.appendChild(horizon);
  for (const altRing of [60, 30]) {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", 50); c.setAttribute("cy", 50);
    c.setAttribute("r", ((90 - altRing) / 90) * 45);
    c.classList.add("grid");
    svg.appendChild(c);
  }
  // Cardinal labels — sky-chart convention ("looking up"): N at top,
  // BUT east on the LEFT and west on the RIGHT (matches the negated-sin
  // projection in altAzToSvg). Labels sit just outside the horizon
  // ring (which has r=45 around 50,50) so they don't crowd it; SVG
  // overflow is set to `visible` in CSS so the labels render past the
  // 0..100 viewBox.
  const cards = [
    { l: "N", x: 50,  y: -2 },
    { l: "E", x: -2,  y: 50 },  // east on LEFT
    { l: "S", x: 50,  y: 102 },
    { l: "W", x: 102, y: 50 },  // west on RIGHT
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
  // ISS arc + current-position dot (filled later, may be hidden if no
  // active pass / observer can't see ISS at current time).
  const arc = document.createElementNS(SVG_NS, "polyline");
  arc.classList.add("arc");
  arc.setAttribute("stroke", obs.color);
  svg.appendChild(arc);
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.classList.add("iss-dot");
  dot.setAttribute("r", 2.5);
  svg.appendChild(dot);
  return svg;
}

function updatePolarPlotArc(svg, obs) {
  const arc = svg.querySelector(".arc");
  const w = state.windows?.[state.activeWindowIdx];
  if (!w) { arc.setAttribute("points", ""); return; }
  const SAMPLES = 30;
  const dt = (w.endMs - w.startMs) / SAMPLES;
  const pts = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const issEcef = issEcefAt(new Date(w.startMs + dt * i));
    if (!issEcef) continue;
    const { alt, az } = issAltAzDeg(obs, issEcef);
    if (alt < 0) continue;
    const [x, y] = altAzToSvg(alt, az);
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  arc.setAttribute("points", pts.join(" "));
}

function updatePolarPlotDot(svg, obs) {
  const dot = svg.querySelector(".iss-dot");
  const d = Cesium.JulianDate.toDate(viewer.clock.currentTime);
  const issEcef = issEcefAt(d);
  if (!issEcef) { dot.style.display = "none"; return; }
  const { alt, az } = issAltAzDeg(obs, issEcef);
  if (alt < 0) { dot.style.display = "none"; return; }
  const [x, y] = altAzToSvg(alt, az);
  dot.setAttribute("cx", x.toFixed(2));
  dot.setAttribute("cy", y.toFixed(2));
  dot.style.display = "";
}

function refreshAllPolarPlotArcs() {
  for (const svg of obsListEl.querySelectorAll(".polar-plot")) {
    const obs = state.observers.find(o => o.id === svg.dataset.obsId);
    if (obs) updatePolarPlotArc(svg, obs);
  }
  refreshAllObserverIconArcs();
}

// ---------------------------------------------------------------------------
// 3D-scene observer icons: a small polar-plot SVG floats over each
// observer's pin, showing the active pass arc in observer color and
// the live ISS dot. Click → open the fullscreen modal for that
// observer. Positioned per-frame via SceneTransforms so the icons
// track the camera; hidden when an observer is behind Earth.
// ---------------------------------------------------------------------------

const iconLayerEl = document.getElementById("observer-icons");
const ICON_GEOM = { cx: 50, cy: 50, R: 42 };

function altAzToIconSvg(altDeg, azDeg) {
  const r = ((90 - altDeg) / 90) * ICON_GEOM.R;
  const a = azDeg * Math.PI / 180;
  return [ICON_GEOM.cx - r * Math.sin(a), ICON_GEOM.cy - r * Math.cos(a)];
}

function buildObserverLabel(obs) {
  const wrapper = document.createElement("div");
  wrapper.className = "observer-label";
  wrapper.dataset.obsId = obs.id;
  wrapper.title = `Open polar plot — ${obs.name}`;
  wrapper.style.setProperty("--obs-color", obs.color);
  // Click handling is done via event delegation on iconLayerEl (see
  // setup below renderObserverIcons) — any click that bubbles up
  // from any descendant of the wrapper fires openPolarModal. Wrapper
  // is still keyboard-activatable.
  wrapper.setAttribute("role", "button");
  wrapper.tabIndex = 0;
  wrapper.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      openPolarModal(obs.id);
    }
  });
  // ---- Polar-plot icon on the left ----
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("observer-label-icon");
  svg.setAttribute("viewBox", "0 0 100 100");
  const horizon = document.createElementNS(SVG_NS, "circle");
  horizon.setAttribute("cx", ICON_GEOM.cx);
  horizon.setAttribute("cy", ICON_GEOM.cy);
  horizon.setAttribute("r", ICON_GEOM.R);
  horizon.classList.add("horizon");
  svg.appendChild(horizon);
  const ring = document.createElementNS(SVG_NS, "circle");
  ring.setAttribute("cx", ICON_GEOM.cx);
  ring.setAttribute("cy", ICON_GEOM.cy);
  ring.setAttribute("r", ((90 - 60) / 90) * ICON_GEOM.R);
  ring.classList.add("grid");
  svg.appendChild(ring);
  const nTri = document.createElementNS(SVG_NS, "path");
  nTri.setAttribute("d", "M 50 2 L 57 11 L 43 11 Z");
  nTri.setAttribute("fill", "rgba(126,184,255,0.85)");
  svg.appendChild(nTri);
  const arc = document.createElementNS(SVG_NS, "polyline");
  arc.classList.add("arc");
  arc.setAttribute("stroke", obs.color);
  svg.appendChild(arc);
  wrapper.appendChild(svg);
  // ---- Text block on the right (lines populated per-frame) ----
  const textEl = document.createElement("div");
  textEl.className = "observer-label-text";
  wrapper.appendChild(textEl);
  return wrapper;
}

function updateObserverIconArc(wrapper, obs) {
  const arc = wrapper.querySelector(".observer-label-icon .arc");
  if (!arc) return;
  const w = state.windows?.[state.activeWindowIdx];
  if (!w) { arc.setAttribute("points", ""); return; }
  const SAMPLES = 30;
  const dt = (w.endMs - w.startMs) / SAMPLES;
  const pts = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const issEcef = issEcefAt(new Date(w.startMs + dt * i));
    if (!issEcef) continue;
    const { alt, az } = issAltAzDeg(obs, issEcef);
    if (alt < 0) continue;
    const [x, y] = altAzToIconSvg(alt, az);
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  arc.setAttribute("points", pts.join(" "));
}

// Rebuild the textual portion of an observer label. Mirrors the
// previous Cesium label CallbackProperty: name, then a clouds/sun
// line, then alt/az/mag whenever the ISS is currently visible from
// this observer.
function updateObserverLabelText(wrapper, obs, d, ms) {
  const textEl = wrapper.querySelector(".observer-label-text");
  if (!textEl) return;
  const lines = [obs.name];
  const f = state.cloudForecasts.get(obs.id);
  const c = f ? cloudAt(f, ms) : null;
  const sunAlt = apparentAltDeg(sunAltitudeDeg(obs, d));
  const parts2 = [];
  if (c != null) parts2.push(`${Math.round(c)}% clouds`);
  parts2.push(`sun ${Math.round(sunAlt)}°`);
  lines.push(parts2.join(" · "));
  const issEcef = issEcefAt(d);
  if (issEcef && isVisibleAtAll([obs], issEcef, d)) {
    const { alt, az } = issAltAzDeg(obs, issEcef);
    const azStr = String(Math.round(az) % 360).padStart(3, "0");
    const m = magnitudeAt(obs, issEcef, sunPositionEcef(d));
    const magStr = m == null ? "" : `  m ${m.toFixed(1)}`;
    lines.push(`alt ${alt.toFixed(1)}°  az ${azStr}°${magStr}`);
  }
  const lineEls = lines.map((t) => {
    const div = document.createElement("div");
    div.className = "line";
    div.textContent = t;
    return div;
  });
  textEl.replaceChildren(...lineEls);
}

function renderObserverIcons() {
  iconLayerEl.replaceChildren();
  for (const obs of state.observers) {
    const wrapper = buildObserverLabel(obs);
    updateObserverIconArc(wrapper, obs);
    iconLayerEl.appendChild(wrapper);
  }
}

function refreshAllObserverIconArcs() {
  for (const wrapper of iconLayerEl.children) {
    const obs = state.observers.find(o => o.id === wrapper.dataset.obsId);
    if (obs) updateObserverIconArc(wrapper, obs);
  }
}

// Use `pointerdown` instead of `click`. The HTML observer-label is
// repositioned every preRender tick (camera moves → screen-projected
// pin position moves), and `click` only fires when pointerdown and
// pointerup land on the SAME element. With the label drifting a pixel
// or two between press and release, pointerup ends up on the canvas
// (or a different element) and the click event never fires. Filter
// out non-primary buttons so right-click etc. don't open the modal.
document.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  const wrapper = ev.target?.closest?.(".observer-label");
  if (!wrapper) return;
  const id = wrapper.dataset.obsId;
  if (id) openPolarModal(id);
}, true);

// ---------------------------------------------------------------------------
// Polar-plot fullscreen modal
//
// Click any observer card's small polar plot to open a bigger version
// with bright-star dots/labels overlaid (proper alt/az for THIS observer
// at the current sim time), the active-pass arc, and the live ISS dot.
// Closes via backdrop click, X button, or Esc.
//
// The static content (rings, cardinals) gets painted once at open time;
// stars + ISS dot redraw on every preRender tick while the modal is
// open so they track the sim clock as the user scrubs.
// ---------------------------------------------------------------------------

const MODAL_GEOM = { cx: 100, cy: 100, R: 90 };
let _polarModalObsId = null;
let _polarModalImgUrl = null; // current blob URL bound to <img>
const polarModalEl = document.getElementById("polar-modal");
const polarModalSvg = polarModalEl.querySelector(".polar-modal-svg");
const polarModalImg = polarModalEl.querySelector(".polar-modal-png");

// Compute alt/az of a (unit) star direction vector for the given
// observer. Star is "at infinity" so we don't subtract observer ECEF —
// we just project the direction into the observer's ENU basis.
function starAltAzForObs(obs, starDirEcef) {
  const DEG = Math.PI / 180;
  const lat = obs.latDeg * DEG, lon = obs.lonDeg * DEG;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  const [dx, dy, dz] = starDirEcef;
  const e = -sinLon*dx + cosLon*dy;
  const n = -sinLat*cosLon*dx - sinLat*sinLon*dy + cosLat*dz;
  const u = cosLat*cosLon*dx + cosLat*sinLon*dy + sinLat*dz;
  const alt = Math.atan2(u, Math.hypot(e, n)) / DEG;
  let az = Math.atan2(e, n) / DEG;
  if (az < 0) az += 360;
  return { alt, az };
}

// CSS embedded inside the SVG so the chart still renders correctly
// when serialized to a standalone file (PNG export / right-click save).
// Page CSS in pass-finder.css covers the on-screen display, but a
// blob-loaded <img> only sees what's inside the SVG itself.
const MODAL_SVG_STYLE = `
  .horizon { fill: rgba(4, 8, 20, 0.95); stroke: rgba(126, 184, 255, 0.55); stroke-width: 0.8; }
  .grid    { fill: none; stroke: rgba(126, 184, 255, 0.18); stroke-width: 0.4; }
  .spoke   { stroke: rgba(126, 184, 255, 0.12); stroke-width: 0.3; }
  .cardinal { fill: #cfe0ff; font-size: 11px; letter-spacing: 0.08em; font-weight: 700; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .az-num   { fill: #6a7a9a; font-size: 4.6px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .arc      { fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; opacity: 0.65; }
  .iss-dot  { fill: #ffffff; stroke: #7eb8ff; stroke-width: 0.7; }
  .star-dot { }
  /* paint-order=stroke ensures the dark halo paints BEHIND the fill,
     so star names stay legible where they cross the pass arc. */
  .star-name {
    fill: #b8c4dc; font-size: 2.8px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    paint-order: stroke;
    stroke: rgba(10, 14, 26, 0.85); stroke-width: 0.8; stroke-linejoin: round;
  }
  .meta-title { fill: #cfe0ff; font-size: 7px; font-weight: 700; letter-spacing: 0.04em; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .meta-sub   { fill: #8aa0c8; font-size: 5px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .meta-tz    { fill: #6a7a9a; font-size: 4px; font-style: italic; letter-spacing: 0.04em; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .event-marker { stroke: #0a0e1a; stroke-width: 0.5; }
  .event-block-title { font-size: 5.2px; font-weight: 700; letter-spacing: 0.06em; font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-transform: uppercase; }
  .event-block-time  { fill: #ffffff; font-size: 6.2px; font-family: 'SF Mono', 'Fira Code', Menlo, monospace; }
  .event-block-pos   { fill: #aab8d4; font-size: 4.6px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .bg { fill: #0a0e1a; }
`;

function paintPolarModalStatic(svg, obs) {
  svg.replaceChildren();
  const { cx, cy, R } = MODAL_GEOM;
  // Embedded styles — duplicated from pass-finder.css so the exported
  // standalone SVG/PNG still looks right.
  const styleEl = document.createElementNS(SVG_NS, "style");
  styleEl.textContent = MODAL_SVG_STYLE;
  svg.appendChild(styleEl);
  // Background fills the entire viewBox (incl. metadata/az-number
  // margins) so the exported image isn't transparent.
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", -24); bg.setAttribute("y", -62);
  bg.setAttribute("width", 248); bg.setAttribute("height", 272);
  bg.classList.add("bg");
  svg.appendChild(bg);

  // ---- Metadata header (top of viewBox) ---------------------------
  // Title and observer details are embedded in the SVG so PNG/SVG
  // exports keep their context (observer, date, lat/lon, tz).
  const now = Cesium.JulianDate.toDate(viewer.clock.currentTime);
  // Date is formatted in the OBSERVER's timezone too, so passes that
  // happen at local midnight don't display the user's tomorrow.
  const dateOpts = { year: "numeric", month: "short", day: "numeric" };
  if (obs.tz) dateOpts.timeZone = obs.tz;
  const dateStr = now.toLocaleDateString(undefined, dateOpts);
  const latHemi = obs.latDeg >= 0 ? "N" : "S";
  const lonHemi = obs.lonDeg >= 0 ? "E" : "W";
  const coordStr = `${Math.abs(obs.latDeg).toFixed(4)}°${latHemi}, `
                 + `${Math.abs(obs.lonDeg).toFixed(4)}°${lonHemi}`;
  // Resolve a "UTC±H" tag for the tz at the pass START instant, so the
  // displayed offset reflects whatever DST rules were actually in
  // effect for the pass (and not, e.g., "winter offset" applied to a
  // summer pass).
  const refMs = state.windows?.[state.activeWindowIdx]?.startMs ?? now.getTime();
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
  titleT.textContent = `${obs.name} — ISS pass sky chart`;
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
  const horizon = document.createElementNS(SVG_NS, "circle");
  horizon.setAttribute("cx", cx); horizon.setAttribute("cy", cy);
  horizon.setAttribute("r", R);
  horizon.classList.add("horizon");
  svg.appendChild(horizon);
  // Azimuth spokes every 30°, drawn before rings so rings render on top.
  for (let az = 0; az < 360; az += 30) {
    const [x, y] = altAzToSvg(0, az, cx, cy, R);
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", cx); l.setAttribute("y1", cy);
    l.setAttribute("x2", x.toFixed(2)); l.setAttribute("y2", y.toFixed(2));
    l.classList.add("spoke");
    svg.appendChild(l);
  }
  // Altitude rings: 30°, 60°
  for (const altRing of [60, 30]) {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", cx); c.setAttribute("cy", cy);
    c.setAttribute("r", ((90 - altRing) / 90) * R);
    c.classList.add("grid");
    svg.appendChild(c);
  }
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
  // Azimuth degree numbers (non-cardinals: 30/60/120/150/210/240/300/330)
  // placed outside the ring just beyond each spoke. text-anchor flips
  // based on which side of the chart the label lives on so the INNER
  // edge of the text sits at the same radial offset for every label —
  // otherwise 3-digit numbers ("240", "300") creep closer to the ring
  // than 2-digit ones ("30", "60") when all are center-anchored.
  for (let az = 30; az < 360; az += 30) {
    if (az % 90 === 0) continue; // cardinals already labeled
    const [x, y] = altAzToSvg(0, az, cx, cy, R + 6);
    let anchor = "middle";
    if (x - cx > 1) anchor = "start";       // right side of chart
    else if (x - cx < -1) anchor = "end";    // left side of chart
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", x.toFixed(2));
    t.setAttribute("y", y.toFixed(2));
    t.setAttribute("text-anchor", anchor);
    t.setAttribute("dominant-baseline", "central");
    t.classList.add("az-num");
    t.textContent = `${az}°`;
    svg.appendChild(t);
  }
  // Layer order: arc first, then stars + names (so star labels stay
  // readable where the arc crosses them), then event markers on top.
  // There's no live ISS dot in the modal anymore — it's a static PNG
  // snapshot, so the Start/Peak/End markers carry the whole story.
  const arc = document.createElementNS(SVG_NS, "polyline");
  arc.classList.add("arc");
  svg.appendChild(arc);
  const starsG = document.createElementNS(SVG_NS, "g");
  starsG.dataset.layer = "stars";
  svg.appendChild(starsG);
  const eventsG = document.createElementNS(SVG_NS, "g");
  eventsG.dataset.layer = "events";
  svg.appendChild(eventsG);
}

function paintPolarModalArc(svg, obs) {
  const arc = svg.querySelector(".arc");
  if (!arc) return;
  arc.setAttribute("stroke", obs.color);
  const w = state.windows?.[state.activeWindowIdx];
  if (!w) { arc.setAttribute("points", ""); return; }
  const SAMPLES = 60;
  const dt = (w.endMs - w.startMs) / SAMPLES;
  const pts = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const issEcef = issEcefAt(new Date(w.startMs + dt * i));
    if (!issEcef) continue;
    const { alt, az } = issAltAzDeg(obs, issEcef);
    if (alt < 0) continue;
    const [x, y] = altAzToSvg(alt, az, MODAL_GEOM.cx, MODAL_GEOM.cy, MODAL_GEOM.R);
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  arc.setAttribute("points", pts.join(" "));
}

// Minimum distance (in SVG units) two label centers must be from each
// other before we'll place both. The chart spans ~180 SVG units across
// (R=90 radius), so 14 units ≈ 7° of sky — keeps the Big Dipper and
// Orion's belt from stacking name on name. We sort labels brightest
// first so brighter stars always win the right to a label.
const STAR_LABEL_MIN_DIST = 14;

function paintPolarModalStars(svg, obs, jsDate) {
  const starsG = svg.querySelector('[data-layer="stars"]');
  if (!starsG) return;
  starsG.replaceChildren();

  // Brighter stars get first claim to label space. Stars whose labels
  // would crash into an already-placed label still draw their dot.
  const labelEligible = [...BRIGHT_STARS].sort((a, b) => a.mag - b.mag);
  const placedLabels = [];

  const drawStar = (star, withLabel) => {
    const dirEcef = starDirectionEcef(star, jsDate);
    const { alt, az } = starAltAzForObs(obs, dirEcef);
    if (alt < 0) return;
    const [x, y] = altAzToSvg(alt, az, MODAL_GEOM.cx, MODAL_GEOM.cy, MODAL_GEOM.R);
    const r = starDotRadius(star.mag);
    const d = document.createElementNS(SVG_NS, "circle");
    d.classList.add("star-dot");
    d.setAttribute("cx", x.toFixed(2));
    d.setAttribute("cy", y.toFixed(2));
    d.setAttribute("r", r.toFixed(2));
    d.setAttribute("fill", starDotColor(star));
    starsG.appendChild(d);
    if (withLabel && star.name) {
      const lx = x, ly = y - r - 1.2;
      const tooClose = placedLabels.some(p =>
        Math.hypot(p.x - lx, p.y - ly) < STAR_LABEL_MIN_DIST
      );
      if (tooClose) return;
      placedLabels.push({ x: lx, y: ly });
      const t = document.createElementNS(SVG_NS, "text");
      t.classList.add("star-name");
      t.setAttribute("x", lx.toFixed(2));
      t.setAttribute("y", ly.toFixed(2));
      t.setAttribute("text-anchor", "middle");
      t.textContent = star.name;
      starsG.appendChild(t);
    }
  };
  // Labeled (brightest-first so declutter favors them)
  for (const star of labelEligible) drawStar(star, true);
  // Dots only — fill-in catalogs for visual density
  for (const star of MORE_STARS)  drawStar(star, false);
  for (const star of FAINT_STARS) drawStar(star, false);
}

// Pass-event annotation: small colored dot on the chart at each of
// start / peak / end, plus a 3-column info row BELOW the chart with
// time · alt · az for each. Colors visually tie the chart markers to
// the matching info block (teal=start, gold=peak, red=end).
const EVENT_STYLE = [
  { label: "Start", color: "#34d399" }, // green
  { label: "Peak",  color: "#facc15" }, // gold
  { label: "End",   color: "#f87171" }, // red
];
// Info-row column centers (chosen to span the viewBox with breathing
// room: viewBox spans x = -24..224, so left/mid/right at 20/100/180).
const EVENT_COLS = [20, 100, 180];
// Top placement: events row sits between the tz line (y=-37) and the
// chart's cardinal N (y=2), with breathing room on both sides.
const EVENT_ROW_TITLE_Y = -25;
const EVENT_ROW_TIME_Y  = -17;
const EVENT_ROW_POS_Y   = -9;

// Path-tangent direction (unit vector in SVG coords) for the ISS arc
// at time `ms`, sampled by finite difference. Used to orient the split
// of overlapping event-marker dots so the "earlier" half sits on the
// side the path came from and "later" on the side it heads toward.
// Returns null if either sample falls below the horizon or off-chart.
function pathTangentSvg(obs, ms) {
  const DT = 2000; // ±2s window — fine enough that the tangent is well-defined
  const ePrev = issEcefAt(new Date(ms - DT));
  const eNext = issEcefAt(new Date(ms + DT));
  if (!ePrev || !eNext) return null;
  const p1 = issAltAzDeg(obs, ePrev);
  const p2 = issAltAzDeg(obs, eNext);
  if (p1.alt < 0 || p2.alt < 0) return null;
  const [x1, y1] = altAzToSvg(p1.alt, p1.az, MODAL_GEOM.cx, MODAL_GEOM.cy, MODAL_GEOM.R);
  const [x2, y2] = altAzToSvg(p2.alt, p2.az, MODAL_GEOM.cx, MODAL_GEOM.cy, MODAL_GEOM.R);
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  return { x: dx / len, y: dy / len };
}

// SVG path for a half-disc centered at (cx, cy), radius r, split by a
// diameter perpendicular to angle `ang`. `side` selects which half:
//   +1 → the half on the +ang side ("forward" along the path)
//   -1 → the half on the -ang side ("backward")
// Built as: center → chord-endpoint-1 → arc (sweep-flag=1, increasing
// angle) → chord-endpoint-2 → close. The +1 case sweeps through `ang`
// itself; the -1 case sweeps through `ang+π`.
function halfDiscPath(cx, cy, r, ang, side) {
  const centerAngle = ang + (side > 0 ? 0 : Math.PI);
  const a1 = centerAngle - Math.PI / 2;
  const a2 = centerAngle + Math.PI / 2;
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const x2 = cx + r * Math.cos(a2);
  const y2 = cy + r * Math.sin(a2);
  return `M ${cx.toFixed(2)},${cy.toFixed(2)} `
       + `L ${x1.toFixed(2)},${y1.toFixed(2)} `
       + `A ${r},${r} 0 0,1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
}

function paintPolarModalEvents(svg, obs) {
  const eventsG = svg.querySelector('[data-layer="events"]');
  if (!eventsG) return;
  eventsG.replaceChildren();
  const w = state.windows?.[state.activeWindowIdx];
  if (!w) return;
  // Find the apparent-alt peak via fine sampling of the active window.
  const SAMPLES = 240;
  let peakMs = w.startMs, peakAlt = -Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = w.startMs + (w.endMs - w.startMs) * i / SAMPLES;
    const e = issEcefAt(new Date(t));
    if (!e) continue;
    const a = issAltitudeDeg(obs, e);
    if (a > peakAlt) { peakAlt = a; peakMs = t; }
  }
  const eventTimes = [w.startMs, peakMs, w.endMs];
  const { cx, cy, R } = MODAL_GEOM;

  // ---- Compute positions for all three events --------------------
  const pts = eventTimes.map((ms, i) => {
    const style = EVENT_STYLE[i];
    const e = issEcefAt(new Date(ms));
    if (!e) return { ms, style, valid: false };
    const { alt, az } = issAltAzDeg(obs, e);
    const altClamped = Math.max(0, alt);
    const valid = alt >= -0.5;
    const [x, y] = altAzToSvg(altClamped, az, cx, cy, R);
    return { ms, style, valid, alt: altClamped, az, x, y };
  });

  // ---- Marker rendering with overlap handling --------------------
  // If two adjacent events (start↔peak or peak↔end) land within one
  // dot-diameter of each other, render them as a single split-disc
  // (half earlier color / half later color) instead of stacking two
  // full circles where the upper one hides the lower. Split direction
  // is perpendicular to the path tangent so "earlier" sits on the side
  // the ISS came from and "later" on the side it heads toward.
  const MARKER_R = 2;
  const OVERLAP_THRESHOLD = 2 * MARKER_R + 0.5;
  const consumed = new Set();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (!a.valid || !b.valid) continue;
    if (Math.hypot(b.x - a.x, b.y - a.y) >= OVERLAP_THRESHOLD) continue;
    // Path tangent sampled around the overlap midpoint
    const midMs = (a.ms + b.ms) / 2;
    let dir = pathTangentSvg(obs, midMs);
    if (!dir) {
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      dir = { x: dx / len, y: dy / len };
    }
    const ang = Math.atan2(dir.y, dir.x);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    // Backward half (path origin side) = earlier event color.
    // stroke="none" on the half-discs so the chord between the two
    // halves doesn't show as a dark seam — only the outer circle is
    // strokeable, and we add that as a separate full circle below.
    const back = document.createElementNS(SVG_NS, "path");
    back.setAttribute("d", halfDiscPath(mx, my, MARKER_R, ang, -1));
    back.setAttribute("fill", a.style.color);
    back.setAttribute("stroke", "none");
    eventsG.appendChild(back);
    // Forward half (path destination side) = later event color
    const front = document.createElementNS(SVG_NS, "path");
    front.setAttribute("d", halfDiscPath(mx, my, MARKER_R, ang, +1));
    front.setAttribute("fill", b.style.color);
    front.setAttribute("stroke", "none");
    eventsG.appendChild(front);
    // Outer ring (stroke only) gives the split dot the same dark edge
    // as un-split markers without painting through the middle.
    const ring = document.createElementNS(SVG_NS, "circle");
    ring.setAttribute("cx", mx.toFixed(2));
    ring.setAttribute("cy", my.toFixed(2));
    ring.setAttribute("r", MARKER_R);
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", "#0a0e1a");
    ring.setAttribute("stroke-width", 0.5);
    eventsG.appendChild(ring);
    consumed.add(i); consumed.add(i + 1);
  }
  pts.forEach((p, i) => {
    if (!p.valid || consumed.has(i)) return;
    const m = document.createElementNS(SVG_NS, "circle");
    m.classList.add("event-marker");
    m.setAttribute("cx", p.x.toFixed(2));
    m.setAttribute("cy", p.y.toFixed(2));
    m.setAttribute("r", MARKER_R);
    m.setAttribute("fill", p.style.color);
    eventsG.appendChild(m);
  });

  // ---- Info row beneath the chart (one column per event) ---------
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
    // Bullet prefix is a Unicode BLACK CIRCLE glyph (U+25CF) inside
    // the same text element as the label, so the font handles its
    // size + baseline alignment automatically — no separate SVG
    // circle to keep in vertical lock with the caps.
    const title = document.createElementNS(SVG_NS, "text");
    title.classList.add("event-block-title");
    title.setAttribute("x", colX);
    title.setAttribute("y", EVENT_ROW_TITLE_Y);
    title.setAttribute("text-anchor", "middle");
    title.setAttribute("fill", style.color);
    title.textContent = `●  ${style.label}`;
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

// Paint the SVG (offscreen) and rasterize it to a PNG blob URL that
// becomes the user-facing <img>. Going through an <img> gives native
// right-click → Save image / Open in new tab / Copy image behavior;
// the SVG stays offscreen purely as the render source.
//
// Resolves only AFTER the resulting bitmap has fully decoded into the
// <img> element, so the caller can wait before unhiding the modal —
// otherwise the user sees a frame of empty <img> while the PNG paints.
async function renderPolarModal(obs) {
  paintPolarModalStatic(polarModalSvg, obs);
  paintPolarModalArc(polarModalSvg, obs);
  paintPolarModalEvents(polarModalSvg, obs);
  const jsDate = Cesium.JulianDate.toDate(viewer.clock.currentTime);
  paintPolarModalStars(polarModalSvg, obs, jsDate);
  const blob = await svgToPngBlob(polarModalSvg);
  const url = URL.createObjectURL(blob);
  if (_polarModalImgUrl) URL.revokeObjectURL(_polarModalImgUrl);
  _polarModalImgUrl = url;
  // decode() resolves once the bitmap is ready to paint — strictly
  // stronger than `onload`, which can fire before the first paint.
  polarModalImg.src = url;
  if (polarModalImg.decode) {
    try { await polarModalImg.decode(); } catch { /* fall through */ }
  }
}

async function openPolarModal(obsId) {
  const obs = state.observers.find(o => o.id === obsId);
  if (!obs) return;
  _polarModalObsId = obsId;
  // Briefly hint that something's happening — render typically takes
  // 50-250 ms — without flashing an empty modal at the user.
  document.body.style.cursor = "progress";
  try {
    await renderPolarModal(obs);
  } catch (e) {
    console.warn("Polar modal render failed:", e);
  } finally {
    document.body.style.cursor = "";
  }
  // Only reveal if this open hasn't been superseded by a faster
  // subsequent click on a different observer.
  if (_polarModalObsId === obsId) polarModalEl.hidden = false;
}

function closePolarModal() {
  _polarModalObsId = null;
  polarModalEl.hidden = true;
  if (_polarModalImgUrl) {
    URL.revokeObjectURL(_polarModalImgUrl);
    _polarModalImgUrl = null;
  }
  polarModalImg.removeAttribute("src");
}

// (Polar-plot click handling lives on the whole .obs-card now — see
// renderObsList. No delegated listener here.)

polarModalEl.querySelector(".polar-modal-close").addEventListener("click", closePolarModal);
polarModalEl.querySelector(".polar-modal-backdrop").addEventListener("click", closePolarModal);
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !polarModalEl.hidden) closePolarModal();
});

// Rasterize the current modal SVG to a PNG Blob. The SVG already has
// CSS embedded (see MODAL_SVG_STYLE) so it can render standalone. We
// snapshot DOM state synchronously to avoid races with the per-frame
// preRender redraw of stars/iss dot.
const EXPORT_PX = 1600; // long-edge target resolution
function svgToPngBlob(svg) {
  return new Promise((resolve, reject) => {
    // XMLSerializer needs xmlns set on the root for the standalone parse.
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const xml = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      // Match viewBox aspect ratio
      const vb = svg.viewBox.baseVal;
      const aspect = vb.width / vb.height;
      const w = aspect >= 1 ? EXPORT_PX : Math.round(EXPORT_PX * aspect);
      const h = aspect >= 1 ? Math.round(EXPORT_PX / aspect) : EXPORT_PX;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("toBlob failed")), "image/png");
    };
    img.onerror = (e) => { URL.revokeObjectURL(svgUrl); reject(e); };
    img.src = svgUrl;
  });
}

function polarModalFileName() {
  const obs = state.observers.find(o => o.id === _polarModalObsId);
  const obsSlug = (obs?.name ?? "observer").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const d = Cesium.JulianDate.toDate(viewer.clock.currentTime);
  const dateSlug = d.toISOString().slice(0, 10);
  return `iss-pass-${obsSlug}-${dateSlug}.png`;
}

async function downloadPolarModalPng() {
  try {
    const blob = await svgToPngBlob(polarModalSvg);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = polarModalFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.warn("Polar modal PNG export failed:", e);
    alert("Couldn't export PNG: " + (e?.message ?? e));
  }
}

async function copyPolarModalPng() {
  const btn = polarModalEl.querySelector(".polar-modal-copy");
  try {
    const blob = await svgToPngBlob(polarModalSvg);
    if (!navigator.clipboard?.write) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    btn.classList.add("copied");
    const prev = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.classList.remove("copied"); btn.textContent = prev; }, 1400);
  } catch (e) {
    console.warn("Clipboard copy failed, falling back to download:", e);
    downloadPolarModalPng();
  }
}

polarModalEl.querySelector(".polar-modal-save").addEventListener("click", downloadPolarModalPng);
polarModalEl.querySelector(".polar-modal-copy").addEventListener("click", copyPolarModalPng);

function renderObsList() {
  renderObserverIcons();
  obsListEl.replaceChildren();
  for (const obs of state.observers) {
    const card = document.createElement("div");
    card.className = "obs-card";
    card.dataset.obsId = obs.id;
    card.title = `Open polar plot — ${obs.name}`;
    // Whole card opens the polar modal — inner buttons stopPropagation
    // so they don't accidentally trigger it too.
    card.addEventListener("click", () => openPolarModal(obs.id));
    const header = document.createElement("div");
    header.className = "obs-card-header";
    const swatch = document.createElement("span");
    swatch.className = "color-swatch";
    swatch.style.background = obs.color;
    header.appendChild(swatch);
    // Stacked name + coords in one flex column → card stays one row
    // tall in the header.
    const meta = document.createElement("div");
    meta.className = "obs-card-meta";
    const nameSpan = document.createElement("div");
    nameSpan.className = "obs-card-name";
    nameSpan.textContent = obs.name;
    meta.appendChild(nameSpan);
    const coordsSpan = document.createElement("div");
    coordsSpan.className = "obs-card-coords";
    coordsSpan.textContent = `${obs.latDeg.toFixed(4)}°, ${obs.lonDeg.toFixed(4)}°`;
    meta.appendChild(coordsSpan);
    header.appendChild(meta);
    // "View from here" button — toggles first-person camera mode.
    const fps = document.createElement("button");
    fps.type = "button";
    fps.className = "fps-view" + (obs.id === _fpsObserverId ? " active" : "");
    fps.textContent = "▲";
    fps.title = "View from here (camera at observer, looking up at ISS)";
    fps.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setFpsObserver(obs.id);
    });
    header.appendChild(fps);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "remove";
    rm.textContent = "✕";
    rm.title = "Remove";
    rm.addEventListener("click", (ev) => {
      ev.stopPropagation();
      removeObserver(obs.id);
    });
    header.appendChild(rm);
    card.appendChild(header);
    const polar = buildPolarPlot(obs);
    updatePolarPlotArc(polar, obs);
    card.appendChild(polar);
    obsListEl.appendChild(card);
  }
}

// Add by lat/lon
document.getElementById("add-latlon-btn").addEventListener("click", () => {
  const inp = document.getElementById("add-latlon");
  const raw = inp.value.trim();
  if (!raw) return;
  // Split on comma; lat is before, lon is after.
  const parts = raw.split(",");
  if (parts.length !== 2) {
    alert("Format: lat, lon (DMS or decimal)");
    return;
  }
  try {
    const latDeg = parseDmsToDecimal(parts[0].trim());
    const lonDeg = parseDmsToDecimal(parts[1].trim());
    addObserver(null, latDeg, lonDeg);
    inp.value = "";
  } catch (e) {
    alert(`Bad lat/lon: ${e.message}`);
  }
});

// Geocode
document.getElementById("add-geocode-btn").addEventListener("click", async () => {
  const inp = document.getElementById("add-geocode");
  const q = inp.value.trim();
  if (!q) return;
  const result = await geocodeOne(q);
  if (!result) {
    alert(`No result for "${q}"`);
    return;
  }
  addObserver(q, result.latDeg, result.lonDeg);
  inp.value = "";
});

// Enter key in either input triggers its matching button.
document.getElementById("add-latlon").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); document.getElementById("add-latlon-btn").click(); }
});
document.getElementById("add-geocode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); document.getElementById("add-geocode-btn").click(); }
});

// Click on globe to place
const clickToggleBtn = document.getElementById("click-place-toggle");
clickToggleBtn.addEventListener("click", () => {
  state.clickToPlace = !state.clickToPlace;
  clickToggleBtn.classList.toggle("active", state.clickToPlace);
});
const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction((click) => {
  if (!state.clickToPlace) return;
  const cartesian = viewer.scene.pickPosition(click.position) ||
    viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
  if (!cartesian) return;
  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  addObserver(null, Cesium.Math.toDegrees(cartographic.latitude), Cesium.Math.toDegrees(cartographic.longitude));
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// ---------------------------------------------------------------------------
// Task 9: TLE panel (fetch on load, edit, refetch)
// ---------------------------------------------------------------------------

const tleNameEl = document.getElementById("tle-name");
const tleL1El = document.getElementById("tle-l1");
const tleL2El = document.getElementById("tle-l2");
const tleStatusEl = document.getElementById("tle-status");
const tleRefetchBtn = document.getElementById("tle-refetch");

state.tle = null;

let loadTle = async function () {
  tleStatusEl.textContent = "fetching from Celestrak…";
  tleStatusEl.className = "hint";
  const t = await fetchIssTle();
  if (t) {
    tleNameEl.value = t.name;
    tleL1El.value = t.line1;
    tleL2El.value = t.line2;
    state.tle = t;
    tleStatusEl.textContent = `fetched ${new Date().toUTCString()}`;
    tleStatusEl.className = "hint ok";
  } else {
    tleStatusEl.textContent = "fetch failed — paste a TLE below.";
    tleStatusEl.className = "hint error";
  }
};

function readTleFromUi() {
  const name = tleNameEl.value.trim();
  const line1 = tleL1El.value.trim();
  const line2 = tleL2El.value.trim();
  if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) return null;
  return { name, line1, line2 };
}

tleRefetchBtn.addEventListener("click", () => loadTle());
[tleNameEl, tleL1El, tleL2El].forEach(el => el.addEventListener("input", () => {
  state.tle = readTleFromUi();
}));

// ---------------------------------------------------------------------------
// Task 10: ISS entity + clock-driven position (CallbackProperty)
// ---------------------------------------------------------------------------

let issEntity = null;
let orbitEntity = null;
let satrec = null;

function refreshSatrec() {
  const t = readTleFromUi();
  if (!t) { satrec = null; return; }
  try {
    satrec = sat.twoline2satrec(t.line1, t.line2);
  } catch (e) {
    console.warn("TLE parse error:", e.message);
    satrec = null;
  }
}

function issEcefAt(jsDate) {
  if (!satrec) return null;
  const pv = sat.propagate(satrec, jsDate);
  if (!pv || !pv.position) return null;
  const gmst = sat.gstime(jsDate);
  const ecf = sat.eciToEcf(pv.position, gmst);
  return [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000];
}

// Recompute label declutter offsets each frame.
//
// Candidate-slot algorithm (per-label):
//   1. Project each visible label to screen space (its natural position).
//   2. Try a small ordered list of nearby candidate slots — natural slot
//      first, then a handful of cardinal/diagonal offsets near the
//      anchor.
//   3. The first slot that doesn't overlap any previously-placed label
//      wins; the label's offset is stored as { dx, dy } in labelOffsets.
//
// Result: each label stays at or very near its natural anchor unless
// it actually collides with something, and even then it only moves to a
// nearby slot — no long downward "drift" like the previous always-down
// stacker. O(N²·K) per frame for N labels and K candidates (small N, K
// ≤ ~10 here).
function updateLabelOffsets() {
  labelOffsets.clear();
  if (!state.observers.length) return;
  const time = viewer.clock.currentTime;
  const d = Cesium.JulianDate.toDate(time);
  const issEcef = issEcefAt(d);
  const issPos = issEcef
    ? Cesium.Cartesian3.fromElements(issEcef[0], issEcef[1], issEcef[2])
    : null;
  const scene = viewer.scene;

  const items = [];
  for (const obs of state.observers) {
    const obsPos = Cesium.Cartesian3.fromDegrees(obs.lonDeg, obs.latDeg, 0);
    if (isInFrontOfEarth(obsPos)) {
      const sp = Cesium.SceneTransforms.worldToWindowCoordinates(scene, obsPos);
      if (sp) {
        items.push({
          type: "pin",
          key: `pin:${obs.id}`,
          x: sp.x + 12, y: sp.y - 10,
          w: PIN_LABEL_W, h: PIN_LABEL_H,
        });
      }
    }
    // (Midpoint labels removed — alt/az now lives in the pin label as
    // a conditional second line, so the only declutter targets are pin
    // labels themselves.)
  }
  if (!items.length) return;

  const placed = [];
  for (const it of items) {
    const cands = PIN_CANDIDATES;
    // Default to the last candidate so we always produce some placement
    // even if every slot collides — labels overlapping is preferable to
    // crashing the layout pass.
    let chosen = cands[cands.length - 1];
    for (const c of cands) {
      const px = it.x + c.dx;
      const py = it.y + c.dy;
      let collides = false;
      for (const p of placed) {
        const minSepX = (p.w + it.w) / 2;
        const minSepY = (p.h + it.h) / 2;
        if (Math.abs(p.x - px) < minSepX && Math.abs(p.y - py) < minSepY) {
          collides = true;
          break;
        }
      }
      if (!collides) { chosen = c; break; }
    }
    placed.push({ x: it.x + chosen.dx, y: it.y + chosen.dy, w: it.w, h: it.h });
    labelOffsets.set(it.key, { dx: chosen.dx, dy: chosen.dy });
  }
}

viewer.scene.preRender.addEventListener(updateLabelOffsets);

function ensureIssEntity() {
  if (issEntity) return;
  issEntity = viewer.entities.add({
    position: new Cesium.CallbackProperty((time) => {
      const d = Cesium.JulianDate.toDate(time);
      const p = issEcefAt(d);
      if (!p) return Cesium.Cartesian3.ZERO;
      return Cesium.Cartesian3.fromElements(p[0], p[1], p[2]);
    }, false),
    point: {
      pixelSize: 14,
      // Dim the ISS dot when it's in Earth's shadow (not naked-eye visible
      // anywhere on the planet at that instant).
      color: new Cesium.CallbackProperty((time) => {
        const d = Cesium.JulianDate.toDate(time);
        const p = issEcefAt(d);
        if (!p) return Cesium.Color.WHITE;
        return issIlluminated(p, sunPositionEcef(d))
          ? Cesium.Color.WHITE
          : Cesium.Color.fromCssColorString("#5a6678");
      }, false),
      outlineColor: Cesium.Color.fromCssColorString("#7eb8ff"),
      outlineWidth: 3,
      // Render on top of all other geometry (the colored pass-gradient
      // polyline shares world positions with the ISS and would otherwise
      // z-fight). Visibility behind the planet is handled by the `show`
      // callback below instead of depth testing.
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: new Cesium.CallbackProperty((time) => {
        const d = Cesium.JulianDate.toDate(time);
        const p = issEcefAt(d);
        if (!p) return false;
        return isInFrontOfEarth(Cesium.Cartesian3.fromElements(p[0], p[1], p[2]));
      }, false),
    },
    label: {
      show: new Cesium.CallbackProperty((time) => {
        const d = Cesium.JulianDate.toDate(time);
        const p = issEcefAt(d);
        if (!p) return false;
        return isInFrontOfEarth(Cesium.Cartesian3.fromElements(p[0], p[1], p[2]));
      }, false),
      text: new Cesium.CallbackProperty((time) => {
        const d = Cesium.JulianDate.toDate(time);
        const p = issEcefAt(d);
        if (!p) return "ISS";
        const cart = Cesium.Cartographic.fromCartesian(
          Cesium.Cartesian3.fromElements(p[0], p[1], p[2])
        );
        return `ISS · ${(cart.height / 1000).toFixed(0)} km`;
      }, false),
      font: "12px sans-serif",
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(14, -12),
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("rgba(10,14,26,0.7)"),
      backgroundPadding: new Cesium.Cartesian2(6, 4),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
}

// Orbit polyline: animated. The positions are recomputed each time the clock
// moves more than ~10 simulated seconds, so the orbit ring stays centered on
// the current moment as the ISS races forward. Cache the Cartesian3 array
// between recomputes so we're not allocating 360 positions every frame.
let orbitCachedPositions = [];
let orbitCacheCenterMs = null;
// Simulated-time interval between orbit recomputes. Low enough that Earth's
// rotation in this window (0.0021° ≈ 250 m of horizontal offset at 400 km)
// is invisible — so the dot stays on the line at all playback speeds.
const ORBIT_REFRESH_MS = 500;

function invalidateOrbitCache() { orbitCacheCenterMs = null; }

function recomputeOrbitFor(jsDate) {
  if (!satrec) { orbitCachedPositions = []; return; }
  const t = readTleFromUi();
  if (!t) { orbitCachedPositions = []; return; }
  const pts = tleOrbitTrackEcef(t.line1, t.line2, jsDate);
  orbitCachedPositions = pts.map(p =>
    Cesium.Cartesian3.fromElements(p[0], p[1], p[2])
  );
}

let gpLineEntity = null;
function ensureGpLineEntity() {
  if (gpLineEntity) return;
  gpLineEntity = viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty((time) => {
        const d = Cesium.JulianDate.toDate(time);
        const p = issEcefAt(d);
        if (!p) return [];
        const issPos = Cesium.Cartesian3.fromElements(p[0], p[1], p[2]);
        const cart = Cesium.Cartographic.fromCartesian(issPos);
        const groundPos = Cesium.Cartesian3.fromDegrees(
          Cesium.Math.toDegrees(cart.longitude),
          Cesium.Math.toDegrees(cart.latitude),
          0
        );
        return [issPos, groundPos];
      }, false),
      width: 1.5,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString("#cfe0ff").withAlpha(0.45),
        dashLength: 10,
      }),
      arcType: Cesium.ArcType.NONE,
    },
  });
}

function ensureOrbitEntity() {
  if (orbitEntity) return;
  orbitEntity = viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty((time) => {
        const ms = Cesium.JulianDate.toDate(time).getTime();
        if (orbitCacheCenterMs === null
            || Math.abs(ms - orbitCacheCenterMs) > ORBIT_REFRESH_MS) {
          recomputeOrbitFor(new Date(ms));
          orbitCacheCenterMs = ms;
        }
        return orbitCachedPositions;
      }, false),
      width: 1.5,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString("#7eb8ff").withAlpha(0.45),
        dashLength: 12,
      }),
      arcType: Cesium.ArcType.NONE,
    },
  });
}

// Bright-star labels on the sky. Each star is placed in ECEF at a fixed
// large radius along its J2000 RA/Dec direction, rotated each frame by
// GMST to convert from inertial → Earth-fixed. The same EllipsoidalOccluder
// check used for observer labels hides a star when it's behind Earth
// from the camera. Catalog: ~20 brightest stars + Polaris (for
// orientation). RA in decimal hours, Dec in decimal degrees (J2000).
// Expanded catalog: ~55 brightest naked-eye stars (down to roughly mag
// 2.5) plus a few well-known constellation markers. RA in decimal
// hours, Dec in decimal degrees, J2000 epoch.
// `cls` is the dominant spectral class letter (O/B/A/F/G/K/M). It maps
// to a representative color via SPECTRAL_COLOR (cooler stars redder,
// hotter stars bluer) — see starDotColor() below.
const BRIGHT_STARS = [
  { name: "Sirius",         ra:  6.7525, dec: -16.7161, mag: -1.46, cls: "A" },
  { name: "Canopus",        ra:  6.3992, dec: -52.6957, mag: -0.74, cls: "A" },
  { name: "Arcturus",       ra: 14.2610, dec:  19.1824, mag: -0.05, cls: "K" },
  { name: "Vega",           ra: 18.6156, dec:  38.7837, mag:  0.03, cls: "A" },
  { name: "Capella",        ra:  5.2782, dec:  45.9981, mag:  0.08, cls: "G" },
  { name: "Rigel",          ra:  5.2423, dec:  -8.2017, mag:  0.13, cls: "B" },
  { name: "Procyon",        ra:  7.6550, dec:   5.2250, mag:  0.34, cls: "F" },
  { name: "Betelgeuse",     ra:  5.9195, dec:   7.4070, mag:  0.50, cls: "M" },
  { name: "Achernar",       ra:  1.6286, dec: -57.2367, mag:  0.46, cls: "B" },
  { name: "Hadar",          ra: 14.0637, dec: -60.3729, mag:  0.61, cls: "B" },
  { name: "Altair",         ra: 19.8464, dec:   8.8683, mag:  0.77, cls: "A" },
  { name: "Acrux",          ra: 12.4433, dec: -63.0991, mag:  0.76, cls: "B" },
  { name: "Aldebaran",      ra:  4.5987, dec:  16.5092, mag:  0.86, cls: "K" },
  { name: "Antares",        ra: 16.4901, dec: -26.4320, mag:  1.06, cls: "M" },
  { name: "Spica",          ra: 13.4199, dec: -11.1614, mag:  0.97, cls: "B" },
  { name: "Pollux",         ra:  7.7553, dec:  28.0262, mag:  1.14, cls: "K" },
  { name: "Fomalhaut",      ra: 22.9608, dec: -29.6222, mag:  1.17, cls: "A" },
  { name: "Deneb",          ra: 20.6906, dec:  45.2803, mag:  1.25, cls: "A" },
  { name: "Mimosa",         ra: 12.7953, dec: -59.6886, mag:  1.25, cls: "B" },
  { name: "Regulus",        ra: 10.1395, dec:  11.9672, mag:  1.36, cls: "B" },
  { name: "Adhara",         ra:  6.9770, dec: -28.9721, mag:  1.50, cls: "B" },
  { name: "Castor",         ra:  7.5767, dec:  31.8884, mag:  1.58, cls: "A" },
  { name: "Shaula",         ra: 17.5601, dec: -37.1038, mag:  1.62, cls: "B" },
  { name: "Gacrux",         ra: 12.5194, dec: -57.1131, mag:  1.63, cls: "M" },
  { name: "Bellatrix",      ra:  5.4189, dec:   6.3497, mag:  1.64, cls: "B" },
  { name: "Elnath",         ra:  5.4382, dec:  28.6075, mag:  1.65, cls: "B" },
  { name: "Miaplacidus",    ra:  9.2200, dec: -69.7172, mag:  1.69, cls: "A" },
  { name: "Alnilam",        ra:  5.6035, dec:  -1.2019, mag:  1.69, cls: "B" },
  { name: "Alnitak",        ra:  5.6793, dec:  -1.9426, mag:  1.77, cls: "O" },
  { name: "Mintaka",        ra:  5.5334, dec:  -0.2991, mag:  2.23, cls: "O" },
  { name: "Saiph",          ra:  5.7959, dec:  -9.6696, mag:  2.09, cls: "B" },
  { name: "Wezen",          ra:  7.1399, dec: -26.3933, mag:  1.83, cls: "F" },
  { name: "Kaus Australis", ra: 18.4029, dec: -34.3847, mag:  1.85, cls: "B" },
  { name: "Avior",          ra:  8.3753, dec: -59.5095, mag:  1.86, cls: "K" },
  { name: "Alkaid",         ra: 13.7923, dec:  49.3133, mag:  1.85, cls: "B" },
  { name: "Menkalinan",     ra:  5.9921, dec:  44.9474, mag:  1.90, cls: "A" },
  { name: "Atria",          ra: 16.8111, dec: -69.0277, mag:  1.91, cls: "K" },
  { name: "Alhena",         ra:  6.6285, dec:  16.3993, mag:  1.93, cls: "A" },
  { name: "Peacock",        ra: 20.4275, dec: -56.7351, mag:  1.94, cls: "B" },
  { name: "Mirfak",         ra:  3.4054, dec:  49.8612, mag:  1.79, cls: "F" },
  { name: "Dubhe",          ra: 11.0621, dec:  61.7508, mag:  1.79, cls: "K" },
  { name: "Mizar",          ra: 13.3988, dec:  54.9254, mag:  2.23, cls: "A" },
  { name: "Alioth",         ra: 12.9004, dec:  55.9598, mag:  1.76, cls: "A" },
  { name: "Merak",          ra: 11.0307, dec:  56.3824, mag:  2.37, cls: "A" },
  { name: "Phecda",         ra: 11.8972, dec:  53.6948, mag:  2.44, cls: "A" },
  { name: "Megrez",         ra: 12.2571, dec:  57.0326, mag:  3.31, cls: "A" },
  { name: "Schedar",        ra:  0.6751, dec:  56.5374, mag:  2.24, cls: "K" },
  { name: "Caph",           ra:  0.1530, dec:  59.1498, mag:  2.27, cls: "F" },
  { name: "Ruchbah",        ra:  1.4302, dec:  60.2353, mag:  2.66, cls: "A" },
  { name: "Sadr",           ra: 20.3705, dec:  40.2567, mag:  2.23, cls: "F" },
  { name: "Albireo",        ra: 19.5125, dec:  27.9597, mag:  3.18, cls: "K" },
  { name: "Hamal",          ra:  2.1196, dec:  23.4624, mag:  2.00, cls: "K" },
  { name: "Algol",          ra:  3.1361, dec:  40.9556, mag:  2.12, cls: "B" },
  { name: "Diphda",         ra:  0.7264, dec: -17.9866, mag:  2.04, cls: "K" },
  { name: "Markab",         ra: 23.0793, dec:  15.2053, mag:  2.49, cls: "A" },
  { name: "Alpheratz",      ra:  0.1397, dec:  29.0904, mag:  2.06, cls: "B" },
  { name: "Almach",         ra:  2.0649, dec:  42.3297, mag:  2.10, cls: "K" },
  { name: "Polaris",        ra:  2.5302, dec:  89.2641, mag:  1.98, cls: "F" },
  { name: "Alcyone",        ra:  3.7913, dec:  24.1052, mag:  2.87, cls: "B" },
];

// Supplemental fainter catalog — RA/Dec/mag, no names. Plotted as dots
// in the fullscreen polar modal to give the sky chart visual density,
// but NOT added as labels in the 3D scene (would crowd the globe).
// J2000 epoch, mostly mag 2.0 – 3.5.
const MORE_STARS = [
  { ra:  1.1623, dec:  35.6206, mag: 2.07, cls: "M" },  // Mirach β And
  { ra: 22.0964, dec:  -0.3198, mag: 2.95, cls: "G" },  // Sadalmelik α Aqr
  { ra: 21.5260, dec:  -5.5712, mag: 2.87, cls: "G" },  // Sadalsuud β Aqr
  { ra: 19.7717, dec:  10.6133, mag: 2.72, cls: "K" },  // Tarazed γ Aql
  { ra: 19.9213, dec:   6.4068, mag: 3.71, cls: "G" },  // Alshain β Aql
  { ra:  1.9118, dec:  20.8081, mag: 2.65, cls: "A" },  // Sheratan β Ari
  { ra:  6.0651, dec:  37.2125, mag: 2.69, cls: "K" },  // Hassaleh ι Aur
  { ra: 14.7497, dec:  27.0741, mag: 2.35, cls: "K" },  // Izar ε Boo
  { ra: 14.5347, dec:  38.3083, mag: 3.50, cls: "G" },  // Nekkar β Boo
  { ra: 13.9114, dec:  18.3977, mag: 2.68, cls: "G" },  // Muphrid η Boo
  { ra:  8.7747, dec:  18.1542, mag: 3.94, cls: "K" },  // Asellus Australis δ Cnc
  { ra: 12.9337, dec:  38.3184, mag: 2.89, cls: "A" },  // Cor Caroli α CVn
  { ra:  7.0140, dec: -23.8336, mag: 1.98, cls: "B" },  // Mirzam β CMa
  { ra:  7.4017, dec: -29.3030, mag: 2.45, cls: "B" },  // Aludra η CMa
  { ra: 20.3000, dec: -14.7814, mag: 2.85, cls: "A" },  // Deneb Algedi δ Cap
  { ra:  3.0379, dec:   4.0897, mag: 2.54, cls: "M" },  // Menkar α Cet
  { ra:  5.6604, dec: -34.0741, mag: 2.65, cls: "B" },  // Phact α Col
  { ra: 15.5784, dec:  26.7147, mag: 2.23, cls: "A" },  // Alphecca α CrB
  { ra: 12.4172, dec: -22.6195, mag: 2.65, cls: "G" },  // Kraz β Crv
  { ra: 12.2635, dec: -17.5419, mag: 2.59, cls: "B" },  // Gienah γ Crv
  { ra: 20.6605, dec:  15.9120, mag: 3.77, cls: "B" },  // Sualocin α Del
  { ra: 14.0731, dec:  64.3758, mag: 3.65, cls: "A" },  // Thuban α Dra
  { ra: 17.9434, dec:  51.4889, mag: 2.24, cls: "K" },  // Eltanin γ Dra
  { ra: 16.3994, dec:  61.5141, mag: 2.79, cls: "G" },  // Rastaban β Dra
  { ra:  2.9707, dec: -40.3047, mag: 2.88, cls: "A" },  // Acamar θ Eri
  { ra: 22.1372, dec: -46.9609, mag: 1.74, cls: "B" },  // Alnair α Gru
  { ra: 17.2444, dec:  14.3903, mag: 3.06, cls: "M" },  // Rasalgethi α Her
  { ra: 16.5036, dec:  21.4895, mag: 2.78, cls: "G" },  // Kornephoros β Her
  { ra:  9.4598, dec:  -8.6586, mag: 1.98, cls: "K" },  // Alphard α Hya
  { ra: 11.8177, dec:  14.5720, mag: 2.14, cls: "A" },  // Denebola β Leo
  { ra: 10.3328, dec:  19.8415, mag: 2.61, cls: "K" },  // Algieba γ Leo
  { ra: 11.2351, dec:  20.5237, mag: 2.56, cls: "A" },  // Zosma δ Leo
  { ra: 14.8479, dec: -16.0418, mag: 2.61, cls: "B" },  // Zubeneschamali β Lib
  { ra: 14.7202, dec: -15.7297, mag: 2.75, cls: "A" },  // Zubenelgenubi α Lib
  { ra: 18.7456, dec:  37.6051, mag: 3.24, cls: "B" },  // Sulafat γ Lyr
  { ra: 18.8358, dec:  33.3625, mag: 3.45, cls: "B" },  // Sheliak β Lyr
  { ra: 17.5823, dec:  12.5601, mag: 2.07, cls: "A" },  // Rasalhague α Oph
  { ra: 17.1729, dec: -15.7249, mag: 2.43, cls: "A" },  // Sabik η Oph
  { ra: 23.0628, dec:  28.0828, mag: 2.42, cls: "M" },  // Scheat β Peg
  { ra: 21.7364, dec:   9.8750, mag: 2.39, cls: "K" },  // Enif ε Peg
  { ra:  0.2206, dec:  15.1836, mag: 2.83, cls: "B" },  // Algenib γ Peg
  { ra:  0.4380, dec: -42.3061, mag: 2.40, cls: "K" },  // Ankaa α Phe
  { ra: 18.3536, dec: -29.8281, mag: 2.70, cls: "K" },  // Kaus Media δ Sgr
  { ra: 18.2333, dec: -36.7615, mag: 2.81, cls: "K" },  // Kaus Borealis λ Sgr
  { ra: 19.0444, dec: -27.6699, mag: 2.05, cls: "B" },  // Nunki σ Sgr
  { ra: 16.6053, dec: -28.2161, mag: 2.82, cls: "B" },  // Alniyat τ Sco
  { ra: 16.0050, dec: -22.6217, mag: 2.50, cls: "B" },  // Graffias β Sco
  { ra: 16.8359, dec: -34.2929, mag: 1.86, cls: "F" },  // Sargas θ Sco
  { ra: 14.8451, dec:  74.1556, mag: 2.07, cls: "K" },  // Kochab β UMi
  { ra: 15.3457, dec:  71.8340, mag: 3.04, cls: "A" },  // Pherkad γ UMi
  { ra: 11.8378, dec:   1.7647, mag: 3.61, cls: "F" },  // Zavijava β Vir
  { ra: 13.0364, dec:  10.9591, mag: 2.83, cls: "G" },  // Vindemiatrix ε Vir
  { ra: 20.7702, dec:  33.9701, mag: 2.48, cls: "K" },  // Gienah ε Cyg
  { ra: 14.6601, dec: -60.8354, mag: -0.27, cls: "G" }, // Rigil Kentaurus α Cen
  { ra: 13.8228, dec: -47.2885, mag: 2.06, cls: "K" },  // Menkent θ Cen
  { ra:  8.7458, dec: -54.7086, mag: 1.83, cls: "O" },  // Suhail γ Vel (WR/early-type, hot blue)
  { ra:  9.1330, dec: -43.4326, mag: 1.93, cls: "A" },  // δ Vel
  { ra:  8.0586, dec: -40.0031, mag: 2.21, cls: "O" },  // Naos ζ Pup
  { ra:  3.7544, dec:  32.2880, mag: 2.85, cls: "O" },  // Atik ζ Per
];

// Representative apparent color for each Morgan-Keenan spectral class.
// Values derived from B-V → sRGB conversions (Mitchell Charity's blackbody
// star-color table), then tweaked slightly for legibility against the
// near-black sky background of the polar plot.
const SPECTRAL_COLOR = {
  O: "#a4c8ff",  // hot blue
  B: "#bbd0ff",
  A: "#dfe5ff",  // blue-white
  F: "#f7f5ff",  // white
  G: "#fff4d6",  // yellow (Sun-like)
  K: "#ffcf8e",  // orange
  M: "#ff9966",  // red-orange
};
function starDotColor(star) {
  return SPECTRAL_COLOR[star.cls] ?? "#e8eefc";
}

// Even fainter fill-in catalog — RA/Dec/mag/cls. No names, no labels.
// Used to give the polar modal real sky density (typical naked-eye
// limit on a dark night is ~mag 6, suburban ~4 — these are mostly
// mag 3.0–4.0 stars on common constellation outlines).
const FAINT_STARS = [
  { ra:  0.66, dec:  30.86, mag: 3.27, cls: "K" },  // δ And
  { ra:  0.95, dec:  38.50, mag: 3.86, cls: "A" },  // μ And
  { ra: 19.42, dec:   3.11, mag: 3.36, cls: "F" },  // δ Aql
  { ra: 19.09, dec:  13.86, mag: 2.99, cls: "A" },  // ζ Aql
  { ra: 20.19, dec:  -0.82, mag: 3.23, cls: "B" },  // θ Aql
  { ra: 19.10, dec:  -4.88, mag: 3.43, cls: "B" },  // λ Aql
  { ra: 22.36, dec:  -1.39, mag: 3.84, cls: "A" },  // γ Aqr
  { ra: 22.91, dec: -15.82, mag: 3.27, cls: "A" },  // δ Aqr (Skat)
  { ra: 14.27, dec:  30.37, mag: 3.04, cls: "A" },  // γ Boo (Seginus)
  { ra: 15.26, dec:  33.31, mag: 3.46, cls: "G" },  // δ Boo
  { ra:  0.94, dec:  60.72, mag: 2.68, cls: "B" },  // γ Cas
  { ra:  1.91, dec:  63.67, mag: 3.38, cls: "B" },  // ε Cas
  { ra:  2.72, dec:  10.11, mag: 3.47, cls: "G" },  // γ Cet
  { ra:  1.85, dec:  10.34, mag: 3.56, cls: "G" },  // δ Cet
  { ra:  1.73, dec: -15.94, mag: 3.49, cls: "K" },  // η Cet
  { ra: 21.31, dec:  62.59, mag: 2.45, cls: "A" },  // α Cep (Alderamin)
  { ra: 21.48, dec:  70.56, mag: 3.21, cls: "K" },  // β Cep (Alfirk)
  { ra: 23.66, dec:  77.63, mag: 3.21, cls: "K" },  // γ Cep (Errai)
  { ra: 12.50, dec: -22.62, mag: 3.18, cls: "K" },  // ε Crv
  { ra: 12.30, dec: -16.51, mag: 3.81, cls: "F" },  // ζ Crv
  { ra: 19.75, dec:  45.13, mag: 2.86, cls: "B" },  // δ Cyg
  { ra: 21.22, dec:  30.23, mag: 3.20, cls: "K" },  // ζ Cyg
  { ra: 20.71, dec:  16.12, mag: 3.63, cls: "F" },  // β Del (Rotanev)
  { ra: 18.35, dec:  72.73, mag: 2.73, cls: "K" },  // ζ Dra
  { ra: 19.21, dec:  67.66, mag: 3.07, cls: "G" },  // δ Dra
  { ra:  4.20, dec:  -6.84, mag: 2.97, cls: "M" },  // γ Eri (Zaurak)
  { ra:  3.55, dec:  -9.46, mag: 2.95, cls: "K" },  // δ Eri (Rana)
  { ra:  7.34, dec:  21.98, mag: 3.06, cls: "M" },  // μ Gem (Tejat)
  { ra:  6.38, dec:  22.51, mag: 2.87, cls: "M" },  // η Gem (Propus)
  { ra:  7.04, dec:  20.57, mag: 3.36, cls: "F" },  // ε Gem (Mebsuta)
  { ra:  7.43, dec:  27.80, mag: 3.50, cls: "F" },  // δ Gem (Wasat)
  { ra: 16.71, dec:  31.60, mag: 3.13, cls: "A" },  // δ Her
  { ra: 16.39, dec:  31.60, mag: 2.78, cls: "G" },  // ζ Her
  { ra: 17.25, dec:  36.81, mag: 3.16, cls: "A" },  // π Her
  { ra: 10.83, dec: -16.19, mag: 3.00, cls: "G" },  // γ Hya
  { ra:  8.93, dec:   5.95, mag: 3.11, cls: "B" },  // ζ Hya
  { ra:  5.55, dec: -17.82, mag: 2.58, cls: "F" },  // α Lep (Arneb)
  { ra:  5.47, dec: -20.76, mag: 2.81, cls: "G" },  // β Lep (Nihal)
  { ra: 14.71, dec: -47.39, mag: 2.30, cls: "B" },  // α Lup
  { ra: 15.07, dec: -52.10, mag: 2.68, cls: "B" },  // β Lup
  { ra: 16.61, dec:  -3.69, mag: 2.74, cls: "M" },  // δ Oph (Yed Prior)
  { ra: 16.62, dec:  -4.69, mag: 3.23, cls: "G" },  // ε Oph (Yed Posterior)
  { ra: 17.72, dec:   4.57, mag: 2.77, cls: "K" },  // β Oph (Cebalrai)
  { ra:  1.52, dec:  15.35, mag: 3.62, cls: "G" },  // η Psc (Alpherg)
  { ra:  7.72, dec: -37.10, mag: 2.71, cls: "F" },  // π Pup
  { ra:  6.83, dec: -50.61, mag: 3.01, cls: "K" },  // ν Pup
  { ra:  7.82, dec: -24.86, mag: 2.83, cls: "K" },  // ρ Pup
  { ra: 19.97, dec:  19.49, mag: 3.51, cls: "K" },  // γ Sge
  { ra: 18.96, dec: -29.88, mag: 2.59, cls: "A" },  // ζ Sgr (Ascella)
  { ra: 18.13, dec: -30.42, mag: 2.99, cls: "B" },  // γ Sgr (Alnasl)
  { ra: 17.71, dec: -37.30, mag: 2.69, cls: "B" },  // υ Sco
  { ra: 16.00, dec: -22.62, mag: 2.30, cls: "B" },  // β Sco (Graffias, dup safe)
  { ra: 16.00, dec: -19.81, mag: 2.32, cls: "B" },  // δ Sco (Dschubba)
  { ra: 15.74, dec:   6.43, mag: 2.63, cls: "K" },  // α Ser (Unukalhai)
  { ra:  4.84, dec:  19.18, mag: 3.41, cls: "A" },  // θ Tau
  { ra:  4.48, dec:  15.87, mag: 3.40, cls: "K" },  // ε Tau (Ain)
  { ra:  3.95, dec:  12.49, mag: 3.65, cls: "A" },  // γ Tau
  { ra:  4.38, dec:  17.93, mag: 3.76, cls: "K" },  // δ Tau
  { ra:  3.41, dec:  12.49, mag: 3.41, cls: "B" },  // λ Tau
  { ra:  2.16, dec:  34.99, mag: 3.00, cls: "A" },  // β Tri
  { ra: 11.30, dec:  31.53, mag: 3.06, cls: "K" },  // ψ UMa
  { ra:  9.79, dec: -54.57, mag: 2.21, cls: "K" },  // λ Vel
  { ra: 12.69, dec:  -1.45, mag: 2.74, cls: "F" },  // γ Vir (Porrima)
  { ra: 13.58, dec:   0.60, mag: 3.38, cls: "G" },  // ζ Vir
  { ra:  3.96, dec:  31.88, mag: 2.91, cls: "B" },  // ε Per
  { ra:  3.08, dec:  53.51, mag: 2.92, cls: "M" },  // δ Per
  { ra:  4.01, dec:  47.79, mag: 3.01, cls: "B" },  // γ Per
  { ra:  5.99, dec:  37.21, mag: 3.18, cls: "F" },  // δ Aur
  { ra:  6.06, dec:  39.18, mag: 3.69, cls: "K" },  // ν Aur
  { ra: 17.92, dec:   2.93, mag: 3.74, cls: "K" },  // β Ser
];

// Star "dot" radius scales with apparent flux: area ∝ flux, so
// radius = const × 10^(-mag/5) (one mag step → flux ratio of 10^(2/5) ≈
// 2.512, so r ratio of 10^(1/5) ≈ 1.585). This matches the Pogson scale
// and gives a visually proper sense of relative brightness — Sirius and
// Vega read as bigger than Polaris, Polaris bigger than mag-3 fillers.
// Saturated at the bright end (mag < -1) so Sirius doesn't dwarf the
// chart, and at the faint end so mag-4 stars stay readable.
function starDotRadius(mag) {
  if (mag == null) mag = 2.5;
  const r = 0.95 * Math.pow(10, -mag / 5);
  return Math.max(0.18, Math.min(2.0, r));
}
// Stars are functionally at infinity, so a label needs to appear in the
// star's direction regardless of camera position. We place each label
// at (camera + starDir × very_large_distance), updated every frame —
// any reasonable camera→label distance dwarfs the camera-to-Earth
// distance, so the apparent sky direction stays effectively constant
// at any zoom level. Distance is well inside Cesium's far plane but
// far enough that parallax is sub-pixel.
const STAR_FAR_M = 1e9; // 1 million km

function starDirectionEcef(star, jsDate) {
  const ra = star.ra * Math.PI / 12;
  const dec = star.dec * Math.PI / 180;
  const cdec = Math.cos(dec);
  const ex = cdec * Math.cos(ra);
  const ey = cdec * Math.sin(ra);
  const ez = Math.sin(dec);
  const gmst = sat.gstime(jsDate);
  const c = Math.cos(gmst), s = Math.sin(gmst);
  // ECI → ECEF: rotate by −gmst about Z so stars stay fixed in the
  // celestial frame as the (Earth-fixed) scene clock advances.
  return [c * ex + s * ey, -s * ex + c * ey, ez];
}

function starLabelPos(star, jsDate) {
  const d = starDirectionEcef(star, jsDate);
  const cam = viewer.camera.positionWC;
  return Cesium.Cartesian3.fromElements(
    cam.x + d[0] * STAR_FAR_M,
    cam.y + d[1] * STAR_FAR_M,
    cam.z + d[2] * STAR_FAR_M,
  );
}

for (const star of BRIGHT_STARS) {
  // Label-only: a small name floats at the star's sky direction.
  // Anchored bottom-center so the baseline of the text sits exactly at
  // the star position (label "labels" the unmarked point in the sky).
  // `show` is gated on the star being in front of Earth from the
  // camera so labels don't poke through the globe.
  viewer.entities.add({
    position: new Cesium.CallbackProperty((time) => {
      return starLabelPos(star, Cesium.JulianDate.toDate(time));
    }, false),
    label: {
      text: star.name,
      font: "10px sans-serif",
      fillColor: Cesium.Color.fromCssColorString("#cfd8ec").withAlpha(0.85),
      outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      showBackground: false,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -2),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: new Cesium.CallbackProperty((time) => {
        return isInFrontOfEarth(starLabelPos(star, Cesium.JulianDate.toDate(time)));
      }, false),
    },
  });
}

// ---------------------------------------------------------------------------
// Active pass gradient: a thick, colored overlay on the ISS orbit track that
// spans the visibility window of the currently-selected pass. The color at
// each point along the arc reflects the instantaneous quality of the pass
// (altitude × twilight × cloud), so the user can see at a glance WHERE in
// the arc the pass peaks and how it fades on either side.
//
// Rendered as N short polyline entities (one per sample segment) — each
// gets a single solid material color, so the segments together form a
// smooth gradient line along the ISS path.
// ---------------------------------------------------------------------------

const PASS_GRADIENT_SAMPLES = 60;
let activePassEntities = [];

// Stops for the rating gradient — used by both the orbit overlay
// (returning Cesium.Color via ratingColorAt) and every colored column
// in the passes list (returning a CSS rgb() string via ratingCssColor).
// Even thirds — red below 1/3 (success unlikely), yellow at 1/3 (coin
// flip-ish), green at 2/3+ (success very likely). 2/3 ≈ 0.67 is the
// "very likely" threshold; anything above that is fully saturated green.
const RATING_STOPS = [
  { t: 0.00,        r: 248, g: 113, b: 113 }, // red    (#f87171)
  { t: 1.0 / 3.0,   r: 250, g: 204, b:  21 }, // yellow (#facc15)
  { t: 2.0 / 3.0,   r:  52, g: 211, b: 153 }, // green  (#34d399)
  { t: 1.00,        r:  52, g: 211, b: 153 }, // saturate at green
];

function _interpRatingStop(score) {
  const s = Math.max(0, Math.min(1, score));
  for (let i = 0; i < RATING_STOPS.length - 1; i++) {
    const a = RATING_STOPS[i], b = RATING_STOPS[i + 1];
    if (s <= b.t) {
      const u = (s - a.t) / (b.t - a.t);
      return {
        r: Math.round(a.r + (b.r - a.r) * u),
        g: Math.round(a.g + (b.g - a.g) * u),
        b: Math.round(a.b + (b.b - a.b) * u),
      };
    }
  }
  return RATING_STOPS[RATING_STOPS.length - 1];
}

function ratingCssColor(score) {
  const c = _interpRatingStop(score);
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

// Like ratingCssColor but desaturates toward a neutral gray as the
// forecast skill decays — used for the clouds column, since point
// cloud-cover forecasts past day 1-2 carry diminishing trust. The
// skill curve matches effectivePClear (exp decay with tau = 4 days),
// FLOORED at 1/3 so the cell never gets more than 2/3 gray: a far-out
// cloud value retains enough color (~33%) to still hint at the forecast
// while clearly reading as "less trustworthy" via the gray cast.
function ratingCssColorWithSkill(score, ageDays) {
  const c = _interpRatingStop(score);
  const skill = Math.max(1 / 3, forecastSkill(ageDays));
  const gray = { r: 106, g: 122, b: 154 };
  const r = Math.round(c.r * skill + gray.r * (1 - skill));
  const g = Math.round(c.g * skill + gray.g * (1 - skill));
  const b = Math.round(c.b * skill + gray.b * (1 - skill));
  return `rgb(${r}, ${g}, ${b})`;
}

function ratingColorAt(score) {
  const c = _interpRatingStop(score);
  return Cesium.Color.fromBytes(c.r, c.g, c.b);
}

// ---------------------------------------------------------------------------
// Probability-factor curves — single source of truth for both the rating
// math AND the gradient coloring of the passes-list columns. The number
// you see colored in any column IS the value that contributed to the
// joint capture probability for that pass.
// ---------------------------------------------------------------------------

// Sky-darkness factor from sun altitude (apparent, refraction-corrected).
// Linear from horizon (sun = 0°) to nautical (sun = −12°), saturating at 1.
// Camera-reality threshold: nautical twilight is dark enough for sub-mag-3
// reference stars in a short exposure, even when the eye still sees glow.
function twilightFactor(sunAltDeg) {
  return Math.max(0, Math.min(1, -sunAltDeg / 12));
}

// ISS-altitude factor from apparent (refraction-corrected) altitude.
// 0 below 5° (horizon haze + obstructions), 1 by 25° (clean overhead sky).
// 15° → 0.5, 20° → 0.75. The previous ramp saturated at 30° which was
// too punishing for the moderate-altitude passes most amateurs target.
function altitudeFactor(apparentAltDeg) {
  return Math.max(0, Math.min(1, (apparentAltDeg - 5) / 20));
}

// Coordination/redundancy factor from pass duration. Sigmoid form so
// returns diminish past ~2 minutes: 30s → 0.33, 60s → 0.50, 120s → 0.67,
// 240s → 0.80. Captures the practical premium of longer passes (time to
// set up, multiple-frame attempts, recover from transient clouds).
function coordinationFactor(durSec) {
  return durSec / (durSec + 60);
}

// Forecast skill as a function of forecast age. Exponential decay with
// tau = 4 days (deterministic-cloud forecast skill rule-of-thumb).
// Returns 1 at age 0, ~0.37 at 4 days, ~0.08 at 10 days. Used by both
// effectivePClear (to blend the forecast toward neutral) and the
// clouds-column color desaturation (to fade the cell toward gray).
function forecastSkill(ageDays) {
  return ageDays > 0 ? Math.exp(-ageDays / 4) : 1;
}

// Cloud-clear factor: forecast P(clear) blended toward a neutral 0.5 by
// the forecastSkill curve. Day-1 forecasts trusted almost fully; by day 4
// we're ~37% direct + ~63% neutral; by day 10 mostly neutral. Returns
// 0.5 when no forecast is loaded for this point.
function effectivePClear(cloudPct, ageDays) {
  if (cloudPct == null) return 0.5;
  const direct = Math.max(0, 1 - cloudPct / 100);
  const skill = forecastSkill(ageDays);
  return skill * direct + (1 - skill) * 0.5;
}

// Joint probability that EVERY observer succeeds at the same instant.
//
// We combine factors differently based on how correlated each one is
// across observers, instead of a naïve product (which double-counts
// correlation and over-penalizes nearby observer clusters):
//
//   - twilightFactor (sky darkness): MIN across observers. Sun altitude
//     is essentially the same for observers within a few hundred km, so
//     the joint probability is determined by the worst-positioned
//     observer's twilight — not by cubing nearly-identical values.
//   - altitudeFactor (ISS height): PRODUCT across observers. Each
//     observer's view geometry is genuinely independent, so independent
//     successes legitimately compound.
//   - effectivePClear (clouds): MIN across observers. Cloud systems are
//     regional; if one nearby observer is socked in, others probably
//     are too. The MIN reads as "the weakest-link observer caps the
//     group."
//
// Returns 0 fast when any single observer fails the visibility gates
// (ISS below 5°, or sun above the horizon).
function captureProbJoint(observers, issEcef, jsDate, ms, nowMs) {
  let minDark = 1;
  let prodAlt = 1;
  let minClear = 1;
  const ageDays = (ms - nowMs) / 86_400_000;
  for (const obs of observers) {
    const apparentAlt = apparentAltDeg(issAltitudeDeg(obs, issEcef));
    if (apparentAlt < 5) return 0;
    const sunAlt = apparentAltDeg(sunAltitudeDeg(obs, jsDate));
    if (sunAlt >= 0) return 0;
    const d = twilightFactor(sunAlt);
    if (d < minDark) minDark = d;
    prodAlt *= altitudeFactor(apparentAlt);
    const c = effectivePClear(cloudAt(state.cloudForecasts.get(obs.id), ms), ageDays);
    if (c < minClear) minClear = c;
  }
  return minDark * prodAlt * minClear;
}

// Pass success probability = max joint probability over sampled moments,
// scaled by a duration factor that captures the practical coordination
// premium of longer passes (more time to set up, multiple-frame
// redundancy, recoverable from transient cloud blips). We don't OR
// across moments — geometry is deterministic and clouds are
// near-constant within a pass, so consecutive sample probabilities are
// heavily correlated, and a naïve "1 − ∏(1 − p)" would overcount.
//
// Duration sigmoid: pCoord = dur / (dur + 30). 30s → 0.50, 60s → 0.67,
// 120s → 0.80, 240s → 0.89, asymptotic to 1 — captures diminishing
// returns past ~2 minutes (more time doesn't keep helping forever).
function passSuccessProbability(win, observers) {
  if (!win || !observers.length) return 0;
  const totalMs = win.endMs - win.startMs;
  if (totalMs <= 0) return 0;
  const STEP_MS = Math.max(1_000, Math.min(5_000, totalMs / 30));
  const nowMs = Date.now();
  let best = 0;
  for (let t = win.startMs; t <= win.endMs; t += STEP_MS) {
    const d = new Date(t);
    const issEcef = issEcefAt(d);
    if (!issEcef) continue;
    const p = captureProbJoint(observers, issEcef, d, t, nowMs);
    if (p > best) best = p;
  }
  return best * coordinationFactor(totalMs / 1000);
}


// Visual magnitude of the (sunlit) ISS from one observer at one instant.
// Standard satellite-magnitude formula:
//   m = m_std + 5·log10(range / 1000 km)  −  2.5·log10(F(α))
// where m_std = −1.8 is the intrinsic magnitude at 1000 km / full phase,
// α is the phase angle (satellite→sun vs satellite→observer), and
// F(α) = (1 + cos α) / 2 is the Lambertian-sphere phase function.
// Returns null when the observer is looking at the unlit hemisphere
// (F ≤ 0) — in that case the satellite isn't visible at all.
function magnitudeAt(obs, issEcef, sunDir) {
  const obsEcef = geodeticToEcef(obs.latDeg, obs.lonDeg, 0);
  const dx = obsEcef[0] - issEcef[0];
  const dy = obsEcef[1] - issEcef[1];
  const dz = obsEcef[2] - issEcef[2];
  const range = Math.hypot(dx, dy, dz);
  if (range <= 0) return null;
  const inv = 1 / range;
  // cos(α) = dot(unit_iss→obs, sun_dir). Sun is effectively at infinity,
  // so the sun direction from the ISS is the same as from Earth.
  const cosAlpha = (dx * sunDir[0] + dy * sunDir[1] + dz * sunDir[2]) * inv;
  const F = (1 + cosAlpha) / 2;
  if (F <= 0) return null;
  return -1.8 + 5 * Math.log10(range / 1_000_000) - 2.5 * Math.log10(F);
}

// Peak joint-visibility magnitude within the window.
// At each sampled moment we take the WORST (dimmest, highest m)
// magnitude across the observers — the floor everyone is guaranteed to
// see at that instant — and then across moments we take the BRIGHTEST
// (lowest m) of those floors. This is the minimax magnitude: the
// moment where even the dimmest observer sees the ISS at its best
// across the joint-visibility window.
function peakMagnitudeInWindow(win, observers) {
  if (!win || !observers.length) return null;
  const totalMs = win.endMs - win.startMs;
  if (totalMs <= 0) return null;
  const STEP_MS = Math.max(1_000, Math.min(5_000, totalMs / 30));
  let bestOfWorsts = Infinity;
  for (let t = win.startMs; t <= win.endMs; t += STEP_MS) {
    const d = new Date(t);
    const issEcef = issEcefAt(d);
    if (!issEcef) continue;
    const sunDir = sunPositionEcef(d);
    let worstAtT = -Infinity;
    let anyValid = false;
    for (const obs of observers) {
      const m = magnitudeAt(obs, issEcef, sunDir);
      if (m == null) continue;
      anyValid = true;
      if (m > worstAtT) worstAtT = m;
    }
    if (!anyValid) continue;
    if (worstAtT < bestOfWorsts) bestOfWorsts = worstAtT;
  }
  return bestOfWorsts === Infinity ? null : bestOfWorsts;
}

function clearActivePassGradient() {
  for (const ent of activePassEntities) viewer.entities.remove(ent);
  activePassEntities = [];
}

function renderActivePassGradient(win) {
  clearActivePassGradient();
  if (!win || !satrec || !state.observers.length) return;
  const totalMs = win.endMs - win.startMs;
  if (totalMs <= 0) return;
  // Sample ISS positions + per-sample quality along the window.
  const samples = [];
  const nowMs = Date.now();
  for (let i = 0; i <= PASS_GRADIENT_SAMPLES; i++) {
    const t = win.startMs + totalMs * (i / PASS_GRADIENT_SAMPLES);
    const d = new Date(t);
    const issEcef = issEcefAt(d);
    if (!issEcef) continue;
    samples.push({
      pos: Cesium.Cartesian3.fromElements(issEcef[0], issEcef[1], issEcef[2]),
      quality: captureProbJoint(state.observers, issEcef, d, t, nowMs),
    });
  }
  // Draw each segment between adjacent samples with color from the
  // midpoint quality. Solid color material (not glow — glow's white core
  // washes the color out) keeps the gradient vivid against the dashed
  // full-orbit guide underneath.
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    const segQ = (a.quality + b.quality) / 2;
    const ent = viewer.entities.add({
      polyline: {
        positions: [a.pos, b.pos],
        width: 9,
        material: new Cesium.ColorMaterialProperty(ratingColorAt(segQ).withAlpha(0.95)),
        arcType: Cesium.ArcType.NONE,
      },
    });
    activePassEntities.push(ent);
  }
}

// Refresh satrec whenever TLE inputs change. Invalidate orbit cache so it
// picks up the new TLE on the next frame.
[tleNameEl, tleL1El, tleL2El].forEach(el => el.addEventListener("input", () => {
  refreshSatrec();
  invalidateOrbitCache();
}));
// Also after initial fetch.
const _loadTle = loadTle;
loadTle = async function () {
  await _loadTle();
  refreshSatrec();
  ensureIssEntity();
  ensureOrbitEntity();
  ensureGpLineEntity();
  invalidateOrbitCache();
  // Kick off the auto-search now that the TLE is available (if observers
  // were already placed; otherwise the next addObserver will trigger it).
  rerunSearchIfActive();
};
loadTle();

// Shareable state + persistence.
//
// All shareable state goes into a single base64url-encoded JSON blob
// behind ?s=...  Compact JSON shape:
//   { o: [[name, lat, lon], ...], t?: passStartMs }
// where `t` (if present) is the start time of a specific pass window
// the user had selected — when someone opens the link, we jump to the
// window matching that start time so they land exactly where the
// sharer was looking.
//
// Sources of truth on load, in priority order:
//   1. URL ?s=... (sharable links beat localStorage so opening
//      someone else's link doesn't pick up your own saved observers)
//   2. localStorage entry under LS_STATE_KEY
//   3. The seeded Chicago/Milwaukee/Cincinnati defaults
const LS_STATE_KEY = "iss-triangulation/state/v1";

// Time-of-pass that was on the URL when the page loaded — consumed by
// the first runSearch to jump to the matching window instead of #0.
let _pendingPassTimeMs = null;

// URL-safe base64 (a.k.a. base64url): +/= replaced so it survives in
// query strings without needing further URL-encoding.
function b64urlEncode(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(b64) {
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return atob(b64.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

function encodeStateBlob() {
  const obj = {
    o: state.observers.map(o => [o.name, +o.latDeg.toFixed(5), +o.lonDeg.toFixed(5)]),
  };
  if (state.activeWindowIdx >= 0 && state.windows[state.activeWindowIdx]) {
    obj.t = state.windows[state.activeWindowIdx].startMs;
  }
  return b64urlEncode(JSON.stringify(obj));
}

function decodeStateBlob(blob) {
  if (!blob) return null;
  try {
    const obj = JSON.parse(b64urlDecode(blob));
    const observers = Array.isArray(obj.o)
      ? obj.o
          .map(e => Array.isArray(e) && e.length >= 3
            ? { name: String(e[0] || "Observer"), latDeg: +e[1], lonDeg: +e[2] }
            : null)
          .filter(o => o && Number.isFinite(o.latDeg) && Number.isFinite(o.lonDeg))
      : [];
    return {
      observers,
      passTimeMs: Number.isFinite(obj.t) ? Number(obj.t) : null,
    };
  } catch (_) {
    return null;
  }
}

function persistState() {
  const blob = encodeStateBlob();
  try {
    localStorage.setItem(LS_STATE_KEY, blob);
  } catch (_) { /* private browsing etc. — silently skip */ }
  const url = new URL(window.location.href);
  if (state.observers.length) {
    url.search = `?s=${blob}`;
  } else {
    url.search = "";
  }
  history.replaceState(null, "", url);
}

function loadInitialObservers() {
  const urlBlob = new URLSearchParams(window.location.search).get("s");
  const fromUrl = decodeStateBlob(urlBlob);
  if (fromUrl && fromUrl.observers.length) {
    for (const o of fromUrl.observers) addObserver(o.name, o.latDeg, o.lonDeg);
    _pendingPassTimeMs = fromUrl.passTimeMs;
    return;
  }
  const fromStorage = decodeStateBlob(
    (() => { try { return localStorage.getItem(LS_STATE_KEY); } catch (_) { return null; } })()
  );
  if (fromStorage && fromStorage.observers.length) {
    for (const o of fromStorage.observers) addObserver(o.name, o.latDeg, o.lonDeg);
    return;
  }
  addObserver("Chicago",    41.8781, -87.6298);
  addObserver("Milwaukee",  43.0389, -87.9065);
  addObserver("Cincinnati", 39.1031, -84.5120);
}

loadInitialObservers();

// Periodic cloud-forecast refresh. Pairs with the cache's 10-minute
// TTL — every 15-minute tick crosses the TTL and triggers a real
// network fetch, so a long-open page keeps near-fresh data without
// reloading. (Open-Meteo's HRRR model only updates hourly, but
// catching the next update within 15 min of it landing is the goal.)
const CLOUD_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
setInterval(() => {
  if (!state.observers.length) return;
  for (const obs of state.observers) {
    fetchCloudForecast(obs.latDeg, obs.lonDeg).then(f => {
      state.cloudForecasts.set(obs.id, f);
      if (state.windows && state.windows.length) renderWindowsList();
    });
  }
}, CLOUD_REFRESH_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Task 11: Search controls + windows-list rendering + click-to-jump
// ---------------------------------------------------------------------------

state.horizonDays = 30;
state.multiplier = 10;
state.windows = [];
state.activeWindowIdx = -1;
state.searchEndMs = null;

// Default the clock to "now" running at real time so the page shows the
// current ISS position as soon as it loads. startTime stays at "now" so
// Reset returns here; stopTime far enough out that real-time playback
// doesn't bump into ClockRange.CLAMPED before the user runs a search.
{
  const nowJd = Cesium.JulianDate.fromDate(new Date());
  viewer.clock.startTime = nowJd;
  viewer.clock.stopTime  = Cesium.JulianDate.addDays(nowJd, 7, new Cesium.JulianDate());
  viewer.clock.currentTime = nowJd;
  viewer.clock.multiplier = state.multiplier;
  viewer.clock.shouldAnimate = true;
}

const speedSelect = document.getElementById("speed-select");
const windowsListEl = document.getElementById("windows-list");

// Pane toggle — slides #panel-left off-screen, swaps the toggle's icon
// via the .panel-collapsed body class (all visual changes are CSS-driven).
document.getElementById("panel-toggle").addEventListener("click", () => {
  document.body.classList.toggle("panel-collapsed");
});

// Share button — copies the current URL (kept in sync with observers by
// persistObservers) to the clipboard, with a brief "Copied!" confirmation.
const shareBtn = document.getElementById("share-btn");
shareBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    shareBtn.textContent = "Copied!";
    shareBtn.classList.add("copied");
  } catch (_) {
    shareBtn.textContent = "Copy failed";
  }
  setTimeout(() => {
    shareBtn.textContent = "Share";
    shareBtn.classList.remove("copied");
  }, 1500);
});

speedSelect.addEventListener("change", () => {
  state.multiplier = Number(speedSelect.value);
  viewer.clock.multiplier = state.multiplier;
});

let searchGen = 0;
let _autoSelectedFirst = false; // ensures we auto-jump to the first window once

function runSearch(startMs, endMs) {
  if (!satrec) return; // wait for TLE
  if (!state.observers.length) return; // wait for observers
  // Only show the "searching…" placeholder if the list is currently empty
  // (initial load or after clearing observers). On subsequent searches the
  // old results stay visible until renderWindowsList atomically swaps in
  // the new ones — avoids a jarring blank/flash on observer add/remove.
  const hasResults = !!windowsListEl.querySelector(".window-row:not(.header)");
  if (!hasResults) {
    windowsListEl.replaceChildren();
    const searching = document.createElement("div");
    searching.className = "window-empty";
    searching.textContent = "searching…";
    windowsListEl.appendChild(searching);
  }
  const gen = ++searchGen; // invalidates any older deferred searches
  setTimeout(() => {
    if (gen !== searchGen) return; // a newer search superseded us
    const wins = findVisibilityWindows(
      state.observers, satrec, isVisibleAtAll, sat,
      startMs, endMs, 60_000
    );
    state.windows = state.windows.concat(wins);
    state.searchEndMs = endMs;
    renderWindowsList();
    setupClockForSearch(startMs, endMs);
    // First time the list populates, jump to the upcoming pass so the user
    // sees a useful framing immediately. Skipped on re-searches so adding
    // observers doesn't yank the camera away from the user's selection.
    if (!_autoSelectedFirst && state.windows.length) {
      _autoSelectedFirst = true;
      // If the URL carried a specific pass time (?s=...t=...), jump to
      // the matching window so the sharer's selection survives; else
      // land on the upcoming pass like before.
      let idx = 0;
      if (_pendingPassTimeMs != null) {
        const matched = findWindowIndexNearTime(_pendingPassTimeMs);
        if (matched !== -1) idx = matched;
        _pendingPassTimeMs = null;
      }
      jumpToWindow(idx);
    }
    // First completed search → page is "ready": TLE loaded, observers
    // placed, windows rendered, camera framed (or about to be). Fade the
    // full-page loader out so the user sees a populated scene rather
    // than pins/labels/panels popping in piecemeal.
    dismissPageLoader();
  }, 0);
}

let _pageLoaderDismissed = false;
function dismissPageLoader() {
  if (_pageLoaderDismissed) return;
  _pageLoaderDismissed = true;
  document.getElementById("page-loader")?.classList.add("hidden");
}
// Safety net: if something goes wrong (TLE fetch fails, no observers,
// etc.) and runSearch never fires, drop the loader after a few seconds
// so the user isn't stuck on a black screen.
setTimeout(dismissPageLoader, 5000);

// Auto-search whenever observers AND TLE are available, starting "now" and
// running for state.horizonDays. Called on observer add/remove and after
// TLE load. No-op if either prerequisite is missing.
function rerunSearchIfActive() {
  if (!state.observers.length) {
    // No observers → nothing to search. Clear state + list so the prior
    // results don't linger after the user removes the last observer.
    state.windows = [];
    state.activeWindowIdx = -1;
    clearActivePassGradient();
    windowsListEl.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "window-empty";
    empty.textContent = "add an observer to begin";
    windowsListEl.appendChild(empty);
    return;
  }
  if (!satrec) return;
  state.windows = [];
  state.activeWindowIdx = -1;
  clearActivePassGradient();
  const startMs = Date.now();
  const endMs = startMs + state.horizonDays * 86_400_000;
  runSearch(startMs, endMs);
}

function setupClockForSearch(startMs, endMs) {
  // Update the clock's range to span the search, but DON'T touch
  // currentTime — the user's scrubbed position (or a previously-clicked
  // window) must survive across re-searches (observer add/remove) and
  // "Find more" extensions. Reset the clock via the Reset button.
  viewer.clock.startTime = Cesium.JulianDate.fromDate(new Date(startMs));
  viewer.clock.stopTime = Cesium.JulianDate.fromDate(new Date(endMs));
  viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED;
  viewer.clock.multiplier = state.multiplier;
}

function renderWindowsList() {
  windowsListEl.replaceChildren();
  // Column header row — uses subgrid like data rows so labels align with
  // their column. Always rendered (even when empty) so the headings act
  // as a stable orientation cue for the list area.
  const hdr = document.createElement("div");
  hdr.className = "window-row header";
  for (const label of ["P%", "Time (UTC)", "Dur", "Sun", "Alt", "Mag", "Clouds"]) {
    const c = document.createElement("span");
    c.textContent = label;
    hdr.appendChild(c);
  }
  windowsListEl.appendChild(hdr);
  if (!state.windows.length) {
    const empty = document.createElement("div");
    empty.className = "window-empty";
    empty.textContent = "no simultaneous passes found";
    windowsListEl.appendChild(empty);
    return;
  }
  state.windows.forEach((w, i) => {
    // Pre-compute the values that drive multiple columns AND the rating.
    const durSec = Math.round((w.endMs - w.startMs) / 1000);
    const peakMs = bestMomentMs(w);
    const issEcef = issEcefAt(new Date(peakMs));
    let minAlt = Infinity, maxAlt = -Infinity;
    if (issEcef && state.observers.length) {
      for (const obs of state.observers) {
        const a = issAltitudeDeg(obs, issEcef);
        if (a < minAlt) minAlt = a;
        if (a > maxAlt) maxAlt = a;
      }
    }
    if (!Number.isFinite(minAlt)) { minAlt = 0; maxAlt = 0; }
    const cloud = cloudRange(peakMs); // { min, max } or null — display only
    const timeFactor = worstLocalTimeScore(peakMs); // colors the time col only
    // Rating = P(every observer captures ISS + reference stars at the
    // same instant in the window), scaled by a duration sigmoid for
    // coordination headroom. Displayed as percent digits, colored on
    // the shared red→yellow→green gradient. Time-of-day is deliberately
    // not part of this score (it's a "will the human be outside?"
    // factor, separate from "can the capture succeed?").
    const passP = passSuccessProbability(w, state.observers);
    const ratingTooltip = `joint capture probability ${(passP * 100).toFixed(0)}% (best moment in window, scaled by duration headroom)`;

    const row = document.createElement("div");
    row.className = "window-row";
    if (i === state.activeWindowIdx) row.classList.add("active");

    // Rating column — joint capture-probability digits (no % sign, saves
    // width), colored continuously on the same gradient the orbit
    // overlay uses.
    const r = document.createElement("span");
    r.className = "rating";
    r.textContent = `${Math.round(passP * 100)}`;
    r.style.color = ratingCssColor(passP);
    r.title = ratingTooltip;
    row.appendChild(r);

    // Time column (UTC, peak/best moment) — left intentionally uncolored
    // so the colored columns (rating, sun, dur, alt, mag, clouds) carry
    // the visual signal and the date/time reads as neutral context.
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = new Date(peakMs).toISOString().slice(5, 19).replace("T", " ");
    row.appendChild(time);

    // Duration column — color follows coordinationFactor(durSec) on the
    // shared red→yellow→green gradient. 30s pass shows yellow-orange,
    // 1m mid yellow-green, 2m hits green, 4m+ saturated.
    const dur = document.createElement("span");
    dur.className = "dur";
    const mm = Math.floor(durSec / 60), ss = durSec % 60;
    dur.textContent = `${mm}m${ss < 10 ? "0" : ""}${ss}s`;
    dur.style.color = ratingCssColor(coordinationFactor(durSec));
    row.appendChild(dur);

    // Sun-altitude column — worst (highest = brightest) observer at the
    // peak moment, refraction-corrected. Color is the literal twilight
    // factor used in the rating math: twilightFactor(sunAlt).
    const peakDate = new Date(peakMs);
    let worstSunAlt = -Infinity;
    for (const obs of state.observers) {
      const sa = apparentAltDeg(sunAltitudeDeg(obs, peakDate));
      if (sa > worstSunAlt) worstSunAlt = sa;
    }
    const sun = document.createElement("span");
    sun.className = "sun";
    sun.textContent = Number.isFinite(worstSunAlt) ? `${Math.round(worstSunAlt)}°` : "—";
    if (Number.isFinite(worstSunAlt)) {
      sun.style.color = ratingCssColor(twilightFactor(worstSunAlt));
    } else {
      sun.classList.add("na");
    }
    row.appendChild(sun);

    // Altitude range — value is min–max alt across observers at peak.
    // Color is the PRODUCT of altitudeFactor across observers (matches
    // the joint model's treatment of altitude as the genuinely-
    // independent factor that legitimately compounds). Single observer:
    // product = single factor. Multi-observer: each weaker observer
    // multiplicatively pulls the color toward red.
    const alt = document.createElement("span");
    alt.className = "alt";
    const altLo = Math.round(minAlt), altHi = Math.round(maxAlt);
    alt.textContent = altLo === altHi ? `${altHi}°` : `${altLo}–${altHi}°`;
    let prodAlt = 1;
    if (issEcef) {
      for (const obs of state.observers) {
        prodAlt *= altitudeFactor(apparentAltDeg(issAltitudeDeg(obs, issEcef)));
      }
    } else {
      prodAlt = 0;
    }
    alt.style.color = ratingCssColor(prodAlt);
    row.appendChild(alt);

    // Peak magnitude — colored on the same gradient: mag = −3 → green
    // (brilliant), 0 → yellow, +1 → red (very faint).
    const mag = document.createElement("span");
    mag.className = "mag";
    const peakMag = peakMagnitudeInWindow(w, state.observers);
    if (peakMag == null) {
      mag.textContent = "—";
      mag.classList.add("na");
    } else {
      mag.textContent = peakMag.toFixed(1);
      mag.style.color = ratingCssColor(Math.max(0, Math.min(1, (-peakMag + 1) / 4)));
    }
    row.appendChild(mag);

    // Cloud cover range — gradient color indexed by P(clear), DESAT'd
    // toward gray as the forecast horizon stretches out. Uses the same
    // exp(−age/4) skill curve effectivePClear uses inside the rating
    // math: a clouds value 8+ days out displays mostly gray, signaling
    // "this number isn't trustworthy enough to color." 0 days → vivid.
    const cl = document.createElement("span");
    cl.className = "cloud";
    if (cloud === null) {
      cl.textContent = "—";
      cl.classList.add("na");
    } else {
      const clLo = Math.round(cloud.min), clHi = Math.round(cloud.max);
      cl.textContent = clLo === clHi ? `${clHi}%` : `${clLo}–${clHi}%`;
      const ageDays = (peakMs - Date.now()) / 86_400_000;
      cl.style.color = ratingCssColorWithSkill(1 - clHi / 100, ageDays);
    }
    row.appendChild(cl);

    row.addEventListener("click", () => jumpToWindow(i));
    windowsListEl.appendChild(row);
  });
}

// Per-observer time-of-day preference for naked-eye viewing, 0-1.
// Peaks during prime evening (7-11pm), troughs in the dead of night (3-4am).
// Uses longitude/15 as the local-time offset — close enough for "people are
// awake or asleep" purposes without an IANA timezone lookup.
function localTimeScore(localHour) {
  const h = ((localHour % 24) + 24) % 24;
  if (h >= 19 && h < 23) return 1.0;                   // 7-11pm: prime
  if (h >= 23 && h < 24) return 1.0 - (h - 23) * 0.3;  // 11pm-mid: 1.0→0.7
  if (h >= 0  && h < 1)  return 0.7 - h * 0.2;         // 12-1am: 0.7→0.5
  if (h >= 1  && h < 4)  return 0.5 - (h - 1) * 0.083; // 1-4am: 0.5→0.25
  if (h >= 4  && h < 5)  return 0.25;                  // 4-5am: trough
  if (h >= 5  && h < 7)  return 0.25 + (h - 5) * 0.225;// 5-7am: 0.25→0.7
  if (h >= 18 && h < 19) return 0.85;                  // 6-7pm: dusk
  return 0.5;                                          // daytime (filtered by sun predicate)
}

// Worst-observer time-of-day score at a given moment. Used as the rating's
// time factor so a pass that's prime-evening for one observer but 3am for
// another is correctly penalized.
function worstLocalTimeScore(peakMs) {
  if (!state.observers.length) return 1.0;
  const d = new Date(peakMs);
  const utcHour = d.getUTCHours() + d.getUTCMinutes()/60 + d.getUTCSeconds()/3600;
  let worst = 1.0;
  for (const obs of state.observers) {
    const s = localTimeScore(utcHour + obs.lonDeg / 15);
    if (s < worst) worst = s;
  }
  return worst;
}

// Cloud cover range across observers at a given ms: returns { min, max }
// (each 0-100), or null if any observer's forecast isn't loaded yet.
function cloudRange(ms) {
  let min = Infinity, max = -Infinity;
  for (const obs of state.observers) {
    const f = state.cloudForecasts.get(obs.id);
    const c = cloudAt(f, ms);
    if (c == null) return null;
    if (c < min) min = c;
    if (c > max) max = c;
  }
  if (!Number.isFinite(min)) return null;
  return { min, max };
}

// Best moment in a window = where the MINIMUM altitude across all observers is
// MAXIMIZED. That's the instant when every observer simultaneously sees the
// ISS as high as it gets given the geometry.
function bestMomentMs(w) {
  const stepMs = 5000;
  let bestMs = w.startMs;
  let bestMinAlt = -Infinity;
  for (let t = w.startMs; t <= w.endMs; t += stepMs) {
    const issEcef = issEcefAt(new Date(t));
    if (!issEcef) continue;
    let minAlt = Infinity;
    for (const obs of state.observers) {
      const a = issAltitudeDeg(obs, issEcef);
      if (a < minAlt) minAlt = a;
    }
    if (minAlt > bestMinAlt) {
      bestMinAlt = minAlt;
      bestMs = t;
    }
  }
  return bestMs;
}

function jumpToWindow(i) {
  state.activeWindowIdx = i;
  const w = state.windows[i];
  // Park the clock at the window's start so the user can play through the
  // whole simultaneously-visible interval; the table shows the peak time.
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(w.startMs));
  viewer.clock.shouldAnimate = false;
  invalidateOrbitCache(); // force orbit refresh at the jumped time
  renderWindowsList();
  renderActivePassGradient(w); // colored overlay on the orbit for THIS pass
  refreshAllPolarPlotArcs();   // update each observer's sky-chart arc
  // On narrow viewports the panel covers almost the entire screen, so
  // frameAll has nowhere visible to fit the trajectory into. Collapse
  // the panel first; the user can re-open it via #panel-toggle when
  // they want to pick another pass.
  if (window.innerWidth <= 600) {
    document.body.classList.add("panel-collapsed");
  }
  cameraCtrl.frameAll(); // pull observers + ISS into view for the moment we jumped to
  // Keep the URL up to date so the Share link always points at the
  // currently-selected pass.
  persistState();
}

// Find the index of the window whose start time is closest to targetMs.
// Used when loading a shared URL with a ?s=...t=... blob to land on the
// same window the sharer was looking at. Returns -1 if no windows exist.
function findWindowIndexNearTime(targetMs) {
  if (!state.windows.length) return -1;
  let bestIdx = -1, bestDelta = Infinity;
  for (let i = 0; i < state.windows.length; i++) {
    const delta = Math.abs(state.windows[i].startMs - targetMs);
    if (delta < bestDelta) { bestDelta = delta; bestIdx = i; }
  }
  return bestIdx;
}

// ---------------------------------------------------------------------------
// Task 12: Playback controls + camera presets
// ---------------------------------------------------------------------------

const playBtn = document.getElementById("play-btn");
const pauseBtn = document.getElementById("pause-btn");
const resetBtn = document.getElementById("reset-btn");

playBtn.addEventListener("click", () => {
  viewer.clock.shouldAnimate = true;
});
pauseBtn.addEventListener("click", () => {
  viewer.clock.shouldAnimate = false;
});
resetBtn.addEventListener("click", () => {
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date());
  viewer.clock.shouldAnimate = false;
  state.activeWindowIdx = -1;
  renderWindowsList();
});

// Camera presets share their wiring with the triangulation page; we just
// describe what counts as the orbit anchor (observers' centroid) and what
// points need to stay in frame (observers + ISS at the current clock time).
// First-person camera mode: when an observer's "view from here" button
// is clicked, the camera locks to that observer's location looking up
// at the ISS, updated every frame so the user can play through a pass
// and watch the ISS arc across the sky from their POV. (`_fpsObserverId`
// itself is declared higher up in the file — it's read during initial
// renderObsList before this section runs.)
//
// FPS mode widens the camera FOV to ~90° (roughly human-eye coverage)
// since the default ~60° crops out high-altitude passes. The original
// frustum.fov is saved on entry and restored on exit.
const FPS_FOV_RADIANS = Math.PI / 2; // 90° horizontal
let _savedFov = null;
function setFpsObserver(obsId) {
  const newId = (_fpsObserverId === obsId) ? null : obsId;
  if (newId !== null && _fpsObserverId === null) {
    _savedFov = viewer.camera.frustum.fov;
    viewer.camera.frustum.fov = FPS_FOV_RADIANS;
    viewer.camera.cancelFlight();
  } else if (newId === null && _savedFov !== null) {
    viewer.camera.frustum.fov = _savedFov;
    _savedFov = null;
  }
  _fpsObserverId = newId;
  renderObsList();
}
function exitFpsMode() {
  if (_fpsObserverId !== null && _savedFov !== null) {
    viewer.camera.frustum.fov = _savedFov;
    _savedFov = null;
  }
  _fpsObserverId = null;
  renderObsList();
}

// Per-frame: keep each observer card's polar plot ISS dot in sync with
// the current sim time. Arc is static for the active window — only the
// dot moves frame-to-frame.
viewer.scene.preRender.addEventListener(() => {
  for (const svg of obsListEl.querySelectorAll(".polar-plot")) {
    const obs = state.observers.find(o => o.id === svg.dataset.obsId);
    if (obs) updatePolarPlotDot(svg, obs);
  }
  // Position each observer's HTML label at (pin_screen + label_offset)
  // and refresh its text content for the current sim time. The label
  // contains both the polar-plot icon AND the text in a single flex
  // box. CSS anchors the element by its bottom-left so the natural
  // offset (+12, -10) lifts the label up-and-right of the pin.
  const _nowDate = Cesium.JulianDate.toDate(viewer.clock.currentTime);
  const _nowMs = _nowDate.getTime();
  for (const wrapper of iconLayerEl.children) {
    const obs = state.observers.find(o => o.id === wrapper.dataset.obsId);
    if (!obs) { wrapper.style.display = "none"; continue; }
    const posCart = Cesium.Cartesian3.fromDegrees(obs.lonDeg, obs.latDeg, 0);
    if (!isInFrontOfEarth(posCart)) { wrapper.style.display = "none"; continue; }
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, posCart);
    if (!screen) { wrapper.style.display = "none"; continue; }
    // Skip labels whose anchor is off-screen — they'd just sit
    // clipped at the viewport edge and on mobile they have been
    // observed to expand the document layout area.
    if (screen.x < -8 || screen.y < -8 ||
        screen.x > window.innerWidth + 8 ||
        screen.y > window.innerHeight + 8) {
      wrapper.style.display = "none"; continue;
    }
    const off = labelOffsets.get(`pin:${obs.id}`) ?? { dx: 0, dy: 0 };
    wrapper.style.display = "";
    wrapper.style.left = `${screen.x + 12 + off.dx}px`;
    wrapper.style.top = `${screen.y - 10 + off.dy}px`;
    updateObserverLabelText(wrapper, obs, _nowDate, _nowMs);
  }
  // The fullscreen modal is a PNG snapshot taken when it opens — no
  // per-frame updates there. Close/reopen to refresh.
});

viewer.scene.preRender.addEventListener(() => {
  if (_fpsObserverId === null) return;
  const obs = state.observers.find(o => o.id === _fpsObserverId);
  if (!obs) { _fpsObserverId = null; return; }
  const d = Cesium.JulianDate.toDate(viewer.clock.currentTime);
  const issEcef = issEcefAt(d);
  if (!issEcef) return;

  // Eye position: 50 m behind the observer along the horizontal
  // direction to the ISS, lifted 3 m above the ground. Behind so the
  // observer's pin/label sits in the foreground; up so we don't dip
  // through terrain imagery.
  const origin = geodeticToEcef(obs.latDeg, obs.lonDeg, 0);
  const dir = [issEcef[0]-origin[0], issEcef[1]-origin[1], issEcef[2]-origin[2]];
  const L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const dirUnit = [dir[0]/L, dir[1]/L, dir[2]/L];
  const R = Math.hypot(origin[0], origin[1], origin[2]);
  const up = [origin[0]/R, origin[1]/R, origin[2]/R];
  const dotUp = dirUnit[0]*up[0] + dirUnit[1]*up[1] + dirUnit[2]*up[2];
  let dh = [dirUnit[0] - dotUp*up[0], dirUnit[1] - dotUp*up[1], dirUnit[2] - dotUp*up[2]];
  let Lh = Math.hypot(dh[0], dh[1], dh[2]);
  if (Lh < 1e-6) { dh = [1, 0, 0]; Lh = 1; } // ISS at zenith, arbitrary dir
  const dirHoriz = [dh[0]/Lh, dh[1]/Lh, dh[2]/Lh];
  const camPos = [
    origin[0] - dirHoriz[0]*50 + up[0]*3,
    origin[1] - dirHoriz[1]*50 + up[1]*3,
    origin[2] - dirHoriz[2]*50 + up[2]*3,
  ];

  // Aim directly at the ISS so it stays centered no matter how high it
  // gets (the previous bisector-of-observer-and-ISS aim left high-alt
  // passes cropped at the top of the frame). With the wide FPS FOV +
  // the 50m horizontal back-step, the observer pin still appears in
  // the lower portion of the view for low/mid-altitude passes.
  const toIss = [issEcef[0]-camPos[0], issEcef[1]-camPos[1], issEcef[2]-camPos[2]];
  const Li = Math.hypot(toIss[0], toIss[1], toIss[2]) || 1;
  const aim = [toIss[0]/Li, toIss[1]/Li, toIss[2]/Li];
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromElements(camPos[0], camPos[1], camPos[2]),
    orientation: {
      direction: Cesium.Cartesian3.fromElements(aim[0], aim[1], aim[2]),
      up: Cesium.Cartesian3.fromElements(up[0], up[1], up[2]),
    },
  });
});

const cameraCtrl = wireCameraControls(viewer, {
  beforePreset: () => exitFpsMode(),
  getOrbitAnchor: () => {
    if (!state.observers.length) return Cesium.Cartesian3.fromDegrees(0, 0, 0);
    const avgLat = state.observers.reduce((s, o) => s + o.latDeg, 0) / state.observers.length;
    const avgLon = state.observers.reduce((s, o) => s + o.lonDeg, 0) / state.observers.length;
    return Cesium.Cartesian3.fromDegrees(avgLon, avgLat, 0);
  },
  getFramePositions: () => {
    const ps = state.observers.map(o =>
      Cesium.Cartesian3.fromDegrees(o.lonDeg, o.latDeg, 0));
    const issEcef = issEcefAt(Cesium.JulianDate.toDate(viewer.clock.currentTime));
    if (issEcef) ps.push(Cesium.Cartesian3.fromElements(issEcef[0], issEcef[1], issEcef[2]));
    // When a pass is selected, sample positions along its visibility
    // window so the frame includes the full colored arc — not just the
    // ISS at "now". Without this the frame is too tight when the
    // current clock time happens to be at the pass start/end.
    const w = state.windows?.[state.activeWindowIdx];
    if (w) {
      const FRAME_ARC_SAMPLES = 12;
      const dt = w.endMs - w.startMs;
      for (let i = 0; i <= FRAME_ARC_SAMPLES; i++) {
        const t = w.startMs + (dt * i) / FRAME_ARC_SAMPLES;
        const e = issEcefAt(new Date(t));
        if (e) ps.push(Cesium.Cartesian3.fromElements(e[0], e[1], e[2]));
      }
    }
    return ps;
  },
});
