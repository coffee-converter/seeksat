// pass-finder.js -- ISS multi-observer pass finder.

import { parseDmsToDecimal, geodeticToEcef } from "../lib/coords.js";
import { geocodeOne } from "../lib/pass-finder/geocode.js";
import { fetchIssTle } from "../lib/pass-finder/tle.js";
import { isVisibleAtAll, isRadioReachable, issAltitudeDeg, issAltAzDeg, issIlluminated, sunAltitudeDeg } from "../lib/pass-finder/visibility.js";
import { sunPositionEcef } from "../lib/pass-finder/sun.js";
import { findVisibilityWindows } from "../lib/pass-finder/search.js";
import { tleOrbitTrackEcef } from "../lib/truth.js";
import { fetchCloudForecast, cloudAt } from "../lib/pass-finder/weather.js";
import { fetchTimezone } from "../lib/pass-finder/timezone.js";
import { moonPositionEcef, moonPhaseAngle, moonIlluminatedFraction } from "../lib/pass-finder/moon.js";
import { planetPositionEcef, planetApparentMagnitude, PLANET_STYLE, PLANET_NAMES } from "../lib/pass-finder/planets.js";
import { apparentAltDeg } from "../lib/refraction.js";
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
  // Mode controls both the pass filter and the rating math.
  //   "visual": ISS sunlit + observer in twilight + ISS above 10° (any
  //             observer fails → window closes). Score uses
  //             twilight/altitude/clouds (captureProbJoint).
  //   "radio":  ISS apparent alt ≥ minElevDeg for ALL observers, no
  //             sun/illumination requirement. Score uses peak elevation
  //             and pass duration (radioPassSuccessProbability).
  mode: "visual",
  minElevDeg: 10,
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
// widths vary with text, but a single conservative estimate is fine -
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
// alternates - keeps every label close to its anchor (no long stack
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

// Mode-aware "can this observer see / hear the ISS right now?" used by
// the 3D-scene sightline polyline + observer-label alt/az line.
// Visual: ISS sunlit + observer in twilight + apparent alt ≥ state.minElevDeg.
// Radio:  apparent alt ≥ state.minElevDeg, no sun/illumination gate.
function observerSeesIss(obs, issEcef, jsDate) {
  if (state.mode === "radio") {
    return isRadioReachable([obs], issEcef, jsDate, { minIssAltDeg: state.minElevDeg });
  }
  return isVisibleAtAll([obs], issEcef, jsDate, { minIssAltDeg: state.minElevDeg });
}

// Per-observer pass cache. Each observer's polar plot lights up
// independently of the joint window - when that observer can see ISS
// right now (per observerSeesIss), we cache the full sweep where
// that holds and draw the arc for it. Invalidated when mode /
// minElev / observer set changes; per-observer entries also fall out
// when the clock leaves the cached range.
// Declared up here (rather than alongside the related helper
// functions further down) because addObserver → renderObsList →
// updateObserverIconArc references this Map during module init, and
// `const` bindings hit the TDZ if accessed before their declaration.
const _obsCurrentPass = new Map(); // obsId -> { startMs, endMs } | null

function invalidateObsPassCache() {
  _obsCurrentPass.clear();
}

// Walk backward/forward from anchorMs in 1-second steps until the
// observer no longer sees the ISS (apparent alt < threshold + mode-
// specific gates). Caps at 15 min outside the anchor since real ISS
// passes top out around 10 min for an overhead pass.
const PASS_EDGE_STEP_MS = 1000;
const PASS_EDGE_MAX_MS = 15 * 60 * 1000;
function passWindowAtMsForObserver(obs, anchorMs) {
  const anchorD = new Date(anchorMs);
  const anchorEcef = issEcefAt(anchorD);
  if (!anchorEcef || !observerSeesIss(obs, anchorEcef, anchorD)) return null;
  let startMs = anchorMs;
  let endMs = anchorMs;
  for (let t = anchorMs - PASS_EDGE_STEP_MS; t >= anchorMs - PASS_EDGE_MAX_MS; t -= PASS_EDGE_STEP_MS) {
    const d = new Date(t);
    const e = issEcefAt(d);
    if (!e || !observerSeesIss(obs, e, d)) break;
    startMs = t;
  }
  for (let t = anchorMs + PASS_EDGE_STEP_MS; t <= anchorMs + PASS_EDGE_MAX_MS; t += PASS_EDGE_STEP_MS) {
    const d = new Date(t);
    const e = issEcefAt(d);
    if (!e || !observerSeesIss(obs, e, d)) break;
    endMs = t;
  }
  return { startMs, endMs };
}

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
    return !!(issEcef && observerSeesIss(obs, issEcef, d));
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

// SVG sky-chart polar plot - center = zenith, edge = horizon. ISS arc
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
  // Cardinal labels - sky-chart convention ("looking up"): N at top,
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
  // Sun + Moon discs - sky context, drawn behind the arc + event
  // markers so the trajectory is foreground. Sun/moon positions are
  // computed per-frame via paintIconSunMoon (they slew slowly but
  // visibly across the chart as the sim clock advances).
  const bodies = document.createElementNS(SVG_NS, "g");
  bodies.classList.add("bodies");
  svg.appendChild(bodies);
  // ISS arc - <g> container that renderArcSegments fills with solid
  // <line> children (per-segment magnitude opacity) plus optional
  // dashed <polyline> runs (eclipsed / sub-naked-eye stretches).
  // Stroke color comes from chartPalette(sunAltDeg) so the trace
  // contrast matches the sky-shade horizon fill, identical styling
  // to the fullscreen modal.
  const arc = document.createElementNS(SVG_NS, "g");
  arc.classList.add("arc");
  svg.appendChild(arc);
  // Start / peak / end markers along the arc - colored diamonds drawn
  // ON TOP of the arc trace so the user can pick out the pass shape
  // at a glance. Painted by paintIconEvents when the active window
  // changes; static for the duration of a pass.
  const events = document.createElementNS(SVG_NS, "g");
  events.classList.add("events");
  svg.appendChild(events);
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.classList.add("iss-dot");
  dot.setAttribute("r", 2.5);
  svg.appendChild(dot);
  return svg;
}

// Cache per-pass arc samples on the arc element itself. Sample
// positions + dashed/alpha flags depend only on the pass window and
// observer (computed at sample TIMES inside the pass), not on the
// current clock - so they're constant for the duration of a pass.
// Only the stroke COLOR changes per frame (with sun altitude), so the
// per-frame repaint is just DOM rebuild + new color, no SGP4.
const _arcSampleCache = new WeakMap();
function getCachedArcSamples(arc, obs, win, cx, cy, R, samples) {
  const cached = _arcSampleCache.get(arc);
  if (cached && cached.winStart === win.startMs && cached.obsId === obs.id) {
    return cached.samples;
  }
  const s = computeArcSamples(obs, win, cx, cy, R, samples);
  _arcSampleCache.set(arc, { winStart: win.startMs, obsId: obs.id, samples: s });
  return s;
}

// Repaint the per-observer arc inside an obs-card .polar-plot SVG
// using the same modal-style segmenter (magnitude-aware opacity,
// dashed when not naked-eye visible) and the same luminance-aware
// stroke color derived from the observer's current sun altitude.
function updatePolarPlotArc(svg, obs, sunAltDeg) {
  const arc = svg.querySelector(".arc");
  if (!arc) return;
  // Per-observer pass window - the observer's full sweep when they're
  // currently sighting ISS, not the joint multi-observer window. Lets
  // each station's mini chart show its actual horizon-to-horizon arc.
  const w = _obsCurrentPass.get(obs.id);
  if (!w) { arc.replaceChildren(); _arcSampleCache.delete(arc); return; }
  if (sunAltDeg == null) {
    const d = Cesium.JulianDate.toDate(viewer.clock.currentTime);
    sunAltDeg = apparentAltDeg(sunAltitudeDeg(obs, d));
  }
  const stroke = chartPalette(sunAltDeg).arc;
  const samples = getCachedArcSamples(arc, obs, w, 50, 50, 45, 30);
  // Dash + gap sized to the 4.5 stroke-width so the gap actually reads
  // as empty space. With butt caps (set in renderArcSegments), a gap
  // of N renders as N user units of nothing - so we want gap > stroke
  // to make the dashed treatment visually distinct from the solid.
  renderArcSegments(arc, samples, stroke, "4 6");
}

// Paint the horizon disc to match the sky color at the observer's
// current sun altitude - bright blue in daylight, deep navy after
// astronomical twilight. Mirrors the inline `horizon.style.fill = ...`
// trick used by the fullscreen modal (paintPolarModalStatic).
function updatePolarPlotHorizon(svg, sunAltDeg) {
  if (sunAltDeg == null) return;
  const horizon = svg.querySelector(".horizon");
  if (!horizon) return;
  horizon.style.fill = skyShadeForSunAlt(sunAltDeg);
}

// Small-icon start/peak/end markers. Simpler than the modal painter:
// just three axis-aligned colored diamonds, no overlap-split, no
// info-row labels. Drawn only inside the obs-card .polar-plot icon;
// the 3D-scene observer-label icon stays bare for cleanliness.
const ICON_EVENT_COLORS = ["#34d399", "#facc15", "#f87171"]; // start/peak/end
function paintIconEvents(group, obs, win, cx, cy, R, markerR = 2.8) {
  group.replaceChildren();
  if (!win) return;
  const peakMs = bestMomentMs(win);
  const events = [
    { ms: win.startMs, color: ICON_EVENT_COLORS[0] },
    { ms: peakMs,      color: ICON_EVENT_COLORS[1] },
    { ms: win.endMs,   color: ICON_EVENT_COLORS[2] },
  ];
  for (const ev of events) {
    const e = issEcefAt(new Date(ev.ms));
    if (!e) continue;
    const { alt, az } = issAltAzDeg(obs, e);
    if (alt < -0.5) continue;
    const a = Math.max(0, alt);
    const [x, y] = altAzToSvg(a, az, cx, cy, R);
    const d = `M ${x.toFixed(2)},${(y - markerR).toFixed(2)} ` +
              `L ${(x + markerR).toFixed(2)},${y.toFixed(2)} ` +
              `L ${x.toFixed(2)},${(y + markerR).toFixed(2)} ` +
              `L ${(x - markerR).toFixed(2)},${y.toFixed(2)} Z`;
    const m = document.createElementNS(SVG_NS, "path");
    m.setAttribute("d", d);
    m.setAttribute("fill", ev.color);
    m.setAttribute("stroke", "rgba(0,0,0,0.55)");
    m.setAttribute("stroke-width", "0.7");
    group.appendChild(m);
  }
}

// Small-icon sun + moon. No M/S glyphs (illegible at small scale), no
// planets. Moon gets the phase-shaded illuminated portion oriented
// toward the chart's sun position (works even when the sun itself is
// below the horizon and not drawn).
function paintIconSunMoon(group, obs, jsDate, cx, cy, R, bodyR = 2.4) {
  group.replaceChildren();
  const sunDir = sunPositionEcef(jsDate);
  const sunAA = starAltAzForObs(obs, sunDir);
  const moonDir = moonPositionEcef(jsDate);
  const moonAA = starAltAzForObs(obs, moonDir);
  const [sx, sy] = altAzToSvg(sunAA.alt, sunAA.az, cx, cy, R);
  if (moonAA.alt >= 0) {
    const [mx, my] = altAzToSvg(moonAA.alt, moonAA.az, cx, cy, R);
    const dark = document.createElementNS(SVG_NS, "circle");
    dark.setAttribute("cx", mx.toFixed(2));
    dark.setAttribute("cy", my.toFixed(2));
    dark.setAttribute("r", bodyR);
    dark.setAttribute("fill", "#1a1f2e");
    dark.setAttribute("stroke", "rgba(220,225,240,0.45)");
    dark.setAttribute("stroke-width", "0.4");
    group.appendChild(dark);
    const litFrac = moonIlluminatedFraction(jsDate);
    if (litFrac > 0.01) {
      const litPath = moonLitPath(mx, my, bodyR, moonPhaseAngle(jsDate));
      const sunAngle = Math.atan2(sy - my, sx - mx) * 180 / Math.PI;
      const lit = document.createElementNS(SVG_NS, "path");
      lit.setAttribute("d", litPath);
      lit.setAttribute("fill", "#e8eefc");
      lit.setAttribute("transform",
        `rotate(${sunAngle.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)})`);
      group.appendChild(lit);
    }
  }
  if (sunAA.alt >= 0) {
    const sun = document.createElementNS(SVG_NS, "circle");
    sun.setAttribute("cx", sx.toFixed(2));
    sun.setAttribute("cy", sy.toFixed(2));
    sun.setAttribute("r", (bodyR * 0.85).toFixed(2));
    sun.setAttribute("fill", "#ffe066");
    sun.setAttribute("stroke", "#ffd633");
    sun.setAttribute("stroke-width", "0.4");
    group.appendChild(sun);
  }
}

function updatePolarPlotEvents(svg, obs) {
  const events = svg.querySelector(".events");
  if (!events) return;
  paintIconEvents(events, obs, _obsCurrentPass.get(obs.id), 50, 50, 45);
}

function updatePolarPlotBodies(svg, obs, jsDate) {
  const bodies = svg.querySelector(".bodies");
  if (!bodies) return;
  paintIconSunMoon(bodies, obs, jsDate, 50, 50, 45);
}

function updatePolarPlotDot(svg, obs) {
  const dot = svg.querySelector(".iss-dot");
  if (!dot) return; // small obs-card icon no longer renders a dot
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
    if (!obs) continue;
    updatePolarPlotArc(svg, obs);
    updatePolarPlotEvents(svg, obs);
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
  wrapper.title = `Open polar plot - ${obs.name}`;
  wrapper.style.setProperty("--obs-color", obs.color);
  // Click handling is done via event delegation on iconLayerEl (see
  // setup below renderObserverIcons) - any click that bubbles up
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
  // Arc <g> filled by renderArcSegments with magnitude-opacity-aware
  // <line> children and dashed <polyline> runs for eclipsed/sub-naked-
  // eye stretches - identical rendering to the fullscreen modal so
  // small-icon trajectories read as a faithful preview. Stroke color
  // comes from chartPalette(sunAltDeg), shared with the horizon shade.
  const arc = document.createElementNS(SVG_NS, "g");
  arc.classList.add("arc");
  svg.appendChild(arc);
  wrapper.appendChild(svg);
  // ---- Text block on the right (lines populated per-frame) ----
  const textEl = document.createElement("div");
  textEl.className = "observer-label-text";
  wrapper.appendChild(textEl);
  return wrapper;
}

function updateObserverIconArc(wrapper, obs, sunAltDeg) {
  const arc = wrapper.querySelector(".observer-label-icon .arc");
  if (!arc) return;
  const w = _obsCurrentPass.get(obs.id);
  if (!w) { arc.replaceChildren(); _arcSampleCache.delete(arc); return; }
  if (sunAltDeg == null) {
    const d = Cesium.JulianDate.toDate(viewer.clock.currentTime);
    sunAltDeg = apparentAltDeg(sunAltitudeDeg(obs, d));
  }
  const stroke = chartPalette(sunAltDeg).arc;
  const samples = getCachedArcSamples(arc, obs, w, ICON_GEOM.cx, ICON_GEOM.cy, ICON_GEOM.R, 30);
  // Dash + gap sized to the 8 stroke-width - gap > stroke ensures the
  // butt-capped dashed polyline reads as actual dashes rather than a
  // continuous line. Bigger overall than the obs-card icon because
  // this one renders at 30px (0.3 scale from the 100-unit viewBox).
  renderArcSegments(arc, samples, stroke, "6 11");
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
  if (issEcef && observerSeesIss(obs, issEcef, d)) {
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

const rgbStr = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;

// Twilight-aware chart shade. Linear interpolation between standard
// twilight breakpoints - daylight blue at sun overhead, deep navy
// after astronomical twilight (sun < -18°). Returns an [r, g, b]
// triple in 0-255; callers can convert to a CSS string or derive
// a luminance-aware palette from it.
function skyShadeRgb(altDeg) {
  const stops = [
    [ 10, [ 95, 168, 214]],
    [  0, [ 60, 100, 150]],
    [ -6, [ 35,  55, 100]],
    [-12, [ 18,  28,  60]],
    [-18, [  8,  12,  24]],
    [-90, [  4,   8,  20]],
  ];
  if (altDeg >= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [aH, cH] = stops[i], [aL, cL] = stops[i + 1];
    if (altDeg <= aH && altDeg >= aL) {
      const t = (aH - altDeg) / (aH - aL);
      return cH.map((v, k) => Math.round(v + t * (cL[k] - v)));
    }
  }
  return stops[stops.length - 1][1];
}
const skyShadeForSunAlt = (altDeg) => rgbStr(skyShadeRgb(altDeg));

// Luminance-aware palette: derive grid + spoke + arc grays from the
// horizon disc's perceived luminance. Light grays on dark sky, dark
// grays on bright sky, asymmetric magnitudes tuned for legibility
// (eyes accept lighter-on-dark with smaller delta than darker-on-light).
// Arc gets stronger contrast than grid so the pass trajectory reads
// as the primary visual against the chart's structural lines.
function chartPalette(sunAltDeg) {
  const bg = skyShadeRgb(sunAltDeg);
  const bgLuma = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const dark = bgLuma >= 128;
  // Asymmetric deltas: bigger swings against bright bg because gray
  // doesn't visually "punch" out of pale blue without a big drop.
  // Grid + spoke share the same delta and stroke width so the
  // altitude rings and radial spokes read as one consistent
  // structural lattice rather than two competing layers.
  // Grid, spoke (major + minor + cardinal) all share the same gray -
  // size differences (stroke-width, font-size) carry the visual
  // hierarchy instead of color contrast.
  const gridDelta = dark ? -45 : 30;
  const arcDelta  = dark ? -150 : 130;
  const gridGray = clamp(bgLuma + gridDelta);
  const arcGray  = clamp(bgLuma + arcDelta);
  const lineColor = `rgb(${gridGray}, ${gridGray}, ${gridGray})`;
  return {
    grid:       lineColor,
    spoke:      lineColor,
    minorSpoke: lineColor,
    arc:        `rgb(${arcGray}, ${arcGray}, ${arcGray})`,
  };
}

// Approximate limiting visual magnitude at zenith given sun altitude
// - objects fainter than this aren't visible to the naked eye through
// the prevailing twilight glow. Looser than rigorous photometric
// thresholds (real dark-sky limit is ~6.5) so the chart doesn't go
// completely empty in deep night; tighter than reality near horizon
// so we don't pretend stars are visible during daylight.
function naturalSkyLimMag(altDeg) {
  const stops = [
    [ 10, -4.0],
    [  0, -2.5],
    [ -6,  1.5],
    [-12,  3.5],
    [-18,  5.0],
    [-90,  6.0],
  ];
  if (altDeg >= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [aH, mH] = stops[i], [aL, mL] = stops[i + 1];
    if (altDeg <= aH && altDeg >= aL) {
      const t = (aH - altDeg) / (aH - aL);
      return mH + t * (mL - mH);
    }
  }
  return stops[stops.length - 1][1];
}

let _polarModalObsId = null;
let _polarModalImgUrl = null; // current blob URL bound to <img>
const polarModalEl = document.getElementById("polar-modal");
const polarModalSvg = polarModalEl.querySelector(".polar-modal-svg");
const polarModalImg = polarModalEl.querySelector(".polar-modal-png");
const polarModalImgLink = polarModalEl.querySelector(".polar-modal-png-link");
// Anchor wraps the <img> so right-click "Save Image As" picks up the
// download filename instead of the blob UUID. The anchor's href is
// the SAME blob URL as the img, set in renderPolarModal; the click
// handler suppresses navigation so left-clicks don't initiate a
// download alongside the modal's normal interactions.
polarModalImgLink.addEventListener("click", (ev) => ev.preventDefault());

// Compute alt/az of a (unit) star direction vector for the given
// observer. Star is "at infinity" so we don't subtract observer ECEF -
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
  /* Grid + spokes get their stroke set inline per chart, picked from
     a luminance-aware palette derived from the horizon disc shade -
     light grays on dark sky, dark grays on bright sky, asymmetric
     deltas tuned for legibility at each end. */
  .grid           { fill: none; stroke-width: 0.3; }
  .spoke          { stroke-width: 0.3; }
  .spoke-minor    { stroke-width: 0.15; }
  .spoke-cardinal { stroke-width: 0.45; }
  .cardinal { fill: #6a7a9a; font-size: 11px; letter-spacing: 0.08em; font-weight: 700; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .az-num       { fill: #6a7a9a; font-size: 4.6px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .az-num-minor { fill: #6a7a9a; font-size: 3.4px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  /* Altitude ring labels - small tick text tucked just inside the
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
     stroke-linecap: butt is critical here - round caps on each segment
     overlap their neighbors and double the alpha at every junction,
     producing a visible bead pattern when stroke-opacity varies. */
  .arc      { fill: none; stroke-width: 1.6; stroke-linecap: butt; }
  /* Constellation outlines - deepest backdrop layer. Stroke + opacity
     are set inline per-line (palette-derived gray + sky-brightness
     scaled opacity) so they match the prevailing chart shade. */
  .const-line { stroke-width: 0.22; stroke-linecap: round; }
  /* Legend text below the chart - small, low-contrast so it reads as
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
    /* halo matched to .planet-glyph (0.45) - was 0.8 which read as
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
     over it - gives an outline effect without thickening the strokes
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
`;

function paintPolarModalStatic(svg, obs, anchorMs, sunAltDeg) {
  svg.replaceChildren();
  const { cx, cy, R } = MODAL_GEOM;
  // Embedded styles - duplicated from pass-finder.css so the exported
  // standalone SVG/PNG still looks right.
  const styleEl = document.createElementNS(SVG_NS, "style");
  styleEl.textContent = MODAL_SVG_STYLE;
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
  // Anchor: caller passes the pass peak time so the date and tz-offset
  // tag both reflect when the pass actually occurs. Fall back to the
  // playback clock if no pass is active (modal opened without a
  // selected window - shouldn't happen but stays defensive).
  const anchor = new Date(
    anchorMs ?? Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime(),
  );
  // Date is formatted in the OBSERVER's timezone too, so passes that
  // happen at local midnight don't display the user's tomorrow.
  const dateOpts = { year: "numeric", month: "short", day: "numeric" };
  if (obs.tz) dateOpts.timeZone = obs.tz;
  const dateStr = anchor.toLocaleDateString(undefined, dateOpts);
  const latHemi = obs.latDeg >= 0 ? "N" : "S";
  const lonHemi = obs.lonDeg >= 0 ? "E" : "W";
  const coordStr = `${Math.abs(obs.latDeg).toFixed(4)}°${latHemi}, `
                 + `${Math.abs(obs.lonDeg).toFixed(4)}°${lonHemi}`;
  // Resolve a "UTC±H" tag for the tz at the pass START instant, so the
  // displayed offset reflects whatever DST rules were actually in
  // effect for the pass (and not, e.g., "winter offset" applied to a
  // summer pass).
  const refMs = state.windows?.[state.activeWindowIdx]?.startMs ?? anchor.getTime();
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
  // Disc shade is twilight-aware: bright blue in daylight, deep navy
  // once the sun is well below astronomical twilight. Inline fill
  // overrides the static .horizon CSS so PNG exports carry the right
  // shade for this pass.
  const horizon = document.createElementNS(SVG_NS, "circle");
  horizon.setAttribute("cx", cx); horizon.setAttribute("cy", cy);
  horizon.setAttribute("r", R);
  horizon.classList.add("horizon");
  if (sunAltDeg != null) {
    // Inline style - `fill` as a presentation attribute loses to the
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
  // - a classic compass crosshair - rather than crowding it.
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
    // spokes - just thicker, not brighter. That's enough to read as
    // the chart's primary orientation cue without competing with the
    // pass arc for contrast attention.
    l.style.stroke = palette.spoke;
    svg.appendChild(l);
  }
  // Minor spokes every 15° (offset from majors), only along the outer
  // chart - from horizon up to 60° altitude. Near the horizon the
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
    // cardinal - azimuth-based placement looked progressively farther
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
    // (±150) - splits the difference so the labels are clearly
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
  // Cardinal labels - sky-chart convention (E LEFT, W RIGHT) with
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
  // Azimuth labels - radius is computed per-label so the INNER edge
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
  // Minor labels (15° offset from majors) - smaller font, gap nearly
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
  // can populate it with per-segment <line> elements - that's what
  // lets the visual-mode arc fade with apparent magnitude along the
  // pass.
  const arc = document.createElementNS(SVG_NS, "g");
  arc.classList.add("arc");
  svg.appendChild(arc);
  const eventsG = document.createElementNS(SVG_NS, "g");
  eventsG.dataset.layer = "events";
  svg.appendChild(eventsG);
}

// Polar-modal arc paints in a neutral gray rather than the observer's
// color - in this view the arc represents the ISS path, not the
// observer, so the observer color was easy to misread as "the
// observer's arc is colored". The Start/Peak/End markers (green/gold/
// red) and the obs-card icon (still observer-color) remain the
// color-coded affordances.
const POLAR_ARC_COLOR = "#aab8d4";
// Arc-segment opacity. Whenever a segment is plausibly visible to the
// naked eye at that instant - sun deep enough below the horizon, ISS
// out of Earth's shadow, ISS brighter than the sky-glow limit - its
// alpha tracks the ISS's apparent magnitude (bright segments solid,
// dim ones translucent). Segments that wouldn't be naked-eye visible
// fall back to the uniform radio opacity. Applies in BOTH modes; in
// visual mode the search predicate already guarantees the visibility
// gate holds for every sample, so the magnitude curve covers the
// whole arc - but a daytime radio pass arc still gets a brightness
// gradient where the sun briefly dips below twilight, etc.
const ARC_OPACITY_UNIFORM = 0.65;
function issAlphaForMag(m) {
  if (m == null) return ARC_OPACITY_UNIFORM;
  // m = -3 → t=1 (fully opaque end of range); m = +2 → t=0 (dimmest).
  const t = Math.max(0, Math.min(1, (-m + 2) / 5));
  return 0.18 + t * 0.7;
}
// Per-sample arc style. Returns { alpha, dashed } so the segment
// renderer can mark "would be visible if not for the ISS being
// eclipsed / too dim" stretches with a dotted-low-opacity treatment -
// that's diagnostically useful on a dark-sky radio pass where the
// ISS dips into Earth's shadow mid-arc and the operator wants to
// know "where would I be looking if it were lit?"
const ARC_DASH_ALPHA = 0.3;
function arcSampleStyle(obs, issEcef, jsDate) {
  const sunDir = sunPositionEcef(jsDate);
  const sunAlt = sunAltitudeDeg(obs, jsDate);
  // Unified rule: dashed whenever the ISS isn't naked-eye visible at
  // this instant for this observer (daylight sky, civil-twilight sky,
  // ISS in Earth's shadow, or ISS dimmer than the sky-glow limit).
  // Solid + magnitude-gradient only when it's actually observable.
  const darkSky = sunAlt <= -6;
  if (!darkSky) return { alpha: ARC_DASH_ALPHA, dashed: true };
  if (!issIlluminated(issEcef, sunDir)) {
    return { alpha: ARC_DASH_ALPHA, dashed: true };
  }
  const m = magnitudeAt(obs, issEcef, sunDir);
  if (m == null || m > naturalSkyLimMag(sunAlt)) {
    return { alpha: ARC_DASH_ALPHA, dashed: true };
  }
  return { alpha: issAlphaForMag(m), dashed: false };
}

// Sample an arc trajectory at SAMPLES+1 evenly-spaced instants across
// a pass window, returning {x, y, alpha, dashed} per sample in the
// caller's SVG coordinate space. Skips below-horizon samples so a
// window that strays under the horizon at its edges doesn't yield
// nonsense segments. Shared by the modal and the small icon plots.
function computeArcSamples(obs, win, cx, cy, R, SAMPLES) {
  const dt = (win.endMs - win.startMs) / SAMPLES;
  const samples = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const d = new Date(win.startMs + dt * i);
    const issEcef = issEcefAt(d);
    if (!issEcef) continue;
    const { alt, az } = issAltAzDeg(obs, issEcef);
    if (alt < 0) continue;
    const [x, y] = altAzToSvg(alt, az, cx, cy, R);
    samples.push({ x, y, ...arcSampleStyle(obs, issEcef, d) });
  }
  return samples;
}

// Render the segmented arc inside a <g> container. Solid segments are
// individual <line> elements so each can carry its own magnitude-
// derived stroke-opacity; consecutive dashed segments collapse into a
// single <polyline> so SVG's stroke-dasharray follows the actual
// path arclength and dash spacing stays even regardless of how
// sample times stretch or compress along the chart. dashArray is in
// the caller's viewBox units, so small icons want larger numbers than
// the modal for visually-similar dash density.
function renderArcSegments(arcGroup, samples, stroke, dashArray) {
  arcGroup.replaceChildren();
  if (samples.length < 2) return;
  let dashedRun = null;
  const flushDashedRun = () => {
    if (!dashedRun) return;
    const pl = document.createElementNS(SVG_NS, "polyline");
    pl.setAttribute("points", dashedRun.points.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" "));
    pl.setAttribute("fill", "none");
    pl.setAttribute("stroke", stroke);
    pl.setAttribute("stroke-opacity", ARC_DASH_ALPHA.toFixed(3));
    pl.setAttribute("stroke-dasharray", dashArray);
    // Butt caps on dashed runs so each gap is honored exactly - with
    // round caps (the default from the .arc CSS) every dash extends
    // by half the stroke width on each side, which eats the gap on
    // thick small-icon strokes and makes the dashed run look solid.
    pl.setAttribute("stroke-linecap", "butt");
    arcGroup.appendChild(pl);
    dashedRun = null;
  };
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    const dashed = a.dashed || b.dashed;
    if (dashed) {
      if (!dashedRun) dashedRun = { points: [[a.x, a.y]] };
      dashedRun.points.push([b.x, b.y]);
      continue;
    }
    flushDashedRun();
    const ln = document.createElementNS(SVG_NS, "line");
    ln.setAttribute("x1", a.x.toFixed(2));
    ln.setAttribute("y1", a.y.toFixed(2));
    ln.setAttribute("x2", b.x.toFixed(2));
    ln.setAttribute("y2", b.y.toFixed(2));
    ln.setAttribute("stroke", stroke);
    ln.setAttribute("stroke-opacity", ((a.alpha + b.alpha) / 2).toFixed(3));
    arcGroup.appendChild(ln);
  }
  flushDashedRun();
}

function paintPolarModalArc(svg, obs, win) {
  const arc = svg.querySelector(".arc");
  if (!arc) return;
  const w = win ?? state.windows?.[state.activeWindowIdx];
  if (!w) { arc.replaceChildren(); return; }
  // paintPolarModalStatic stashes the per-chart arc color (derived
  // from the sky luminance palette) on the SVG root so the trajectory
  // contrast adapts with the disc shade.
  const stroke = svg.dataset.arcStroke || POLAR_ARC_COLOR;
  const samples = computeArcSamples(obs, w, MODAL_GEOM.cx, MODAL_GEOM.cy, MODAL_GEOM.R, 60);
  renderArcSegments(arc, samples, stroke, "1.4 1.8");
}

// Minimum distance (in SVG units) two label centers must be from each
// other before we'll place both. The chart spans ~180 SVG units across
// (R=90 radius), so 14 units ≈ 7° of sky - keeps the Big Dipper and
// Orion's belt from stacking name on name. We sort labels brightest
// first so brighter stars always win the right to a label.
const STAR_LABEL_MIN_DIST = 14;

// SVG path for the moon's illuminated portion, in moon-local coords:
// +x points toward the sun (lit side). The terminator is an ellipse
// with semi-axes (r·|cos i|, r); we trace the outer right-half disc
// edge plus the half of the ellipse on the un-/over-lit side to close
// the boundary. After drawing, the caller rotates the whole shape so
// +x in this frame aligns with the actual sun direction in the chart.
function moonLitPath(cx, cy, r, phaseAngleRad) {
  const cosI = Math.cos(phaseAngleRad);
  const termRx = r * Math.abs(cosI);
  // SVG sweep-flag=1 means "increasing-angle direction" - for our
  // bottom→top return arc that goes through θ=π (the LEFT side of the
  // ellipse). sweep-flag=0 goes through θ=0 (the RIGHT side).
  //
  // Gibbous (cosI > 0, lit > 50%): the terminator sits on the unlit
  //   -x side, and the lit region extends past center into the left
  //   half → the closing arc has to bulge LEFT → sweep=1.
  // Crescent (cosI < 0, lit < 50%): the terminator sits on the +x
  //   side of the disc just inside the lit edge → the closing arc
  //   bulges RIGHT, taking a bite out of the right semicircle to
  //   produce a thin crescent → sweep=0.
  const termSweep = cosI >= 0 ? 1 : 0;
  return `M ${cx},${cy - r} `
       + `A ${r},${r} 0 0,1 ${cx},${cy + r} `
       + `A ${termRx.toFixed(3)},${r} 0 0,${termSweep} ${cx},${cy - r} Z`;
}

// Plot the sun (if above horizon) and the moon (if above horizon, with
// correct phase + orientation pointing toward the sun's chart position)
// on the polar modal. Painted once when the modal opens. Both bodies
// only show when ≥ 0° apparent altitude - below-horizon bodies are
// silently omitted.
function paintPolarModalSunMoon(svg, obs, jsDate, limMag) {
  const layer = svg.querySelector('[data-layer="bodies"]');
  if (!layer) return;
  layer.replaceChildren();
  const { cx, cy, R } = MODAL_GEOM;
  const sunDir = sunPositionEcef(jsDate);
  const sunAA = starAltAzForObs(obs, sunDir);
  const moonDir = moonPositionEcef(jsDate);
  const moonAA = starAltAzForObs(obs, moonDir);
  // Sun chart position is needed for orienting the moon even when the
  // sun itself is below horizon (the lit side still faces where the
  // sun would be).
  const [sx, sy] = altAzToSvg(sunAA.alt, sunAA.az, cx, cy, R);

  // Moon FIRST so the Sun always paints on top of it (matters when
  // they're geometrically close - e.g. on a new-moon day). Sun and
  // moon stay smaller than the event markers (diamonds), since they
  // are sky CONTEXT for the chart while the markers are the chart's
  // featured content.
  if (moonAA.alt >= 0) {
    const [mx, my] = altAzToSvg(moonAA.alt, moonAA.az, cx, cy, R);
    const moonR = 1.8;
    // Dark disc behind the lit shape so the unlit side reads as a
    // circle (rather than empty negative space at new/crescent).
    const dark = document.createElementNS(SVG_NS, "circle");
    dark.setAttribute("cx", mx.toFixed(2));
    dark.setAttribute("cy", my.toFixed(2));
    dark.setAttribute("r", moonR);
    dark.setAttribute("fill", "#1a1f2e");
    dark.setAttribute("stroke", "rgba(220,225,240,0.4)");
    dark.setAttribute("stroke-width", "0.3");
    layer.appendChild(dark);
    // Illuminated portion drawn in moon-local frame (+x toward sun),
    // then rotated so +x points to the sun's chart position.
    const litFrac = moonIlluminatedFraction(jsDate);
    if (litFrac > 0.01) {
      const litPath = moonLitPath(mx, my, moonR, moonPhaseAngle(jsDate));
      const sunAngle = Math.atan2(sy - my, sx - mx) * 180 / Math.PI;
      const lit = document.createElementNS(SVG_NS, "path");
      lit.setAttribute("d", litPath);
      lit.setAttribute("fill", "#e8eefc");
      lit.setAttribute("transform", `rotate(${sunAngle.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)})`);
      layer.appendChild(lit);
    }
    // Difference blend means the white fill inverts whatever's beneath
    // it - the M reads dark on the bright lit hemisphere and bright
    // on the dark unlit hemisphere automatically, including at the
    // terminator where one stroke can span both.
    appendBodyGlyph(layer, mx, my, "M", "#ffffff", "difference");
  }

  if (sunAA.alt >= 0) {
    const sun = document.createElementNS(SVG_NS, "circle");
    sun.setAttribute("cx", sx.toFixed(2));
    sun.setAttribute("cy", sy.toFixed(2));
    sun.setAttribute("r", 1.6);
    sun.setAttribute("fill", "#ffe066");
    sun.setAttribute("stroke", "#ffd633");
    sun.setAttribute("stroke-width", "0.3");
    layer.appendChild(sun);
    // Same difference trick on the S - white fill inverts the yellow
    // disc beneath it to a clearly readable dark blue-ish letter,
    // without competing with the peak marker's gold. Small upward
    // nudge: "central" baseline puts the S a hair low visually,
    // since its glyph weight skews toward the bottom curve.
    appendBodyGlyph(layer, sx, sy - 0.12, "S", "#ffffff", "difference");
  }

  // ---- Planets ---------------------------------------------------
  // Five classical naked-eye planets, drawn as small colored discs
  // (Pogson-scaled by approximate apparent magnitude) with their
  // traditional astrological glyph in difference-blend overlay. Hide
  // any planet whose angular position falls inside the sun's or
  // moon's apparent disc - literal occlusion. Sun and moon both
  // subtend ~0.5°, so the threshold is one apparent radius.
  const SUN_R_RAD = 0.267 * Math.PI / 180;
  const MOON_R_RAD = 0.259 * Math.PI / 180;
  for (const pname of PLANET_NAMES) {
    const dirEcef = planetPositionEcef(pname, jsDate);
    const aa = starAltAzForObs(obs, dirEcef);
    if (aa.alt < 0) continue;
    // Occlusion vs sun.
    const dotSun = sunDir[0] * dirEcef[0] + sunDir[1] * dirEcef[1] + sunDir[2] * dirEcef[2];
    if (Math.acos(Math.max(-1, Math.min(1, dotSun))) < SUN_R_RAD) continue;
    // Occlusion vs moon (moonDir is a unit vector, so dot is cos of separation).
    const dotMoon = moonDir[0] * dirEcef[0] + moonDir[1] * dirEcef[1] + moonDir[2] * dirEcef[2];
    if (Math.acos(Math.max(-1, Math.min(1, dotMoon))) < MOON_R_RAD) continue;
    const style = PLANET_STYLE[pname];
    const mag = planetApparentMagnitude(pname, jsDate);
    // Twilight gate: drop planets whose apparent magnitude is dimmer
    // than the prevailing sky-glow limit. Venus stays visible through
    // most of daytime (mag -4 ≪ daylight limit -3); Saturn drops out
    // around civil twilight.
    if (limMag != null && mag != null && mag > limMag) continue;
    // Narrow clamp: Pogson scaling would make Venus a small planet
    // (mag -4 → r≈6) and Saturn near-invisible (mag +1 → r≈0.6).
    // We want all five readable as discs without the brightest two
    // dominating the chart.
    const pogson = 0.95 * Math.pow(10, -(mag ?? 1.0) / 5);
    const r = Math.max(1.1, Math.min(1.5, pogson));
    const [px, py] = altAzToSvg(aa.alt, aa.az, cx, cy, R);
    // Glyph-only rendering - planet color on the glyph itself with a
    // thin dark stroke (paint-order: stroke) keeps it legible against
    // any sky shade. The disc-and-overlay approach made the inner
    // glyph too small to read; here the whole footprint IS the glyph.
    appendPlanetGlyph(layer, px, py, style.glyph, r, style.color);
  }
}

// Planet glyph - traditional astrological symbol painted in the
// planet's own color with a thin dark halo (paint-order: stroke) for
// legibility against any sky shade. No disc backing - the glyph itself
// is the planet marker. Font size scales off the disc radius the
// caller would have used, so brighter planets read bigger.
function appendPlanetGlyph(layer, cx, cy, glyph, discR, color) {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", cx.toFixed(2));
  t.setAttribute("y", cy.toFixed(2));
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("dominant-baseline", "central");
  t.setAttribute("fill", color || "#e8eefc");
  // Bumped 1.55x → 2.8x: the glyph IS the marker now, so it should
  // read at roughly the disc-diameter size that brightness conveyed.
  t.setAttribute("font-size", (discR * 2.8).toFixed(2));
  t.classList.add("planet-glyph");
  t.textContent = glyph;
  layer.appendChild(t);
}

// Single-letter identifier painted at the center of a body disc.
// Caller picks the fill (and optionally a CSS blend mode - the moon's
// "M" uses mix-blend-mode: difference so it inverts whatever the
// lit/unlit fill is below it).
function appendBodyGlyph(layer, cx, cy, letter, fill, blend) {
  const g = document.createElementNS(SVG_NS, "text");
  g.setAttribute("x", cx.toFixed(2));
  g.setAttribute("y", cy.toFixed(2));
  g.setAttribute("text-anchor", "middle");
  g.setAttribute("dominant-baseline", "central");
  g.setAttribute("fill", fill);
  if (blend) g.style.mixBlendMode = blend;
  g.classList.add("body-glyph");
  g.textContent = letter;
  layer.appendChild(g);
}

// Legend painted in the lower-left corner of the chart's viewBox.
// Bottom-anchored so the stack always sits flush to the corner; only
// shows bodies that are actually drawn on the chart (above horizon +
// passing the limMag gate). The Moon icon mirrors the chart moon's
// phase and sun-relative orientation, so the legend reads as a direct
// reference key for what the user is looking at right now.
function paintPolarModalLegend(svg, obs, jsDate, limMag) {
  svg.querySelector('[data-layer="legend"]')?.remove();
  const layer = document.createElementNS(SVG_NS, "g");
  layer.dataset.layer = "legend";
  // Pull the chart's actual arc stroke (luminance-derived) and pair
  // it with a small "sky box" rect behind each pass-line swatch
  // painted in the matching sky shade. That way each swatch is a
  // literal mini-render of the chart's pass arc - colors and contrast
  // exactly match what the user sees on the disc.
  const arcStroke = svg.dataset.arcStroke || "#aab8d4";
  const swatchBg = svg.dataset.skyShade || null;

  // Layout constants. xLeft = symbol/swatch left edge; xLbl is a
  // SINGLE label column shared by every row (visibility lines, sun,
  // moon, planets) so the right-side text stack reads flush.
  // Body icons are CENTERED inside the same horizontal band as the
  // visibility swatches (xLeft .. xLeft+swatchLen) so the symbol
  // column reads consistently too.
  const xLeft = -19.6;     // box left ~3px from viewBox left, matches bottom inset
  // Swatch width = exactly 4 chart-style dashes (4×1.4 + 3×1.8 = 11),
  // so the dashed swatch ends on a dash, not a gap.
  const swatchLen = 11;
  const xSymC = xLeft + swatchLen / 2;
  const xLbl = xLeft + swatchLen + 3;
  const rowH = 6;          // bumped from 4.5 for breathing room
  const bottomY = 203;     // last row sits 7px from viewBox bottom
  const headingGap = 1.5;  // extra breathing room below the heading row (small)

  const addLabel = (yRow, text) => {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", xLbl); t.setAttribute("y", yRow);
    t.setAttribute("dominant-baseline", "central");
    t.classList.add("legend-text");
    t.textContent = text;
    layer.appendChild(t);
  };

  // Pre-compute body altitudes to decide what shows up.
  const sunDir = sunPositionEcef(jsDate);
  const sunAA = starAltAzForObs(obs, sunDir);
  const moonDir = moonPositionEcef(jsDate);
  const moonAA = starAltAzForObs(obs, moonDir);

  // ?demoLegend=1 → bypass all visibility filters so every legend row
  // renders. Useful for previewing the maximum legend size.
  const demoAll = new URLSearchParams(location.search).has("demoLegend");

  // Build the row list first (a kind + payload) so we can compute
  // total height for bottom-alignment, then render in a second pass.
  const rows = [];
  rows.push({ kind: "passLine", solid: true,  label: "visible" });
  rows.push({ kind: "passLine", solid: false, label: "not visible" });
  if (demoAll || sunAA.alt >= 0) rows.push({ kind: "sun" });
  if (demoAll || moonAA.alt >= 0) rows.push({ kind: "moon" });

  const SUN_R_RAD = 0.267 * Math.PI / 180;
  const MOON_R_RAD = 0.259 * Math.PI / 180;
  for (const pname of PLANET_NAMES) {
    const dirEcef = planetPositionEcef(pname, jsDate);
    const aa = starAltAzForObs(obs, dirEcef);
    const dotSun = sunDir[0]*dirEcef[0] + sunDir[1]*dirEcef[1] + sunDir[2]*dirEcef[2];
    const dotMoon = moonDir[0]*dirEcef[0] + moonDir[1]*dirEcef[1] + moonDir[2]*dirEcef[2];
    const mag = planetApparentMagnitude(pname, jsDate);
    if (!demoAll) {
      if (aa.alt < 0) continue;
      if (Math.acos(Math.max(-1, Math.min(1, dotSun))) < SUN_R_RAD) continue;
      if (Math.acos(Math.max(-1, Math.min(1, dotMoon))) < MOON_R_RAD) continue;
      if (limMag != null && mag != null && mag > limMag) continue;
    }
    rows.push({ kind: "planet", pname });
  }

  // Bottom-anchor: position the LAST row at bottomY, stacking upward.
  let y = bottomY - (rows.length - 1) * rowH;

  // Sky-shade backdrop spanning the entire symbol column. Each swatch
  // becomes a literal mini-render of "what the chart would look like
  // on this kind of sky": arc colors, planet glyphs, sun/moon discs
  // all paint against the actual disc shade. A thin half-transparent
  // blue border (same hue as the chart horizon ring) frames the box
  // without competing visually. No backdrop on dark-sky charts where
  // the shade matches the modal background - invisible anyway.
  if (swatchBg && rows.length > 0) {
    const firstContentY = y;
    const skyBox = document.createElementNS(SVG_NS, "rect");
    const padX = 1.4;
    const padY = 1.0;  // split the diff between original ~0.4 and prior 1.6
    skyBox.setAttribute("x", (xLeft - padX).toFixed(2));
    skyBox.setAttribute("y", (firstContentY - rowH / 2 - padY).toFixed(2));
    skyBox.setAttribute("width", (swatchLen + 2 * padX).toFixed(2));
    skyBox.setAttribute("height", ((rows.length - 1) * rowH + rowH + 2 * padY).toFixed(2));
    skyBox.setAttribute("rx", "1.2");
    skyBox.setAttribute("fill", swatchBg);
    skyBox.setAttribute("stroke", "rgba(126, 184, 255, 0.35)");
    skyBox.setAttribute("stroke-width", "0.3");
    layer.appendChild(skyBox);
  }

  for (const row of rows) {
    if (row.kind === "passLine") {
      if (row.solid) {
        // Smooth ramp via many short segments. stroke-width 1.6 +
        // linecap butt match the chart .arc class exactly, so the
        // legend reads as a literal sample of the chart's pass arc.
        const N = 22;
        const segW = swatchLen / N;
        // Quick ramp to ~full opacity in the first ~55%, then hold
        // near 0.85 - mirrors the issAlphaForMag curve a bright pass
        // produces on the actual chart.
        const opacityAt = (t) => 0.18 + (0.85 - 0.18) * Math.min(1, t * 1.8);
        for (let i = 0; i < N; i++) {
          const seg = document.createElementNS(SVG_NS, "line");
          seg.setAttribute("x1", (xLeft + i * segW).toFixed(3));
          seg.setAttribute("y1", y);
          seg.setAttribute("x2", (xLeft + (i + 1) * segW).toFixed(3));
          seg.setAttribute("y2", y);
          seg.setAttribute("stroke", arcStroke);
          seg.setAttribute("stroke-width", "1.6");
          seg.setAttribute("stroke-opacity", opacityAt(i / (N - 1)).toFixed(3));
          seg.setAttribute("stroke-linecap", "butt");
          layer.appendChild(seg);
        }
      } else {
        // Match the chart's "not visible" arc segments exactly:
        // stroke-width 1.6, dasharray "1.4 1.8", ARC_DASH_ALPHA opacity.
        // swatchLen = 11 = 4*1.4 + 3*1.8, so the line ends on a dash.
        const dashed = document.createElementNS(SVG_NS, "line");
        dashed.setAttribute("x1", xLeft); dashed.setAttribute("y1", y);
        dashed.setAttribute("x2", xLeft + swatchLen); dashed.setAttribute("y2", y);
        dashed.setAttribute("stroke", arcStroke);
        dashed.setAttribute("stroke-width", "1.6");
        dashed.setAttribute("stroke-opacity", String(ARC_DASH_ALPHA));
        dashed.setAttribute("stroke-dasharray", "1.4 1.8");
        dashed.setAttribute("stroke-linecap", "butt");
        layer.appendChild(dashed);
      }
      addLabel(y, row.label);
    } else if (row.kind === "sun") {
      const sun = document.createElementNS(SVG_NS, "circle");
      sun.setAttribute("cx", xSymC); sun.setAttribute("cy", y); sun.setAttribute("r", "1.5");
      sun.setAttribute("fill", "#ffe066");
      sun.setAttribute("stroke", "#ffd633"); sun.setAttribute("stroke-width", "0.3");
      layer.appendChild(sun);
      appendBodyGlyph(layer, xSymC, y - 0.12, "S", "#ffffff", "difference");
      addLabel(y, "Sun");
    } else if (row.kind === "moon") {
      // Mirror the chart moon: same phase angle, same sun-relative
      // rotation (so the legend icon points its lit side the same
      // way the user sees on the chart).
      const { cx, cy, R } = MODAL_GEOM;
      const [sx, sy] = altAzToSvg(sunAA.alt, sunAA.az, cx, cy, R);
      const [mx, my] = altAzToSvg(moonAA.alt, moonAA.az, cx, cy, R);
      const sunAngle = Math.atan2(sy - my, sx - mx) * 180 / Math.PI;
      const litFrac = moonIlluminatedFraction(jsDate);
      const phase = moonPhaseAngle(jsDate);
      const r = 1.7;
      const dark = document.createElementNS(SVG_NS, "circle");
      dark.setAttribute("cx", xSymC); dark.setAttribute("cy", y); dark.setAttribute("r", r);
      dark.setAttribute("fill", "#1a1f2e");
      dark.setAttribute("stroke", "rgba(220,225,240,0.4)");
      dark.setAttribute("stroke-width", "0.3");
      layer.appendChild(dark);
      if (litFrac > 0.01) {
        const lit = document.createElementNS(SVG_NS, "path");
        lit.setAttribute("d", moonLitPath(xSymC, y, r, phase));
        lit.setAttribute("fill", "#e8eefc");
        lit.setAttribute("transform", `rotate(${sunAngle.toFixed(2)} ${xSymC} ${y.toFixed(2)})`);
        layer.appendChild(lit);
      }
      appendBodyGlyph(layer, xSymC, y, "M", "#ffffff", "difference");
      // Bucket the current phase into 6 named phases (matching the
      // user-chosen short names). Waxing vs waning is determined by
      // sampling phaseAngle an hour later - phase angle increases
      // from full (0) to new (π), so a later-larger value means we're
      // moving toward new = waning; smaller means waxing.
      const phaseLater = moonPhaseAngle(new Date(jsDate.getTime() + 3600 * 1000));
      const waxing = phaseLater < phase;
      let phaseName;
      if (litFrac < 0.02)         phaseName = "New";
      else if (litFrac > 0.98)    phaseName = "Full";
      else if (Math.abs(litFrac - 0.5) < 0.05) phaseName = waxing ? "1st Qtr" : "3rd Qtr";
      else if (waxing)            phaseName = litFrac < 0.5 ? "Wax Cr" : "Wax Gib";
      else                        phaseName = litFrac < 0.5 ? "Wan Cr" : "Wan Gib";
      addLabel(y, `Moon (${phaseName})`);
    } else if (row.kind === "planet") {
      const style = PLANET_STYLE[row.pname];
      appendPlanetGlyph(layer, xSymC, y, style.glyph, 1.35, style.color);
      addLabel(y, style.name);
    }
    y += rowH;
  }

  svg.appendChild(layer);
}

// Constellation outline segments - each entry is
// [[ra1Hours, dec1Deg], [ra2Hours, dec2Deg]]. Endpoints are J2000
// positions of well-known asterism stars; we don't reference the
// star catalogs by name so this list stays self-contained.
// Coverage: the ~20 most-recognizable asterisms (Big Dipper, Orion,
// Cassiopeia, Cygnus, Lyra, Aquila, Leo, Boötes, Scorpius, etc.).
const CONSTELLATION_LINES = [
  // Ursa Major (Big Dipper) - Dubhe-Merak-Phecda-Megrez-Alioth-Mizar-Alkaid + Dubhe-Megrez
  [[11.0621, 61.7508], [11.0307, 56.3824]],
  [[11.0307, 56.3824], [11.8972, 53.6948]],
  [[11.8972, 53.6948], [12.2571, 57.0326]],
  [[12.2571, 57.0326], [12.9004, 55.9598]],
  [[12.9004, 55.9598], [13.3988, 54.9254]],
  [[13.3988, 54.9254], [13.7923, 49.3133]],
  [[11.0621, 61.7508], [12.2571, 57.0326]],
  // Ursa Minor (Little Dipper) - Polaris-Yildun-εUMi-ζUMi-Kochab-Pherkad-ηUMi-Polaris (simplified)
  [[ 2.5302, 89.2641], [17.5369, 86.5864]],  // Polaris-Yildun
  [[17.5369, 86.5864], [16.7660, 82.0372]],  // Yildun-εUMi
  [[16.7660, 82.0372], [15.7345, 77.7944]],  // εUMi-ζUMi
  [[15.7345, 77.7944], [14.8451, 74.1556]],  // ζUMi-Kochab
  [[14.8451, 74.1556], [15.3457, 71.8340]],  // Kochab-Pherkad
  // Cassiopeia (W) - Caph-Schedar-γCas-Ruchbah-Segin
  [[ 0.1530, 59.1498], [ 0.6751, 56.5374]],
  [[ 0.6751, 56.5374], [ 0.9451, 60.7167]],
  [[ 0.9451, 60.7167], [ 1.4302, 60.2353]],
  [[ 1.4302, 60.2353], [ 1.9061, 63.6701]],
  // Cepheus - Alderamin-Alfirk-Errai (simplified pentagon, partial)
  [[21.3096, 62.5856], [21.4778, 70.5607]],  // Alderamin-Alfirk
  [[21.4778, 70.5607], [23.6553, 77.6322]],  // Alfirk-Errai
  // Cygnus (Northern Cross) - Deneb-Sadr-Albireo + Sadr-δCyg + Sadr-εCyg
  [[20.6906, 45.2803], [20.3705, 40.2567]],
  [[20.3705, 40.2567], [19.5125, 27.9597]],
  [[20.3705, 40.2567], [19.7494, 45.1304]],
  [[20.3705, 40.2567], [20.7702, 33.9701]],
  // Lyra - Vega + parallelogram (Vega-ζLyr-δLyr-Sulafat-Sheliak-Vega)
  [[18.6156, 38.7837], [18.7456, 37.6051]],  // Vega-Sulafat
  [[18.6156, 38.7837], [18.8358, 33.3625]],  // Vega-Sheliak
  [[18.7456, 37.6051], [18.8358, 33.3625]],  // Sulafat-Sheliak
  // Aquila - Altair head (Tarazed-Altair-Alshain) + body to λAql
  [[19.7717, 10.6133], [19.8464,  8.8683]],  // Tarazed-Altair
  [[19.8464,  8.8683], [19.9213,  6.4068]],  // Altair-Alshain
  [[19.8464,  8.8683], [19.1041, -4.8825]],  // Altair-λAql (long body)
  // Boötes (kite) - Arcturus-Izar-Nekkar-γBoo-Arcturus  + Arcturus-Muphrid
  [[14.2610, 19.1824], [14.7497, 27.0741]],  // Arcturus-Izar
  [[14.7497, 27.0741], [14.5347, 38.3083]],  // Izar-Nekkar
  [[14.5347, 38.3083], [14.5346, 38.3083]],  // (stub, kept for parity)
  [[14.5347, 38.3083], [14.2702, 30.3714]],  // Nekkar-γBoo (Seginus)
  [[14.2702, 30.3714], [14.2610, 19.1824]],  // γBoo-Arcturus
  [[14.2610, 19.1824], [13.9114, 18.3977]],  // Arcturus-Muphrid
  // Hercules keystone - π-η-ζ-ε (top half) + ζ-β (left side)
  [[17.2510, 36.8092], [16.7148, 38.9223]],  // πHer-ηHer
  [[16.7148, 38.9223], [16.6883, 31.6027]],  // ηHer-ζHer
  [[16.6883, 31.6027], [17.2575, 24.8392]],  // ζHer-εHer (approx)
  [[17.2510, 36.8092], [17.2575, 24.8392]],  // πHer-εHer (close keystone)
  [[16.6883, 31.6027], [16.5036, 21.4895]],  // ζHer-Kornephoros (βHer)
  // Pegasus Great Square - Markab-Scheat-Alpheratz-Algenib
  [[23.0793, 15.2053], [23.0628, 28.0828]],
  [[23.0628, 28.0828], [ 0.1397, 29.0904]],
  [[ 0.1397, 29.0904], [ 0.2206, 15.1836]],
  [[ 0.2206, 15.1836], [23.0793, 15.2053]],
  // Andromeda chain - Alpheratz-Mirach-Almach
  [[ 0.1397, 29.0904], [ 1.1623, 35.6206]],
  [[ 1.1623, 35.6206], [ 2.0649, 42.3297]],
  // Perseus - Mirfak-Algol-α' segment-bar
  [[ 3.4054, 49.8612], [ 3.1361, 40.9556]],  // Mirfak-Algol
  [[ 3.4054, 49.8612], [ 3.9624, 40.0102]],  // Mirfak-ε Per
  [[ 3.4054, 49.8612], [ 3.0792, 53.5063]],  // Mirfak-δ Per
  // Auriga pentagon - Capella-Menkalinan-θAur-Hassaleh-βTau(Elnath) - Elnath shared w/ Taurus
  [[ 5.2782, 45.9981], [ 5.9921, 44.9474]],  // Capella-Menkalinan
  [[ 5.9921, 44.9474], [ 5.9952, 37.2125]],  // Menkalinan-θAur (~mag 2.62)
  [[ 5.9952, 37.2125], [ 5.4382, 28.6075]],  // θAur-Elnath
  [[ 5.4382, 28.6075], [ 4.9498, 33.1661]],  // Elnath-ιAur (Hassaleh)? - using Hassaleh coords
  [[ 4.9498, 33.1661], [ 5.2782, 45.9981]],  // Hassaleh-Capella
  // Taurus - Aldebaran-Elnath (long horn) + Hyades V (just the spine)
  [[ 4.5987, 16.5092], [ 5.4382, 28.6075]],
  [[ 4.4767, 19.1804], [ 4.5987, 16.5092]],  // εTau-Aldebaran
  [[ 4.3829, 17.5425], [ 4.5987, 16.5092]],  // γTau-Aldebaran (Hyades apex)
  // Orion - Bellatrix-Betelgeuse-Alnitak-Saiph-Rigel-Mintaka-Bellatrix + belt
  [[ 5.4189,  6.3497], [ 5.9195,  7.4070]],  // Bellatrix-Betelgeuse
  [[ 5.9195,  7.4070], [ 5.6793, -1.9426]],  // Betelgeuse-Alnitak
  [[ 5.6793, -1.9426], [ 5.7959, -9.6696]],  // Alnitak-Saiph
  [[ 5.7959, -9.6696], [ 5.2423, -8.2017]],  // Saiph-Rigel
  [[ 5.2423, -8.2017], [ 5.5334, -0.2991]],  // Rigel-Mintaka
  [[ 5.5334, -0.2991], [ 5.4189,  6.3497]],  // Mintaka-Bellatrix
  [[ 5.5334, -0.2991], [ 5.6035, -1.2019]],  // belt: Mintaka-Alnilam
  [[ 5.6035, -1.2019], [ 5.6793, -1.9426]],  // belt: Alnilam-Alnitak
  // Canis Major - Sirius-Mirzam + Sirius-Adhara-Wezen triangle
  [[ 6.7525,-16.7161], [ 7.0140,-23.8336]],  // Sirius-Mirzam
  [[ 6.7525,-16.7161], [ 6.9770,-28.9721]],  // Sirius-Adhara
  [[ 6.9770,-28.9721], [ 7.1399,-26.3933]],  // Adhara-Wezen
  // Canis Minor - Procyon-Gomeisa
  [[ 7.6550,  5.2250], [ 7.4528,  8.2893]],
  // Gemini - Castor-Pollux (and to Alhena)
  [[ 7.5767, 31.8884], [ 7.7553, 28.0262]],
  [[ 7.7553, 28.0262], [ 6.6285, 16.3993]],  // Pollux-Alhena
  // Leo (sickle + back triangle) - Regulus-η-γAlgieba-ζAdhafera-μ-εRas Algethi (head)
  [[10.1395, 11.9672], [10.3328, 19.8415]],  // Regulus-Algieba
  [[10.3328, 19.8415], [10.2786, 23.4173]],  // Algieba-ζLeo Adhafera (~mag 3.43)
  [[10.2786, 23.4173], [ 9.7639, 23.7740]],  // ζLeo-μLeo
  [[ 9.7639, 23.7740], [ 9.7642, 26.0070]],  // μLeo-εLeo (head/sickle tip)
  // Back triangle: Regulus-Denebola-Zosma-Algieba
  [[10.1395, 11.9672], [11.8177, 14.5720]],  // Regulus-Denebola
  [[11.8177, 14.5720], [11.2351, 20.5237]],  // Denebola-Zosma
  [[11.2351, 20.5237], [10.3328, 19.8415]],  // Zosma-Algieba
  // Virgo - Spica-Vindemiatrix-γVirginis(Porrima)-ζVir
  [[13.4199,-11.1614], [13.0364, 10.9591]],  // Spica-Vindemiatrix
  [[13.0364, 10.9591], [12.6943, -1.4496]],  // Vindemiatrix-Porrima
  [[12.6943, -1.4496], [13.4199,-11.1614]],  // Porrima-Spica (close)
  // Corona Borealis - half-circle: ζ-α(Alphecca)-γ
  [[15.5784, 26.7147], [15.6438, 28.6201]],  // Alphecca-γCrB (approx)
  [[15.5784, 26.7147], [15.4297, 26.0686]],  // Alphecca-βCrB (approx)
  // Scorpius head + body - Acrab-Dschubba-π-Antares + Antares-εSco-...-Shaula-Sargas
  [[16.0050,-19.8054], [16.0050,-22.6217]],  // Dschubba-Acrab
  [[16.0050,-22.6217], [16.0050,-26.1140]],  // Acrab-πSco (approx)
  [[16.0050,-22.6217], [16.4901,-26.4320]],  // Acrab-Antares
  [[16.4901,-26.4320], [16.8359,-34.2929]],  // Antares-Sargas-area εSco
  [[16.8359,-34.2929], [17.5601,-37.1038]],  // Sargas-Shaula
  // Sagittarius teapot - Kaus Australis-KausMedia-KausBorealis-Nunki-Phi-Tau (abbreviated)
  [[18.4029,-34.3847], [18.3536,-29.8281]],  // KausAus-KausMedia
  [[18.3536,-29.8281], [18.2333,-25.4217]],  // KausMedia-KausBorealis (λSgr)
  [[18.2333,-25.4217], [19.0444,-27.6699]],  // KausBorealis-Nunki
  [[19.0444,-27.6699], [18.4029,-34.3847]],  // Nunki-KausAus (close teapot)
  // Crux (Southern Cross) - Acrux-Mimosa-Gacrux-δCru
  [[12.4433,-63.0991], [12.7953,-59.6886]],
  [[12.7953,-59.6886], [12.5194,-57.1131]],
  [[12.5194,-57.1131], [12.2522,-58.7489]],
  [[12.2522,-58.7489], [12.4433,-63.0991]],
  // Centaurus pointers - Rigil Kentaurus-Hadar (point at Crux)
  [[14.6601,-60.8354], [14.0637,-60.3729]],
];

function paintPolarModalConstellations(svg, obs, jsDate, sunAltDeg) {
  const layer = svg.querySelector('[data-layer="constellations"]');
  if (!layer) return;
  layer.replaceChildren();
  // Visibility gate - connecting unseen stars looks worse than blank
  // sky. Naked-eye limit must reach ~mag 3 for typical outline stars
  // to be plausibly visible; tied to sunAlt via the same model that
  // governs star/planet visibility, so the lines appear precisely when
  // the constellation endpoints would themselves render.
  const limMag = naturalSkyLimMag(sunAltDeg ?? -90);
  if (limMag < 3.0) return;
  // Fade up between civil and astronomical twilight so the lines
  // emerge gracefully rather than popping in.
  const fade = Math.max(0, Math.min(1, (limMag - 3.0) / 1.5));
  // Cool blue-violet tint - distinct from the neutral grid gray so
  // the eye can separate "chart structure" from "sky overlay" at a
  // glance, and warm enough to read as star-related rather than
  // graph-paper. Opacity scales with sky darkness so the lines feel
  // like an emerging hint rather than a printed-on overlay.
  const stroke = "rgb(150, 180, 230)";
  const opacity = 0.18 + 0.20 * fade; // 0.18 .. 0.38
  const { cx, cy, R } = MODAL_GEOM;
  for (const seg of CONSTELLATION_LINES) {
    const [p1, p2] = seg;
    const d1 = starDirectionEcef({ ra: p1[0], dec: p1[1] }, jsDate);
    const d2 = starDirectionEcef({ ra: p2[0], dec: p2[1] }, jsDate);
    const a1 = starAltAzForObs(obs, d1);
    const a2 = starAltAzForObs(obs, d2);
    if (a1.alt < 0 || a2.alt < 0) continue;
    const [x1, y1] = altAzToSvg(a1.alt, a1.az, cx, cy, R);
    const [x2, y2] = altAzToSvg(a2.alt, a2.az, cx, cy, R);
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", x1.toFixed(2));
    l.setAttribute("y1", y1.toFixed(2));
    l.setAttribute("x2", x2.toFixed(2));
    l.setAttribute("y2", y2.toFixed(2));
    l.classList.add("const-line");
    l.style.stroke = stroke;
    l.style.strokeOpacity = opacity.toFixed(2);
    layer.appendChild(l);
  }
}

function paintPolarModalStars(svg, obs, jsDate, limMag) {
  const starsG = svg.querySelector('[data-layer="stars"]');
  if (!starsG) return;
  starsG.replaceChildren();

  // Brighter stars get first claim to label space. Stars whose labels
  // would crash into an already-placed label still draw their dot.
  const labelEligible = [...BRIGHT_STARS].sort((a, b) => a.mag - b.mag);
  const placedLabels = [];
  // Twilight gate: stars dimmer than this magnitude are washed out by
  // sky glow at the prevailing sun altitude - skip rendering them.
  // limMag === null means "no filter" (legacy callers).
  const passesLimMag = (mag) => limMag == null || mag <= limMag;

  const drawStar = (star, withLabel) => {
    if (!passesLimMag(star.mag)) return;
    const dirEcef = starDirectionEcef(star, jsDate);
    const { alt, az } = starAltAzForObs(obs, dirEcef);
    if (alt < 0) return;
    const [x, y] = altAzToSvg(alt, az, MODAL_GEOM.cx, MODAL_GEOM.cy, MODAL_GEOM.R);
    const r = starDotRadius(star.mag);
    const op = starDotOpacity(star.mag);
    const d = document.createElementNS(SVG_NS, "circle");
    d.classList.add("star-dot");
    d.setAttribute("cx", x.toFixed(2));
    d.setAttribute("cy", y.toFixed(2));
    d.setAttribute("r", r.toFixed(2));
    d.setAttribute("fill", starDotColor(star));
    if (op < 1) d.setAttribute("opacity", op.toFixed(2));
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
  // Dots only - fill-in catalogs for visual density. DIM_STARS adds
  // the mag 4-5 layer that only appears on dark-sky nights (limMag
  // filter above gates it out at brighter twilight stages).
  for (const star of MORE_STARS)  drawStar(star, false);
  for (const star of FAINT_STARS) drawStar(star, false);
  for (const star of DIM_STARS)   drawStar(star, false);
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
  const DT = 2000; // ±2s window - fine enough that the tangent is well-defined
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

// Diamond-marker geometry. A diamond at (cx, cy) with half-extent r
// is rotated by `ang` so its long diagonal points ALONG the path -
// gives the marker a sense of direction. Vertices in moon-local
// (before rotation): forward (+r,0), perp (0,+r), backward (-r,0),
// anti-perp (0,-r). After rotating each by `ang`:
function diamondVerts(cx, cy, r, ang) {
  const cosA = Math.cos(ang), sinA = Math.sin(ang);
  return {
    fwd:  [cx + r * cosA,  cy + r * sinA],
    perp: [cx - r * sinA,  cy + r * cosA],
    back: [cx - r * cosA,  cy - r * sinA],
    anti: [cx + r * sinA,  cy - r * cosA],
  };
}
function diamondPath(cx, cy, r, ang) {
  const v = diamondVerts(cx, cy, r, ang);
  return `M ${v.fwd[0].toFixed(2)},${v.fwd[1].toFixed(2)} `
       + `L ${v.perp[0].toFixed(2)},${v.perp[1].toFixed(2)} `
       + `L ${v.back[0].toFixed(2)},${v.back[1].toFixed(2)} `
       + `L ${v.anti[0].toFixed(2)},${v.anti[1].toFixed(2)} Z`;
}
// Split diamond: divided by its perpendicular diagonal into two
// triangles. Returns the two halves + the full outline so the caller
// can stack fill (per half) + stroke (full outline) in one place.
function splitDiamondPaths(cx, cy, r, ang) {
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

// ms timestamp of the apparent-alt peak for a window at observer obs.
// 240-sample sweep is overkill spatially but cheap and lets the same
// peak anchor the sky backdrop, so any non-monotonic edge case lands
// on the same point as the event marker.
function passPeakMs(w, obs) {
  const SAMPLES = 240;
  let peakMs = w.startMs, peakAlt = -Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = w.startMs + (w.endMs - w.startMs) * i / SAMPLES;
    const e = issEcefAt(new Date(t));
    if (!e) continue;
    const a = issAltitudeDeg(obs, e);
    if (a > peakAlt) { peakAlt = a; peakMs = t; }
  }
  return peakMs;
}

function paintPolarModalEvents(svg, obs, peakMs, win) {
  const eventsG = svg.querySelector('[data-layer="events"]');
  if (!eventsG) return;
  eventsG.replaceChildren();
  const w = win ?? state.windows?.[state.activeWindowIdx];
  if (!w) return;
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
  // Markers are DIAMONDS so they're visually distinct from the
  // circular sun/moon discs. If two adjacent events (start↔peak or
  // peak↔end) land within one diamond extent of each other, render a
  // SPLIT diamond - rotated to align one of its diagonals with the
  // path tangent, then cut by the perpendicular diagonal into two
  // triangles. Earlier-color sits on the inbound side, later-color on
  // the outbound side.
  const MARKER_R = 2.4;
  const OVERLAP_THRESHOLD = 2 * MARKER_R + 0.5;
  const consumed = new Set();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (!a.valid || !b.valid) continue;
    if (Math.hypot(b.x - a.x, b.y - a.y) >= OVERLAP_THRESHOLD) continue;
    const midMs = (a.ms + b.ms) / 2;
    let dir = pathTangentSvg(obs, midMs);
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
    let dir = pathTangentSvg(obs, p.ms);
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
  // unrotated - "along the path" of the horizontal info row), each
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
  // with character count - exact measurement would require getBBox
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
    ln.setAttribute("stroke", POLAR_ARC_COLOR);
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

// Paint the SVG (offscreen) and rasterize it to a PNG blob URL that
// becomes the user-facing <img>. Going through an <img> gives native
// right-click → Save image / Open in new tab / Copy image behavior;
// the SVG stays offscreen purely as the render source.
//
// Resolves only AFTER the resulting bitmap has fully decoded into the
// <img> element, so the caller can wait before unhiding the modal -
// otherwise the user sees a frame of empty <img> while the PNG paints.
async function renderPolarModal(obs) {
  // Modal uses the OBSERVER's full pass (extended from the joint
  // window outward until this station can't see ISS) - that's the
  // user's actual horizon-to-horizon view, regardless of when other
  // observers join in. Resolution order:
  //   1) Joint window selected → expand from its midpoint
  //   2) Otherwise, use the per-observer cache (set by the sighting
  //      tracker whenever this observer can currently see ISS),
  //      which lets a station that's still sighting after the joint
  //      pass ended open a populated modal
  //   3) Fall back to a fresh expansion anchored at the current
  //      clock time (covers the case where the cache is empty but
  //      this observer happens to be sighting right now)
  //   4) Last resort: leave obsWin null so the modal renders with
  //      no arc, matching the "no current pass" state
  const joinW = state.windows?.[state.activeWindowIdx];
  let obsWin = null;
  if (joinW) {
    const midMs = (joinW.startMs + joinW.endMs) / 2;
    obsWin = passWindowAtMsForObserver(obs, midMs) ?? joinW;
  } else {
    obsWin = _obsCurrentPass.get(obs.id) ?? null;
    if (!obsWin) {
      const nowMs = Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime();
      obsWin = passWindowAtMsForObserver(obs, nowMs);
    }
  }
  // Sky backdrop (stars / sun / moon / planets) is anchored at the
  // pass PEAK time, not the playback clock - opening the modal for a
  // pass three hours away would otherwise show today's sky behind a
  // chart annotated with that distant pass's timestamp. Sun altitude
  // at that instant drives both the chart's shade and the limiting
  // magnitude (which dim objects fade into the twilight glow).
  const peakMsTop = obsWin ? passPeakMs(obsWin, obs) : Date.now();
  const sunAltAtPeak = sunAltitudeDeg(obs, new Date(peakMsTop));
  const limMag = naturalSkyLimMag(sunAltAtPeak);
  paintPolarModalStatic(polarModalSvg, obs, peakMsTop, sunAltAtPeak);
  paintPolarModalArc(polarModalSvg, obs, obsWin);
  const jsDate = new Date(peakMsTop);
  paintPolarModalEvents(polarModalSvg, obs, peakMsTop, obsWin);
  paintPolarModalConstellations(polarModalSvg, obs, jsDate, sunAltAtPeak);
  paintPolarModalStars(polarModalSvg, obs, jsDate, limMag);
  paintPolarModalSunMoon(polarModalSvg, obs, jsDate, limMag);
  paintPolarModalLegend(polarModalSvg, obs, jsDate, limMag);
  const blob = await svgToPngBlob(polarModalSvg);
  const url = URL.createObjectURL(blob);
  if (_polarModalImgUrl) URL.revokeObjectURL(_polarModalImgUrl);
  _polarModalImgUrl = url;
  // decode() resolves once the bitmap is ready to paint - strictly
  // stronger than `onload`, which can fire before the first paint.
  polarModalImg.src = url;
  // Wrap-anchor mirrors the img so right-click save picks up a real
  // filename. Same blob URL as the img - browsers that honor the
  // anchor's download attribute on img right-click will use it.
  polarModalImgLink.href = url;
  polarModalImgLink.download = polarModalFileName();
  if (polarModalImg.decode) {
    try { await polarModalImg.decode(); } catch { /* fall through */ }
  }
}

async function openPolarModal(obsId) {
  const obs = state.observers.find(o => o.id === obsId);
  if (!obs) return;
  _polarModalObsId = obsId;
  // Briefly hint that something's happening - render typically takes
  // 50-250 ms - without flashing an empty modal at the user.
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

// (Polar-plot click handling lives on the whole .obs-card now - see
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
  // Timestamp from the ACTIVE pass start, formatted in the observer's
  // local timezone - filename describes when the pass is, not when
  // the file was saved. Output shape:
  //   iss-pass-<obs>-YYYY-MM-DDTHHMMSS-OOOO.png
  // ISO 8601 extended date + basic-format time + basic UTC offset.
  // No colons anywhere (Windows-safe), sortable next to the date.
  const w = state.windows?.[state.activeWindowIdx];
  const ms = w?.startMs ?? Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime();
  const tz = obs?.tz;
  const fmtOpts = {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  };
  if (tz) fmtOpts.timeZone = tz;
  const parts = new Intl.DateTimeFormat("en-CA", fmtOpts).formatToParts(new Date(ms));
  const get = (t) => parts.find(p => p.type === t)?.value ?? "";
  const dateSlug = `${get("year")}-${get("month")}-${get("day")}`;
  const timeSlug = `${get("hour")}${get("minute")}${get("second")}`;
  // UTC offset for the tz at that instant. `longOffset` formats it
  // as "GMT-05:00" or "GMT+05:30" - strip prefix and colon for the
  // basic-format tag. Fall back to "Z" when no tz is known.
  let offsetSlug = "Z";
  if (tz) {
    try {
      const op = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, timeZoneName: "longOffset",
      }).formatToParts(new Date(ms));
      const raw = op.find(p => p.type === "timeZoneName")?.value ?? "";
      const tag = raw.replace(/^GMT/, "").replace(":", "");
      if (tag) offsetSlug = tag;
    } catch (_) { /* keep Z */ }
  }
  return `iss-pass-${obsSlug}-${dateSlug}T${timeSlug}${offsetSlug}.png`;
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
    card.title = `Open polar plot - ${obs.name}`;
    // Whole card opens the polar modal - inner buttons stopPropagation
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
    // "View from here" button - toggles first-person camera mode.
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
    tleStatusEl.textContent = "fetch failed - paste a TLE below.";
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
//   2. Try a small ordered list of nearby candidate slots - natural slot
//      first, then a handful of cardinal/diagonal offsets near the
//      anchor.
//   3. The first slot that doesn't overlap any previously-placed label
//      wins; the label's offset is stored as { dx, dy } in labelOffsets.
//
// Result: each label stays at or very near its natural anchor unless
// it actually collides with something, and even then it only moves to a
// nearby slot - no long downward "drift" like the previous always-down
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
    // (Midpoint labels removed - alt/az now lives in the pin label as
    // a conditional second line, so the only declutter targets are pin
    // labels themselves.)
  }
  if (!items.length) return;

  const placed = [];
  for (const it of items) {
    const cands = PIN_CANDIDATES;
    // Default to the last candidate so we always produce some placement
    // even if every slot collides - labels overlapping is preferable to
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
// is invisible - so the dot stays on the line at all playback speeds.
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
// hotter stars bluer) - see starDotColor() below.
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

// Supplemental fainter catalog - RA/Dec/mag, no names. Plotted as dots
// in the fullscreen polar modal to give the sky chart visual density,
// but NOT added as labels in the 3D scene (would crowd the globe).
// J2000 epoch, mostly mag 2.0 - 3.5.
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

// Even fainter fill-in catalog - RA/Dec/mag/cls. No names, no labels.
// Used to give the polar modal real sky density (typical naked-eye
// limit on a dark night is ~mag 6, suburban ~4 - these are mostly
// mag 3.0-4.0 stars on common constellation outlines).
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

// Deep-sky fill catalog - mag 4.0 to 5.0, mostly constellation
// infill so the chart looks naturally dense on dark-sky nights
// (naturalSkyLimMag returns 5.0+ for sun below ~-15°). Same
// {ra,dec,mag,cls} shape as the other catalogs. No names; dots only.
const DIM_STARS = [
  // Andromeda
  { ra:  0.8307, dec:  38.4992, mag: 4.41, cls: "B" },  // ε And
  { ra:  0.7295, dec:  23.4178, mag: 4.27, cls: "K" },  // ι Psc near
  { ra:  1.6377, dec:  48.6285, mag: 4.05, cls: "G" },  // 51 And
  { ra:  1.5839, dec:  41.4051, mag: 4.84, cls: "K" },  // υ And
  // Cassiopeia infill
  { ra:  1.1543, dec:  62.9303, mag: 4.61, cls: "G" },  // η Cas (binary)
  { ra:  0.4900, dec:  64.8775, mag: 4.50, cls: "G" },  // κ Cas
  { ra:  1.2528, dec:  68.1311, mag: 4.51, cls: "B" },  // 50 Cas
  { ra:  2.4194, dec:  74.9892, mag: 4.30, cls: "B" },  // λ Cas
  { ra: 23.5108, dec:  77.6322, mag: 4.16, cls: "A" },  // η Cep nearby
  // Cepheus
  { ra: 22.1814, dec:  58.2009, mag: 3.39, cls: "K" },  // ζ Cep
  { ra: 22.4878, dec:  66.2003, mag: 4.21, cls: "A" },  // θ Cep
  { ra: 22.8281, dec:  66.2003, mag: 4.29, cls: "A" },  // ν Cep
  { ra: 21.7251, dec:  58.7803, mag: 4.04, cls: "M" },  // μ Cep (Garnet)
  { ra: 22.8281, dec:  61.8364, mag: 4.18, cls: "A" },  // δ Cep
  // Draco
  { ra: 19.2090, dec:  67.6614, mag: 3.07, cls: "G" },  // δ Dra
  { ra: 18.3464, dec:  72.7325, mag: 3.29, cls: "M" },  // ζ Dra
  { ra: 17.5083, dec:  52.3014, mag: 3.75, cls: "G" },  // ξ Dra
  { ra: 16.0089, dec:  58.5650, mag: 3.84, cls: "M" },  // ι Dra (Edasich)
  { ra: 15.4156, dec:  58.9661, mag: 3.85, cls: "F" },  // θ Dra
  // Perseus
  { ra:  3.7544, dec:  32.2880, mag: 2.85, cls: "O" },  // ζ Per (dup-safe)
  { ra:  4.2992, dec:  41.0727, mag: 4.04, cls: "O" },  // ξ Per
  { ra:  2.9706, dec:  53.5063, mag: 3.96, cls: "A" },  // η Per
  { ra:  3.9544, dec:  35.7910, mag: 3.77, cls: "K" },  // ν Per
  { ra:  3.4574, dec:  44.8579, mag: 3.79, cls: "K" },  // κ Per
  // Auriga
  { ra:  6.0653, dec:  29.4988, mag: 2.65, cls: "B" },  // β Tau (Elnath)... already in BRIGHT
  { ra:  4.9498, dec:  33.1661, mag: 2.69, cls: "K" },  // Hassaleh in MORE
  { ra:  6.2289, dec:  37.3878, mag: 4.99, cls: "K" },  // 14 Aur
  // Taurus (Hyades + Pleiades infill)
  { ra:  3.7913, dec:  24.1052, mag: 2.87, cls: "B" },  // Alcyone (in BRIGHT)
  { ra:  3.8197, dec:  24.0533, mag: 3.62, cls: "B" },  // Atlas (27 Tau)
  { ra:  3.7497, dec:  24.0507, mag: 3.70, cls: "B" },  // Electra (17 Tau)
  { ra:  3.7656, dec:  24.3678, mag: 3.85, cls: "B" },  // Maia (20 Tau)
  { ra:  4.4767, dec:  19.1804, mag: 3.53, cls: "K" },  // ε Tau (Ain)
  { ra:  4.3829, dec:  17.5425, mag: 3.65, cls: "K" },  // γ Tau (Hyadum I)
  { ra:  4.4783, dec:  15.6203, mag: 3.76, cls: "K" },  // δ Tau (Hyadum II)
  { ra:  4.5031, dec:  15.9619, mag: 3.40, cls: "K" },  // θ² Tau (Chamukuy)
  { ra:  5.6276, dec:  21.1426, mag: 3.00, cls: "B" },  // ζ Tau (Tien Kuan)
  { ra:  4.0061, dec:  12.4906, mag: 3.41, cls: "B" },  // λ Tau
  // Orion infill
  { ra:  5.3531, dec:  -4.8389, mag: 3.19, cls: "B" },  // π³ Ori
  { ra:  5.4078, dec:  -2.3972, mag: 3.69, cls: "B" },  // π⁴ Ori
  { ra:  5.5856, dec:   9.9342, mag: 3.39, cls: "O" },  // λ Ori (Meissa)
  { ra:  5.5934, dec:   9.9342, mag: 4.39, cls: "O" },  // φ¹ Ori (~near λ)
  { ra:  5.5878, dec:  -5.9100, mag: 2.77, cls: "O" },  // ι Ori (Hatysa)
  { ra:  5.6457, dec:  -2.6000, mag: 3.81, cls: "O" },  // σ Ori
  { ra:  5.1296, dec:   2.4408, mag: 4.40, cls: "B" },  // χ¹ Ori
  // Gemini
  { ra:  7.3354, dec:  21.9824, mag: 3.50, cls: "F" },  // δ Gem (Wasat)
  { ra:  6.7325, dec:  25.1311, mag: 3.06, cls: "G" },  // ε Gem (Mebsuta)
  { ra:  7.0686, dec:  20.5703, mag: 3.79, cls: "G" },  // ζ Gem (Mekbuda)
  { ra:  6.2483, dec:  22.5067, mag: 3.31, cls: "M" },  // η Gem (Propus)
  { ra:  6.3793, dec:  22.5142, mag: 2.88, cls: "M" },  // μ Gem (Tejat)
  { ra:  6.7536, dec:  12.8956, mag: 3.58, cls: "A" },  // λ Gem
  { ra:  6.6298, dec:  16.3993, mag: 1.93, cls: "A" },  // Alhena (in BRIGHT)
  { ra:  6.2475, dec:  16.0794, mag: 3.36, cls: "F" },  // ξ Gem
  // Canis Major
  { ra:  6.9776, dec: -28.9722, mag: 1.50, cls: "B" },  // Adhara (BRIGHT)
  { ra:  6.3782, dec: -17.9550, mag: 3.95, cls: "B" },  // ν² CMa
  { ra:  7.2861, dec: -26.7720, mag: 4.07, cls: "B" },  // σ CMa
  // Leo
  { ra: 10.1219, dec:  16.7625, mag: 3.52, cls: "A" },  // η Leo
  { ra: 11.2378, dec:  15.4296, mag: 3.34, cls: "A" },  // θ Leo (Chertan)
  { ra: 11.4017, dec:  10.5295, mag: 3.94, cls: "F" },  // ι Leo
  { ra: 11.3501, dec:   6.0297, mag: 4.05, cls: "A" },  // σ Leo
  { ra:  9.7642, dec:  23.7740, mag: 3.88, cls: "K" },  // μ Leo
  { ra:  9.5292, dec:  26.0070, mag: 2.98, cls: "G" },  // ε Leo (Ras Elased)
  { ra: 10.2786, dec:  23.4173, mag: 3.43, cls: "F" },  // ζ Leo (Adhafera)
  // Virgo
  { ra: 12.9266, dec:   3.3974, mag: 3.39, cls: "M" },  // δ Vir
  { ra: 12.3322, dec:  -0.6664, mag: 3.89, cls: "A" },  // η Vir
  { ra: 14.2129, dec:  -6.0006, mag: 4.07, cls: "F" },  // ι Vir
  { ra: 14.7704, dec:   1.8930, mag: 3.72, cls: "A" },  // 109 Vir
  { ra: 11.8407, dec:   6.5293, mag: 4.03, cls: "M" },  // ν Vir
  // Boötes
  { ra: 14.5347, dec:  38.3083, mag: 3.50, cls: "G" },  // β Boo (Nekkar)
  { ra: 14.5347, dec:  46.0883, mag: 3.78, cls: "A" },  // ζ Boo
  { ra: 14.4172, dec:  51.7906, mag: 4.05, cls: "F" },  // θ Boo
  // Hercules
  { ra: 16.5036, dec:  21.4895, mag: 2.78, cls: "G" },  // β Her (in MORE)
  { ra: 17.4014, dec:  29.2483, mag: 2.81, cls: "G" },  // ζ Her
  { ra: 17.2510, dec:  14.3903, mag: 3.13, cls: "A" },  // δ Her
  { ra: 17.0001, dec:  30.9264, mag: 3.92, cls: "A" },  // ε Her
  { ra: 16.7148, dec:  38.9223, mag: 3.53, cls: "G" },  // η Her
  { ra: 17.2510, dec:  36.8092, mag: 3.16, cls: "K" },  // π Her
  { ra: 17.2492, dec:  27.7203, mag: 3.42, cls: "G" },  // μ Her
  { ra: 17.9759, dec:  29.2483, mag: 3.70, cls: "K" },  // ξ Her
  // Lyra parallelogram (fainter members)
  { ra: 18.8973, dec:  36.8989, mag: 4.36, cls: "G" },  // ζ¹ Lyr
  { ra: 19.2179, dec:  39.1469, mag: 4.39, cls: "M" },  // η Lyr
  { ra: 19.2542, dec:  38.1336, mag: 4.36, cls: "K" },  // θ Lyr
  { ra: 18.9087, dec:  36.8989, mag: 4.30, cls: "M" },  // δ² Lyr
  // Cygnus infill
  { ra: 19.7494, dec:  45.1304, mag: 2.87, cls: "B" },  // δ Cyg
  { ra: 21.2154, dec:  30.2266, mag: 3.21, cls: "G" },  // ζ Cyg
  { ra: 19.5125, dec:  35.0833, mag: 3.89, cls: "K" },  // η Cyg
  { ra: 19.4933, dec:  51.7297, mag: 3.79, cls: "A" },  // ι Cyg
  { ra: 21.0786, dec:  43.9281, mag: 3.72, cls: "K" },  // ξ Cyg
  { ra: 19.5567, dec:  53.3681, mag: 3.77, cls: "K" },  // κ Cyg
  { ra: 20.3000, dec:  47.7142, mag: 4.43, cls: "K" },  // 39 Cyg
  // Aquila
  { ra: 19.4250, dec:   3.1147, mag: 3.36, cls: "F" },  // δ Aql (in FAINT)
  { ra: 20.1882, dec:  -0.8214, mag: 3.23, cls: "B" },  // θ Aql
  { ra: 19.0922, dec: -13.7726, mag: 3.43, cls: "B" },  // λ Aql
  { ra: 18.9930, dec:  15.0683, mag: 4.02, cls: "K" },  // ε Aql
  { ra: 19.4036, dec: -14.3814, mag: 4.36, cls: "B" },  // ι Aql
  // Sagittarius infill (teapot interior)
  { ra: 18.4029, dec: -25.4217, mag: 2.81, cls: "K" },  // λ Sgr (Kaus Bor)
  { ra: 19.0444, dec: -21.7411, mag: 3.10, cls: "F" },  // ζ Sgr
  { ra: 18.9657, dec: -29.8281, mag: 2.99, cls: "B" },  // φ Sgr
  { ra: 18.2814, dec: -25.6231, mag: 3.51, cls: "K" },  // μ Sgr
  // Capricornus
  { ra: 20.2935, dec: -14.7814, mag: 2.85, cls: "A" },  // δ Cap (in MORE)
  { ra: 20.3001, dec: -12.5444, mag: 3.05, cls: "G" },  // β Cap (Dabih)
  { ra: 21.1187, dec: -16.6622, mag: 3.69, cls: "A" },  // γ Cap
  { ra: 21.5440, dec: -22.4117, mag: 3.74, cls: "G" },  // ζ Cap
  // Aquarius
  { ra: 22.0964, dec:  -0.3198, mag: 2.95, cls: "G" },  // α Aqr (in MORE)
  { ra: 21.5260, dec:  -5.5712, mag: 2.87, cls: "G" },  // β Aqr (in MORE)
  { ra: 22.2862, dec:  -7.5783, mag: 3.84, cls: "A" },  // γ Aqr (in FAINT)
  { ra: 22.4806, dec: -16.8347, mag: 3.74, cls: "M" },  // λ Aqr
  { ra: 20.6781, dec:  -9.4956, mag: 3.77, cls: "A" },  // ε Aqr
  { ra: 22.5878, dec:  -0.0197, mag: 4.04, cls: "B" },  // η Aqr
  // Pisces
  { ra:  1.5247, dec:  15.3458, mag: 3.62, cls: "G" },  // η Psc (Alpherg)
  { ra: 23.2867, dec:   3.2828, mag: 3.69, cls: "G" },  // γ Psc
  { ra: 23.6594, dec:   6.8639, mag: 4.03, cls: "F" },  // ω Psc
  { ra:  0.8203, dec:  -7.7831, mag: 4.27, cls: "K" },  // ε Psc
  { ra: 23.2806, dec:   1.7811, mag: 4.27, cls: "K" },  // θ Psc
  // Ophiuchus
  { ra: 17.7250, dec:   4.5673, mag: 2.78, cls: "K" },  // β Oph
  { ra: 16.6184, dec:  -3.6942, mag: 2.43, cls: "A" },  // δ Oph (Yed Prior)
  { ra: 16.9619, dec:  -3.4344, mag: 3.24, cls: "G" },  // ε Oph (Yed Post)
  { ra: 17.7233, dec:  -9.7733, mag: 3.27, cls: "K" },  // η Oph
  { ra: 17.0964, dec: -15.7250, mag: 2.43, cls: "A" },  // η Oph (Sabik, in MORE)
  // Corvus
  { ra: 12.2635, dec: -17.5419, mag: 2.59, cls: "B" },  // γ Crv (in MORE)
  { ra: 12.4172, dec: -22.6195, mag: 2.65, cls: "G" },  // β Crv (in MORE)
  { ra: 12.4972, dec: -16.5156, mag: 2.95, cls: "K" },  // δ Crv (Algorab)
  { ra: 12.1404, dec: -24.7290, mag: 4.02, cls: "A" },  // ε Crv
  // Crater
  { ra: 11.3239, dec: -18.3506, mag: 4.07, cls: "K" },  // δ Crt
  { ra: 11.4196, dec: -14.7780, mag: 4.46, cls: "G" },  // γ Crt
  // Centaurus / Lupus (some southern infill)
  { ra: 13.6647, dec: -53.4664, mag: 2.06, cls: "K" },  // ε Cen
  { ra: 12.1393, dec: -50.7222, mag: 2.20, cls: "B" },  // δ Cen
  { ra: 13.9259, dec: -47.2885, mag: 2.30, cls: "B" },  // ζ Cen
  // Pavo / Tucana / Grus southern stars
  { ra: 22.7117, dec: -46.8847, mag: 4.11, cls: "B" },  // β Gru
  { ra: 22.0911, dec: -39.5430, mag: 3.49, cls: "G" },  // γ Gru
];

// Star "dot" radius scales with apparent flux: area ∝ flux, so
// radius = const × 10^(-mag/5) (one mag step → flux ratio of 10^(2/5) ≈
// 2.512, so r ratio of 10^(1/5) ≈ 1.585). This matches the Pogson scale
// and gives a visually proper sense of relative brightness - Sirius and
// Vega read as bigger than Polaris, Polaris bigger than mag-3 fillers.
// Saturated at the bright end (mag < -1) so Sirius doesn't dwarf the
// chart, and at the faint end so mag-4 stars stay readable.
function starDotRadius(mag) {
  if (mag == null) mag = 2.5;
  const r = 0.95 * Math.pow(10, -mag / 5);
  // Lower max clamp keeps brightest stars (Sirius, Canopus) from
  // dominating the chart visually - Pogson would happily render
  // Sirius at 2.5× Vega's radius, which looks like a small planet.
  return Math.max(0.18, Math.min(1.15, r));
}
// Opacity scale takes over where the radius clamp flattens out - once
// stars all hit the 0.18 minimum radius (mag ~3.7 and dimmer), they'd
// otherwise look identical even though a mag 5 star is ~3× fainter
// than a mag 3.5 star. Fading opacity preserves the Pogson "more flux
// = more rendered light" rule end-to-end. Bright stars (mag < 3.5)
// keep full opacity since their radius already encodes brightness.
function starDotOpacity(mag) {
  if (mag == null) return 1.0;
  const FADE_START = 3.5;  // mag where opacity begins to drop
  const FADE_END   = 6.0;  // mag at minimum opacity
  if (mag <= FADE_START) return 1.0;
  const t = Math.min(1, (mag - FADE_START) / (FADE_END - FADE_START));
  return 1.0 - t * 0.65;   // 1.0 → 0.35 across the fade range
}
// Stars are functionally at infinity, so a label needs to appear in the
// star's direction regardless of camera position. We place each label
// at (camera + starDir × very_large_distance), updated every frame -
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
  // ECI → ECEF: rotate by -gmst about Z so stars stay fixed in the
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
      // Match the planet-label clearance so stars and planets read
      // with the same label spacing - a few pixels of gap above the
      // (skybox-rendered) star dot.
      pixelOffset: new Cesium.Cartesian2(0, -5),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: new Cesium.CallbackProperty((time) => {
        return isInFrontOfEarth(starLabelPos(star, Cesium.JulianDate.toDate(time)));
      }, false),
    },
  });
}

// Five classical naked-eye planets as colored dots at their apparent
// sky position. Uses the same camera-relative STAR_FAR_M trick as the
// bright-star labels - keeps each planet stuck at its real direction
// in the sky regardless of where the camera flies. Pixel sizes are
// typical naked-eye visibility (Venus brightest → biggest; Mercury /
// Saturn dimmer → smaller). Hidden when behind Earth from the camera.
const PLANET_PIXEL_SIZES = {
  mercury: 2.8,
  venus:   6.0,
  mars:    4.0,
  jupiter: 5.0,
  saturn:  3.4,
};
function planetSkyPos(pname, jsDate) {
  const d = planetPositionEcef(pname, jsDate);
  const cam = viewer.camera.positionWC;
  return Cesium.Cartesian3.fromElements(
    cam.x + d[0] * STAR_FAR_M,
    cam.y + d[1] * STAR_FAR_M,
    cam.z + d[2] * STAR_FAR_M,
  );
}
for (const pname of PLANET_NAMES) {
  const style = PLANET_STYLE[pname];
  viewer.entities.add({
    position: new Cesium.CallbackProperty((time) => {
      return planetSkyPos(pname, Cesium.JulianDate.toDate(time));
    }, false),
    point: {
      pixelSize: PLANET_PIXEL_SIZES[pname] ?? 3,
      color: Cesium.Color.fromCssColorString(style.color),
      outlineColor: Cesium.Color.BLACK.withAlpha(0.45),
      outlineWidth: 0.6,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: new Cesium.CallbackProperty((time) => {
        return isInFrontOfEarth(planetSkyPos(pname, Cesium.JulianDate.toDate(time)));
      }, false),
    },
    // Name label sits ABOVE the planet dot - bottom-anchored at the
    // entity position with a small upward pixel offset, matching the
    // bright-star label placement. Tinted with the planet's
    // traditional naked-eye color so the label reads as belonging to
    // its dot.
    label: {
      text: style.name,
      font: "10px sans-serif",
      fillColor: Cesium.Color.fromCssColorString(style.color),
      outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      showBackground: false,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(
        0, -((PLANET_PIXEL_SIZES[pname] ?? 3) / 2 + 2),
      ),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: new Cesium.CallbackProperty((time) => {
        return isInFrontOfEarth(planetSkyPos(pname, Cesium.JulianDate.toDate(time)));
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
// Rendered as N short polyline entities (one per sample segment) - each
// gets a single solid material color, so the segments together form a
// smooth gradient line along the ISS path.
// ---------------------------------------------------------------------------

const PASS_GRADIENT_SAMPLES = 60;
let activePassEntities = [];

// Stops for the rating gradient - used by both the orbit overlay
// (returning Cesium.Color via ratingColorAt) and every colored column
// in the passes list (returning a CSS rgb() string via ratingCssColor).
// Even thirds - red below 1/3 (success unlikely), yellow at 1/3 (coin
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
// forecast skill decays - used for the clouds column, since point
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
// Probability-factor curves - single source of truth for both the rating
// math AND the gradient coloring of the passes-list columns. The number
// you see colored in any column IS the value that contributed to the
// joint capture probability for that pass.
// ---------------------------------------------------------------------------

// Sky-darkness factor from sun altitude (apparent, refraction-corrected).
// Linear from horizon (sun = 0°) to nautical (sun = -12°), saturating at 1.
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
//     observer's twilight - not by cubing nearly-identical values.
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
// across moments - geometry is deterministic and clouds are
// near-constant within a pass, so consecutive sample probabilities are
// heavily correlated, and a naïve "1 - ∏(1 - p)" would overcount.
//
// Duration sigmoid: pCoord = dur / (dur + 30). 30s → 0.50, 60s → 0.67,
// 120s → 0.80, 240s → 0.89, asymptotic to 1 - captures diminishing
// returns past ~2 minutes (more time doesn't keep helping forever).
function passSuccessProbability(win, observers) {
  if (state.mode === "radio") {
    return radioPassSuccessProbability(win, observers, state.minElevDeg);
  }
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

// Radio-reception score. The visibility filter already guaranteed
// every observer's apparent elevation ≥ minElevDeg throughout the
// window, so the only remaining variables are (a) how HIGH the pass
// gets - the worst observer's peak elevation, which limits the joint
// best signal-to-noise - and (b) how LONG the window lasts (more time
// = more opportunities for a QSO / better Doppler measurement).
function peakElevFactor(deg) {
  return Math.max(0, Math.min(1, (deg - 5) / 50));
}
// Duration → quality curve. Exponential approach to 1.0 with a 90s
// time constant - short passes (<2 min) score low, a typical 6-7 min
// overhead pass lands in the high 90s, and the curve asymptotes so
// implausibly long passes don't break the upper bound.
//   60s   →  0.49
//  120s   →  0.74
//  180s   →  0.86
//  300s   →  0.96
//  420s   →  0.99
//  600s   →  ~1.00
// min(1, ·) is belt-and-braces against numerical drift at very large
// sec - the bare exp form already stays < 1 mathematically.
function radioDurationFactor(sec) {
  return Math.min(1, 1 - Math.exp(-sec / 90));
}
function radioPassSuccessProbability(win, observers, minElevDeg) {
  if (!win || !observers.length) return 0;
  const totalMs = win.endMs - win.startMs;
  if (totalMs <= 0) return 0;
  const STEP_MS = Math.max(1_000, Math.min(5_000, totalMs / 30));
  // Worst-observer peak elevation across the window (limiting case
  // for coordinated multi-station work).
  let worstPeak = Infinity;
  for (const obs of observers) {
    let peak = -Infinity;
    for (let t = win.startMs; t <= win.endMs; t += STEP_MS) {
      const issEcef = issEcefAt(new Date(t));
      if (!issEcef) continue;
      const a = apparentAltDeg(issAltitudeDeg(obs, issEcef));
      if (a > peak) peak = a;
    }
    if (peak < worstPeak) worstPeak = peak;
  }
  if (!Number.isFinite(worstPeak)) return 0;
  return peakElevFactor(worstPeak) * radioDurationFactor(totalMs / 1000);
}

// Per-moment radio-link quality used by the orbit-arc gradient.
// Worst observer's elevation factor at this instant - gradient turns
// red where the worst observer is near the horizon, green near zenith.
function radioCaptureAt(observers, issEcef, minElevDeg) {
  let worst = 1;
  for (const obs of observers) {
    const a = apparentAltDeg(issAltitudeDeg(obs, issEcef));
    if (a < minElevDeg) return 0;
    const f = peakElevFactor(a);
    if (f < worst) worst = f;
  }
  return worst;
}


// Visual magnitude of the (sunlit) ISS from one observer at one instant.
// Standard satellite-magnitude formula:
//   m = m_std + 5·log10(range / 1000 km)  -  2.5·log10(F(α))
// where m_std = -1.8 is the intrinsic magnitude at 1000 km / full phase,
// α is the phase angle (satellite→sun vs satellite→observer), and
// F(α) = (1 + cos α) / 2 is the Lambertian-sphere phase function.
// Returns null when the observer is looking at the unlit hemisphere
// (F ≤ 0) - in that case the satellite isn't visible at all.
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
// magnitude across the observers - the floor everyone is guaranteed to
// see at that instant - and then across moments we take the BRIGHTEST
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
    const quality = state.mode === "radio"
      ? radioCaptureAt(state.observers, issEcef, state.minElevDeg)
      : captureProbJoint(state.observers, issEcef, d, t, nowMs);
    samples.push({
      pos: Cesium.Cartesian3.fromElements(issEcef[0], issEcef[1], issEcef[2]),
      quality,
    });
  }
  // Draw each segment between adjacent samples with color from the
  // midpoint quality. Solid color material (not glow - glow's white core
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
// the user had selected - when someone opens the link, we jump to the
// window matching that start time so they land exactly where the
// sharer was looking.
//
// Sources of truth on load, in priority order:
//   1. URL ?s=... (sharable links beat localStorage so opening
//      someone else's link doesn't pick up your own saved observers)
//   2. localStorage entry under LS_STATE_KEY
//   3. The seeded Chicago/Milwaukee/Cincinnati defaults
const LS_STATE_KEY = "iss-triangulation/state/v1";

// Time-of-pass that was on the URL when the page loaded - consumed by
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
  // Mode + min-elev only encoded when non-default; keeps casual-share
  // URLs short. Min-elev applies in both modes now, so encode whenever
  // it deviates from the 10° default regardless of mode.
  if (state.mode === "radio") obj.m = "r";
  if (state.minElevDeg !== 10) obj.e = state.minElevDeg;
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
      mode: obj.m === "r" ? "radio" : "visual",
      minElevDeg: Number.isFinite(obj.e) ? Math.max(0, Math.min(80, +obj.e)) : 10,
    };
  } catch (_) {
    return null;
  }
}

// localStorage only - the URL is left clean. Share button (below)
// generates a fresh ?s=... URL on demand so the ugly blob only shows
// up when explicitly copying a link to share with someone else.
function persistState() {
  const blob = encodeStateBlob();
  try {
    localStorage.setItem(LS_STATE_KEY, blob);
  } catch (_) { /* private browsing etc. - silently skip */ }
}

// Build the URL a recipient would open to land on the current pass +
// observer + mode setup. Used by the Share button.
function buildShareUrl() {
  const url = new URL(window.location.href);
  url.search = state.observers.length ? `?s=${encodeStateBlob()}` : "";
  return url.toString();
}

function loadInitialObservers() {
  const urlBlob = new URLSearchParams(window.location.search).get("s");
  const fromUrl = decodeStateBlob(urlBlob);
  // If the URL carried a state blob, parse it then strip ?s=... so the
  // address bar stays clean. The blob will reappear only when the user
  // copies a share link via the Share button.
  if (urlBlob) {
    const cleaned = new URL(window.location.href);
    cleaned.search = "";
    history.replaceState(null, "", cleaned);
  }
  if (fromUrl && fromUrl.observers.length) {
    if (fromUrl.mode) state.mode = fromUrl.mode;
    if (fromUrl.minElevDeg != null) state.minElevDeg = fromUrl.minElevDeg;
    for (const o of fromUrl.observers) addObserver(o.name, o.latDeg, o.lonDeg);
    _pendingPassTimeMs = fromUrl.passTimeMs;
    return;
  }
  const fromStorage = decodeStateBlob(
    (() => { try { return localStorage.getItem(LS_STATE_KEY); } catch (_) { return null; } })()
  );
  if (fromStorage && fromStorage.observers.length) {
    if (fromStorage.mode) state.mode = fromStorage.mode;
    if (fromStorage.minElevDeg != null) state.minElevDeg = fromStorage.minElevDeg;
    for (const o of fromStorage.observers) addObserver(o.name, o.latDeg, o.lonDeg);
    return;
  }
  addObserver("Chicago",    41.8781, -87.6298);
  addObserver("Milwaukee",  43.0389, -87.9065);
  addObserver("Cincinnati", 39.1031, -84.5120);
}

loadInitialObservers();

// Periodic cloud-forecast refresh. Pairs with the cache's 10-minute
// TTL - every 15-minute tick crosses the TTL and triggers a real
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

// Default the clock to "now", PAUSED. startTime stays at "now" so
// Reset returns here; stopTime far enough out that later real-time
// playback doesn't bump into ClockRange.CLAMPED before the user runs
// a search.
//
// Paused (not animating) during init so the sim clock can't sprint
// ahead during the 1-5s of Cesium boot + TLE fetch + first window
// search. Otherwise a slow first-load can elapse 30-50s of sim time
// before any UI appears, and on reload that looks like "the clock is
// racing and no passes loaded." Resumed at state.multiplier inside
// runSearch once the first results are rendered.
{
  const nowJd = Cesium.JulianDate.fromDate(new Date());
  viewer.clock.startTime = nowJd;
  viewer.clock.stopTime  = Cesium.JulianDate.addDays(nowJd, 7, new Cesium.JulianDate());
  viewer.clock.currentTime = nowJd;
  viewer.clock.multiplier = state.multiplier;
  viewer.clock.shouldAnimate = false;
}

const speedSelect = document.getElementById("speed-select");
const windowsListEl = document.getElementById("windows-list");

// Pane toggle - slides #panel-left off-screen, swaps the toggle's icon
// via the .panel-collapsed body class (all visual changes are CSS-driven).
document.getElementById("panel-toggle").addEventListener("click", () => {
  document.body.classList.toggle("panel-collapsed");
});

// Visual ↔ Radio mode toggle + min-elev input.
const modeToggleEl = document.getElementById("mode-toggle");
const minElevControlEl = document.getElementById("min-elev-control");
const minElevValueEl = document.getElementById("min-elev-value");
// Stepper increments by MIN_ELEV_STEP. 1° gives fine control for users
// who want to dial in around a specific elevation; click-and-hold isn't
// implemented but holding the keyboard's enter on a focused button
// repeats fine via native button behavior.
const MIN_ELEV_STEP = 1;
const MIN_ELEV_MIN = 0;
const MIN_ELEV_MAX = 60;
function reflectModeUi() {
  for (const btn of modeToggleEl.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.mode === state.mode);
  }
  // Min-elev applies in both modes: in visual it's the lowest
  // apparent altitude every observer must have the ISS above (10° is
  // a sensible naked-eye default, atmospheric extinction is severe
  // below that); in radio it's the antenna's lowest usable elevation.
  minElevControlEl.hidden = false;
  minElevValueEl.textContent = `${state.minElevDeg}°`;
  for (const btn of minElevControlEl.querySelectorAll(".min-elev-step")) {
    const step = parseInt(btn.dataset.step, 10);
    const next = state.minElevDeg + step;
    btn.disabled = next < MIN_ELEV_MIN || next > MIN_ELEV_MAX;
  }
}
reflectModeUi();
modeToggleEl.addEventListener("click", (ev) => {
  const m = ev.target?.dataset?.mode;
  if (!m || m === state.mode) return;
  state.mode = m;
  reflectModeUi();
  persistState();
  rerunSearchIfActive();
});
let _minElevDebounce = null;
minElevControlEl.addEventListener("click", (ev) => {
  const btn = ev.target.closest(".min-elev-step");
  if (!btn || btn.disabled) return;
  const step = parseInt(btn.dataset.step, 10);
  if (!Number.isFinite(step)) return;
  // Snap the new value to the nearest step multiple - handles legacy
  // state loaded from URL/storage with a non-multiple value (e.g.,
  // someone shared a "min=12°" link from before the stepper).
  const raw = state.minElevDeg + step;
  const snapped = Math.round(raw / MIN_ELEV_STEP) * MIN_ELEV_STEP;
  const clamped = Math.max(MIN_ELEV_MIN, Math.min(MIN_ELEV_MAX, snapped));
  if (clamped === state.minElevDeg) return;
  state.minElevDeg = clamped;
  reflectModeUi();
  persistState();
  // Debounce since two quick clicks in a row should only trigger one
  // search (search is the heaviest user-driven recompute we have).
  if (_minElevDebounce) clearTimeout(_minElevDebounce);
  _minElevDebounce = setTimeout(() => { rerunSearchIfActive(); }, 250);
});

// Share button - copies a URL encoding the current setup (observers +
// active pass + mode/min-elev) to the clipboard. The URL bar itself
// stays clean; the ?s=... blob only materializes here, on demand.
// Click feedback runs through CSS classes only - replacing textContent
// would wipe the inline SVG icon and shift the button's height as
// "Copied!" text is taller than the 12px icon.
const shareBtn = document.getElementById("share-btn");
const shareBtnDefaultTitle = shareBtn.title;
shareBtn.addEventListener("click", async () => {
  let ok = true;
  try {
    await navigator.clipboard.writeText(buildShareUrl());
  } catch (_) {
    ok = false;
  }
  shareBtn.classList.toggle("copied", ok);
  shareBtn.classList.toggle("failed", !ok);
  shareBtn.title = ok ? "Link copied" : "Copy failed";
  setTimeout(() => {
    shareBtn.classList.remove("copied", "failed");
    shareBtn.title = shareBtnDefaultTitle;
  }, 1500);
});

speedSelect.addEventListener("change", () => {
  state.multiplier = Number(speedSelect.value);
  viewer.clock.multiplier = state.multiplier;
});

let searchGen = 0;
let _autoSelectedFirst = false; // ensures we auto-jump to the first window once
let _firstSearchComplete = false; // gates the clock-multiplier bump

function runSearch(startMs, endMs) {
  if (!satrec) return; // wait for TLE
  if (!state.observers.length) return; // wait for observers
  // Only show the "searching…" placeholder if the list is currently empty
  // (initial load or after clearing observers). On subsequent searches the
  // old results stay visible until renderWindowsList atomically swaps in
  // the new ones - avoids a jarring blank/flash on observer add/remove.
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
    // Predicate + opts depend on mode. Visual = sunlit + twilight +
    // alt ≥ user min-elev. Radio = alt ≥ user min-elev (no
    // sun/illumination gate). Both modes use the same min-elev knob.
    const predicate = state.mode === "radio"
      ? (obs, e, d) => isRadioReachable(obs, e, d, { minIssAltDeg: state.minElevDeg })
      : (obs, e, d) => isVisibleAtAll(obs, e, d, { minIssAltDeg: state.minElevDeg });
    const t0 = performance.now();
    const wins = findVisibilityWindows(
      state.observers, satrec, predicate, sat,
      startMs, endMs, 60_000
    );
    const elapsedMs = performance.now() - t0;
    if (elapsedMs > 1500 || wins.length === 0) {
      // Surface slow searches and empty results - the most common cause
      // of "panel never populated after reload" was a search exceeding
      // the 5s page-loader safety net while finding 0 windows.
      console.info(
        `pass-finder search: ${wins.length} window(s) in ${elapsedMs.toFixed(0)}ms`,
        { observers: state.observers.length, horizonDays: state.horizonDays, mode: state.mode },
      );
    }
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
    // than pins/labels/panels popping in piecemeal. Clock stays paused:
    // jumpToWindow above already parked currentTime at the first
    // window's startMs (inside the pass so the 3D path/gradient/active
    // tracker all light up) and called shouldAnimate=false. The user
    // hits play when they're ready to watch the pass unfold.
    _firstSearchComplete = true;
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
// etc.) and runSearch never fires, drop the loader so the user isn't
// stuck on a black screen. 12s covers slow first-load searches (30-day
// horizon × multiple observers can run 3-8s on cold caches); shorter
// timeouts would dismiss while the search is still running, surfacing
// an empty "no passes" panel that fills in a few seconds later.
setTimeout(dismissPageLoader, 12000);

// Auto-search whenever observers AND TLE are available, starting "now" and
// running for state.horizonDays. Called on observer add/remove and after
// TLE load. No-op if either prerequisite is missing.
function rerunSearchIfActive() {
  // Per-observer pass cache depends on mode + minElevDeg + observer
  // set - any change that triggers a search re-run invalidates them
  // too. The next preRender will repopulate any observer currently
  // sighting ISS.
  invalidateObsPassCache();
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
  // currentTime - the user's scrubbed position (or a previously-clicked
  // window) must survive across re-searches (observer add/remove) and
  // "Find more" extensions. Reset the clock via the Reset button.
  viewer.clock.startTime = Cesium.JulianDate.fromDate(new Date(startMs));
  viewer.clock.stopTime = Cesium.JulianDate.fromDate(new Date(endMs));
  viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED;
  viewer.clock.multiplier = state.multiplier;
}

function renderWindowsList() {
  windowsListEl.replaceChildren();
  // Mode-aware column count + labels. Visual keeps the full 7-column
  // layout; radio swaps in two link-quality columns and drops the
  // three columns that don't apply (Sun, Mag, Clouds = all "sky
  // capture" factors that radio doesn't care about).
  // Radio "Dur" column already IS "time above min-elev" (the filter
  // guarantees every observer above the threshold for the whole window),
  // so we don't show a redundant t>N° column. Radio = 4 columns.
  const headerLabels = state.mode === "radio"
    ? ["P%", "Time (UTC)", "Dur", "Peak El."]
    : ["P%", "Time (UTC)", "Dur", "Alt", "Mag", "Sun", "Clouds"];
  windowsListEl.style.gridTemplateColumns = headerLabels.map(() => "auto").join(" ");
  const hdr = document.createElement("div");
  hdr.className = "window-row header";
  for (const label of headerLabels) {
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
    const cloud = cloudRange(peakMs); // { min, max } or null - display only
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

    // Rating column - joint capture-probability digits (no % sign, saves
    // width), colored continuously on the same gradient the orbit
    // overlay uses.
    const r = document.createElement("span");
    r.className = "rating";
    r.textContent = `${Math.round(passP * 100)}`;
    r.style.color = ratingCssColor(passP);
    r.title = ratingTooltip;
    row.appendChild(r);

    // Time column (UTC, peak/best moment) - left intentionally uncolored
    // so the colored columns (rating, sun, dur, alt, mag, clouds) carry
    // the visual signal and the date/time reads as neutral context.
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = new Date(peakMs).toISOString().slice(5, 19).replace("T", " ");
    row.appendChild(time);

    // Duration column - color formula depends on mode. Visual uses
    // coordinationFactor (sigmoid centered ~60s, matching capture-
    // setup time); Radio uses radioDurationFactor (centered ~120s,
    // matching the "time to make a QSO / measure Doppler" threshold).
    const dur = document.createElement("span");
    dur.className = "dur";
    const mm = Math.floor(durSec / 60), ss = durSec % 60;
    dur.textContent = `${mm}m${ss < 10 ? "0" : ""}${ss}s`;
    const durQuality = state.mode === "radio"
      ? radioDurationFactor(durSec)
      : coordinationFactor(durSec);
    dur.style.color = ratingCssColor(durQuality);
    row.appendChild(dur);

    if (state.mode === "radio") {
      // Peak elevation - worst observer's maximum elevation across the
      // window. Limits the joint link quality (signal at the worst
      // station is what bounds coordinated radio work). Colored on the
      // same peakElevFactor that drives the rating math.
      let worstPeakElev = Infinity;
      const STEP_MS = Math.max(1_000, Math.min(5_000, (w.endMs - w.startMs) / 30));
      for (const obs of state.observers) {
        let peak = -Infinity;
        for (let t = w.startMs; t <= w.endMs; t += STEP_MS) {
          const e = issEcefAt(new Date(t));
          if (!e) continue;
          const a = apparentAltDeg(issAltitudeDeg(obs, e));
          if (a > peak) peak = a;
        }
        if (peak < worstPeakElev) worstPeakElev = peak;
      }
      const pk = document.createElement("span");
      pk.className = "alt";
      if (Number.isFinite(worstPeakElev)) {
        pk.textContent = `${Math.round(worstPeakElev)}°`;
        pk.style.color = ratingCssColor(peakElevFactor(worstPeakElev));
      } else {
        pk.textContent = "-";
        pk.classList.add("na");
      }
      row.appendChild(pk);

      // Wire row click + skip the visual columns
      row.addEventListener("click", () => jumpToWindow(i));
      windowsListEl.appendChild(row);
      return;
    }

    // Altitude range - value is min-max alt across observers at peak.
    // Color is the PRODUCT of altitudeFactor across observers (matches
    // the joint model's treatment of altitude as the genuinely-
    // independent factor that legitimately compounds). Single observer:
    // product = single factor. Multi-observer: each weaker observer
    // multiplicatively pulls the color toward red.
    const alt = document.createElement("span");
    alt.className = "alt";
    const altLo = Math.round(minAlt), altHi = Math.round(maxAlt);
    alt.textContent = altLo === altHi ? `${altHi}°` : `${altLo}-${altHi}°`;
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

    // Peak magnitude - colored on the same gradient: mag = -3 → green
    // (brilliant), 0 → yellow, +1 → red (very faint).
    const mag = document.createElement("span");
    mag.className = "mag";
    const peakMag = peakMagnitudeInWindow(w, state.observers);
    if (peakMag == null) {
      mag.textContent = "-";
      mag.classList.add("na");
    } else {
      mag.textContent = peakMag.toFixed(1);
      mag.style.color = ratingCssColor(Math.max(0, Math.min(1, (-peakMag + 1) / 4)));
    }
    row.appendChild(mag);

    // Sun-altitude column - worst (highest = brightest) observer at
    // the peak moment, refraction-corrected. Color is the literal
    // twilight factor used in the rating math: twilightFactor(sunAlt).
    // Positioned after Mag so the table reads left→right as
    // pass geometry (alt, mag) then external viewing conditions
    // (sun, clouds).
    const peakDate = new Date(peakMs);
    let worstSunAlt = -Infinity;
    for (const obs of state.observers) {
      const sa = apparentAltDeg(sunAltitudeDeg(obs, peakDate));
      if (sa > worstSunAlt) worstSunAlt = sa;
    }
    const sun = document.createElement("span");
    sun.className = "sun";
    sun.textContent = Number.isFinite(worstSunAlt) ? `${Math.round(worstSunAlt)}°` : "-";
    if (Number.isFinite(worstSunAlt)) {
      sun.style.color = ratingCssColor(twilightFactor(worstSunAlt));
    } else {
      sun.classList.add("na");
    }
    row.appendChild(sun);

    // Cloud cover range - gradient color indexed by P(clear), DESAT'd
    // toward gray as the forecast horizon stretches out. Uses the same
    // exp(-age/4) skill curve effectivePClear uses inside the rating
    // math: a clouds value 8+ days out displays mostly gray, signaling
    // "this number isn't trustworthy enough to color." 0 days → vivid.
    const cl = document.createElement("span");
    cl.className = "cloud";
    if (cloud === null) {
      cl.textContent = "-";
      cl.classList.add("na");
    } else {
      const clLo = Math.round(cloud.min), clHi = Math.round(cloud.max);
      cl.textContent = clLo === clHi ? `${clHi}%` : `${clLo}-${clHi}%`;
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
// Uses longitude/15 as the local-time offset - close enough for "people are
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

// Index of the window whose [startMs, endMs] contains `ms`, or -1.
// Small tolerance on each edge - clicking a pass parks the clock at
// the window's startMs via JulianDate.fromDate→toDate, which can
// introduce sub-millisecond float drift. Without tolerance, the
// roundtripped ms can land at startMs - 0.0001 and the auto-tracker
// would override the click and deactivate the pass.
const WINDOW_EDGE_TOLERANCE_MS = 100;
function windowIdxAtMs(ms) {
  if (!state.windows) return -1;
  for (let i = 0; i < state.windows.length; i++) {
    const w = state.windows[i];
    if (ms >= w.startMs - WINDOW_EDGE_TOLERANCE_MS &&
        ms <= w.endMs + WINDOW_EDGE_TOLERANCE_MS) return i;
  }
  return -1;
}

// Apply an activeWindowIdx change driven by the clock (not a user
// click). Updates everything jumpToWindow does EXCEPT the
// disruptive actions: clock isn't set (clock IS the cause here),
// camera doesn't refit, panel doesn't collapse, no persistState
// write (auto-tracking isn't user intent). When idx is -1 the
// active pass gradient is cleared too.
function setActiveWindowSoft(i) {
  // Class always reflects current activeWindowIdx, even when the
  // auto-tracker would otherwise no-op - catches stale state from
  // outside callers that reset activeWindowIdx directly (reset
  // button, window-list rebuild, etc.).
  document.body.classList.toggle("has-active-pass", i >= 0);
  if (i === state.activeWindowIdx) return;
  state.activeWindowIdx = i;
  renderWindowsList();
  if (i >= 0) {
    invalidateOrbitCache();
    renderActivePassGradient(state.windows[i]);
    refreshAllPolarPlotArcs();
  } else {
    clearActivePassGradient();
  }
}

// Per-frame: if the clock has crossed into or out of a pass, soft-
// update the active window. Runs cheaply (linear scan over windows,
// no-op when idx is unchanged) and is debounced naturally by the
// idx-equality guard inside setActiveWindowSoft.
function autoTrackActiveWindow() {
  const ms = Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime();
  setActiveWindowSoft(windowIdxAtMs(ms));
}

function jumpToWindow(i) {
  state.activeWindowIdx = i;
  document.body.classList.toggle("has-active-pass", i >= 0);
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
// itself is declared higher up in the file - it's read during initial
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
// the current sim time. Arc is static for the active window - only the
// dot moves frame-to-frame.
viewer.scene.preRender.addEventListener(autoTrackActiveWindow);

// Per-observer "sighting now" tracker. Toggles the polar-plot icons
// (obs-list + 3D-scene) per observer based on observerSeesIss at the
// current clock time. On the invisible→visible transition, computes
// the observer's full pass window and refreshes their arc - so a
// station that catches the ISS rising before others have their plot
// already populated with the right path.
viewer.scene.preRender.addEventListener(() => {
  const d = Cesium.JulianDate.toDate(viewer.clock.currentTime);
  const ms = d.getTime();
  const issEcef = issEcefAt(d);
  for (const obs of state.observers) {
    const visible = !!(issEcef && observerSeesIss(obs, issEcef, d));
    const cached = _obsCurrentPass.get(obs.id);
    if (visible) {
      // Reanchor when the cache is empty OR the clock has crossed
      // outside the cached pass (e.g., scrubbed into a new pass).
      const stale = !cached || ms < cached.startMs || ms > cached.endMs;
      if (stale) {
        const win = passWindowAtMsForObserver(obs, ms);
        if (win) {
          _obsCurrentPass.set(obs.id, win);
          for (const svg of obsListEl.querySelectorAll(`.polar-plot[data-obs-id="${obs.id}"]`)) {
            updatePolarPlotArc(svg, obs);
            updatePolarPlotEvents(svg, obs);
          }
          for (const wrapper of iconLayerEl.querySelectorAll(`.observer-label[data-obs-id="${obs.id}"]`)) {
            updateObserverIconArc(wrapper, obs);
          }
        }
      }
    } else if (cached) {
      _obsCurrentPass.delete(obs.id);
    }
    // Sky-shade horizon fill + matching arc stroke for both icon
    // placements. Computed every frame so the disc and arc track the
    // sun as the clock advances. Arc samples are cached per-pass (see
    // getCachedArcSamples) so the per-frame work is just a DOM rebuild
    // with the new stroke color - no SGP4 re-propagation.
    const sunAltDeg = apparentAltDeg(sunAltitudeDeg(obs, d));
    // Display toggle - same per-observer flag drives both placements.
    for (const svg of obsListEl.querySelectorAll(`.polar-plot[data-obs-id="${obs.id}"]`)) {
      svg.style.display = visible ? "" : "none";
      updatePolarPlotHorizon(svg, sunAltDeg);
      if (visible) {
        updatePolarPlotArc(svg, obs, sunAltDeg);
        updatePolarPlotBodies(svg, obs, d);
      }
    }
    for (const wrapper of iconLayerEl.querySelectorAll(`.observer-label[data-obs-id="${obs.id}"]`)) {
      const icon = wrapper.querySelector(".observer-label-icon");
      if (icon) {
        icon.style.display = visible ? "" : "none";
        updatePolarPlotHorizon(icon, sunAltDeg);
        if (visible) updateObserverIconArc(wrapper, obs, sunAltDeg);
      }
      // .inactive disables hover cursor / click animation / pointer
      // events so the 3D-scene info box stops being clickable when
      // its polar plot icon is hidden (there's nothing to open).
      wrapper.classList.toggle("inactive", !visible);
    }
  }
});

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
    // Skip labels whose anchor is off-screen - they'd just sit
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
  // The fullscreen modal is a PNG snapshot taken when it opens - no
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
  // Tell the shared frameAll how much of the canvas is covered by the
  // left panel so it can fit the bounding sphere into the visible
  // (un-occluded) area rather than the full canvas. Bottom-controls
  // strip is ~50px tall - reserve a little vertical room too.
  getFrameViewportInset: () => {
    const panel = document.getElementById("panel-left");
    const leftPx = (panel && !document.body.classList.contains("panel-collapsed"))
      ? Math.ceil(panel.getBoundingClientRect().right + 8)
      : 0;
    return { left: leftPx, right: 0, top: 0, bottom: 60 };
  },
  getOrbitAnchor: () => {
    if (!state.observers.length) return Cesium.Cartesian3.fromDegrees(0, 0, 0);
    const avgLat = state.observers.reduce((s, o) => s + o.latDeg, 0) / state.observers.length;
    const avgLon = state.observers.reduce((s, o) => s + o.lonDeg, 0) / state.observers.length;
    return Cesium.Cartesian3.fromDegrees(avgLon, avgLat, 0);
  },
  // Match the triangulation page: position camera perpendicular to the
  // dominant horizontal line in the scene (observers' ground centroid →
  // ISS ground subpoint at the current clock time), and pick whichever
  // perpendicular sits closer to south-looking so the map reads north-up.
  getFrameHeadingPitch: () => {
    if (!state.observers.length) return { headingDeg: 180, pitchDeg: -30 };
    const avgLat = state.observers.reduce((s, o) => s + o.latDeg, 0) / state.observers.length;
    const avgLon = state.observers.reduce((s, o) => s + o.lonDeg, 0) / state.observers.length;
    const issEcef = issEcefAt(Cesium.JulianDate.toDate(viewer.clock.currentTime));
    let baselineDeg = 90;
    if (issEcef) {
      const issCart = Cesium.Cartographic.fromCartesian(
        Cesium.Cartesian3.fromElements(issEcef[0], issEcef[1], issEcef[2]));
      const dLat = Cesium.Math.toDegrees(issCart.latitude) - avgLat;
      const dLon = (Cesium.Math.toDegrees(issCart.longitude) - avgLon)
        * Math.cos(avgLat * Math.PI / 180);
      baselineDeg = Math.atan2(dLon, dLat) * 180 / Math.PI;
    }
    const norm = (a) => ((a % 360) + 360) % 360;
    const cand1 = norm(baselineDeg + 90);
    const cand2 = norm(baselineDeg - 90);
    const distToSouth = (h) => Math.min(Math.abs(h - 180), 360 - Math.abs(h - 180));
    const headingDeg = distToSouth(cand1) <= distToSouth(cand2) ? cand1 : cand2;
    return { headingDeg, pitchDeg: -25 };
  },
  getFramePositions: () => {
    const ps = state.observers.map(o =>
      Cesium.Cartesian3.fromDegrees(o.lonDeg, o.latDeg, 0));
    const issEcef = issEcefAt(Cesium.JulianDate.toDate(viewer.clock.currentTime));
    if (issEcef) ps.push(Cesium.Cartesian3.fromElements(issEcef[0], issEcef[1], issEcef[2]));
    // When a pass is selected, sample positions along its visibility
    // window so the frame includes the full colored arc - not just the
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
