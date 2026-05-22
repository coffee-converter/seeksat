// lib/pass-finder-scene.js — Cesium scene for the pass-finder page.
// Receives a viewer already created by useCesiumViewer (called from
// PassFinderApp). Same hook-composition pattern as the triangulate
// page, just with a much larger imperative island inside.

import { geodeticToEcef } from "./coords.js";
import { trueNow } from "./pass-finder/clock-sync.js";
import { isVisibleAtAll, isRadioReachable, issAltitudeDeg, issAltAzDeg, issIlluminated, sunAltitudeDeg } from "./pass-finder/visibility.js";
import { sunPositionEcef } from "./pass-finder/sun.js";
import { findVisibilityWindows } from "./pass-finder/search.js";
import { tleOrbitTrackEcef } from "./truth.js";
import { fetchCloudForecast, cloudAt } from "./pass-finder/weather.js";
import { fetchTimezone } from "./pass-finder/timezone.js";
import { planetPositionEcef, PLANET_STYLE, PLANET_NAMES } from "./pass-finder/planets.js";
import { apparentAltDeg } from "./refraction.js";
import {
  ratingCssColor, ratingCssColorWithSkill, ratingColorAtCesium,
  twilightFactor, altitudeFactor, coordinationFactor,
  peakElevFactor, radioDurationFactor, magnitudeAt,
} from "./pass-finder/ratings.js";
import {
  encodeStateBlob, decodeStateBlob,
  readPersistedBlob, writePersistedBlob,
} from "./pass-finder/state-blob.js";
import {
  SVG_NS, altAzToSvg, skyShadeRgb, skyShadeForSunAlt,
  chartPalette, naturalSkyLimMag, starAltAzForObs,
} from "./pass-finder/sky-helpers.js";
import {
  computeArcSamples as _computeArcSamplesPure,
  renderArcSegments, moonLitPath,
} from "./pass-finder/polar-arc.js";
import {
  BRIGHT_STARS, MORE_STARS, FAINT_STARS, DIM_STARS, SPECTRAL_COLOR,
  STAR_FAR_M, starDotColor, starDotRadius, starDotOpacity,
  starDirectionEcef,
} from "./pass-finder/star-catalog.js";
import {
  CONSTELLATION_LINES,
  paintPolarModalConstellations as _paintConstellationsPure,
} from "./pass-finder/constellations.js";
import { paintPolarModalStars as _paintModalStarsPure } from "./pass-finder/polar-stars.js";
import {
  paintIconEvents as _paintIconEventsPure,
  paintIconSunMoon as _paintIconSunMoonPure,
  ICON_EVENT_COLORS,
} from "./pass-finder/polar-icon.js";
import {
  pathTangentSvg as _pathTangentSvgPure,
  passPeakMs as _passPeakMsPure,
  paintPolarModalEvents as _paintModalEventsPure,
} from "./pass-finder/polar-events.js";
import {
  MODAL_SVG_STYLE,
  paintPolarModalStatic as _paintModalStaticPure,
} from "./pass-finder/polar-modal-frame.js";
import {
  appendPlanetGlyph, appendBodyGlyph,
  paintPolarModalSunMoon as _paintModalSunMoonPure,
  paintPolarModalLegend as _paintModalLegendPure,
} from "./pass-finder/polar-bodies.js";
import {
  captureProbJoint as _captureProbJointPure,
  passSuccessProbability as _passSuccessProbabilityPure,
  radioPassSuccessProbability as _radioPassSuccessProbabilityPure,
  radioCaptureAt,
  peakMagnitudeInWindow as _peakMagnitudeInWindowPure,
} from "./pass-finder/scoring.js";
import {
  svgToPngBlob,
  polarModalFileNameFor as _polarModalFileNameForPure,
} from "./pass-finder/polar-png.js";
import {
  cloudRange as _cloudRangePure,
  bestMomentMs as _bestMomentMsPure,
} from "./pass-finder/window-scoring.js";
import {
  observerSeesIss as _observerSeesIssPure,
  passWindowAtMsForObserver as _passWindowAtMsForObserverPure,
} from "./pass-finder/observer-pass.js";
import * as sat from "satellite.js";
import { wireCameraControls } from "./camera-controls.js";
import { usePassFinderStore } from "./pass-finder-store";
import { setSceneBridge, clearSceneBridge } from "./scene-bridge";

const Cesium = typeof window !== "undefined" ? window.Cesium : undefined;

export function initPassFinderScene(viewer) {
window.__viewer = viewer; // dev-console inspection

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

// (Predicate body + the backward/forward walk in
// passWindowAtMsForObserver live in pass-finder/observer-pass.js;
// the wrappers below bind state.mode + state.minElevDeg, and
// passWindowAtMsForObserver additionally binds issEcefAt.)
function observerSeesIss(obs, issEcef, jsDate) {
  return _observerSeesIssPure(obs, issEcef, jsDate, state.mode, state.minElevDeg);
}

// Per-observer pass cache. Each observer's polar plot lights up
// independently of the joint window — when that observer can see ISS
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

function passWindowAtMsForObserver(obs, anchorMs) {
  return _passWindowAtMsForObserverPure(obs, anchorMs, state.mode, state.minElevDeg, issEcefAt);
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
  syncObserversToStore();
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
    if (tz) {
      obs.tz = tz;
      syncObserversToStore();
    }
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
  syncObserversToStore();
  persistState();
  rerunSearchIfActive();
}

// SVG sky-chart polar plot — center = zenith, edge = horizon. SVG_NS
// + altAzToSvg + sky-shade + chart-palette + limiting-magnitude
// helpers live in lib/pass-finder/sky-helpers.js. The painters here
// add the imperative scene-state plumbing on top.
//
// (buildPolarPlot moved to components/passes/PolarPlot.tsx — React
//  renders the static skeleton. The scene paints into it via the
//  typed scene bridge's paintPolarPlot.)

// Cache per-pass arc samples on the arc element itself. Sample
// positions + dashed/alpha flags depend only on the pass window and
// observer (computed at sample TIMES inside the pass), not on the
// current clock — so they're constant for the duration of a pass.
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
  // Per-observer pass window — the observer's full sweep when they're
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
  // of N renders as N user units of nothing — so we want gap > stroke
  // to make the dashed treatment visually distinct from the solid.
  renderArcSegments(arc, samples, stroke, "4 6");
}

// Paint the horizon disc to match the sky color at the observer's
// current sun altitude — bright blue in daylight, deep navy after
// astronomical twilight. Mirrors the inline `horizon.style.fill = ...`
// trick used by the fullscreen modal (paintPolarModalStatic).
function updatePolarPlotHorizon(svg, sunAltDeg) {
  if (sunAltDeg == null) return;
  const horizon = svg.querySelector(".horizon");
  if (!horizon) return;
  horizon.style.fill = skyShadeForSunAlt(sunAltDeg);
}

// (paintIconEvents + paintIconSunMoon + ICON_EVENT_COLORS live in
// pass-finder/polar-icon.js. The scene threads issEcefAt + a peakMs
// computed via bestMomentMs into the event painter so the module
// stays satrec-free.)
function updatePolarPlotEvents(svg, obs) {
  const events = svg.querySelector(".events");
  if (!events) return;
  const win = _obsCurrentPass.get(obs.id);
  const peakMs = win ? bestMomentMs(win) : null;
  _paintIconEventsPure(events, obs, win, peakMs, 50, 50, 45, 2.8, issEcefAt);
}

function updatePolarPlotBodies(svg, obs, jsDate) {
  const bodies = svg.querySelector(".bodies");
  if (!bodies) return;
  _paintIconSunMoonPure(bodies, obs, jsDate, 50, 50, 45, 2.4);
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
      usePassFinderStore.getState().setPolarModalObsId(obs.id);
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
  // eye stretches — identical rendering to the fullscreen modal so
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
  // Dash + gap sized to the 8 stroke-width — gap > stroke ensures the
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
  if (id) usePassFinderStore.getState().setPolarModalObsId(id);
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

// skyShadeRgb / skyShadeForSunAlt / chartPalette / naturalSkyLimMag /
// starAltAzForObs live in lib/pass-finder/sky-helpers.js (shared with
// the per-card polar plot painters above).

// (Polar-modal DOM is owned by components/passes/PolarModal.tsx now;
//  the React component holds the svg / img / link refs and calls
//  into renderPolarModal / copyPolarPng from the typed scene bridge,
//  which routes to the bridge* implementations below.)


// MODAL_SVG_STYLE + paintPolarModalStatic now live in
// pass-finder/polar-modal-frame.js. Thin wrapper threads MODAL_GEOM
// + a tzRefMs derived from the active window (so the displayed
// UTC-offset reflects DST at the pass moment, not at the modal
// open instant).
function paintPolarModalStatic(svg, obs, anchorMs, sunAltDeg) {
  const anchor = anchorMs ?? Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime();
  const tzRefMs = state.windows?.[state.activeWindowIdx]?.startMs ?? anchor;
  return _paintModalStaticPure(svg, obs, anchor, sunAltDeg, {
    modalGeom: MODAL_GEOM,
    tzRefMs,
  });
}

// Polar-modal arc paints in a neutral gray rather than the observer's
// color — in this view the arc represents the ISS path, not the
// observer, so the observer color was easy to misread as "the
// observer's arc is colored". The Start/Peak/End markers (green/gold/
// red) and the obs-card icon (still observer-color) remain the
// color-coded affordances.
const POLAR_ARC_COLOR = "#aab8d4";
// Arc-segment opacity. Whenever a segment is plausibly visible to the
// naked eye at that instant — sun deep enough below the horizon, ISS
// out of Earth's shadow, ISS brighter than the sky-glow limit — its
// alpha tracks the ISS's apparent magnitude (bright segments solid,
// dim ones translucent). Segments that wouldn't be naked-eye visible
// fall back to the uniform radio opacity. Applies in BOTH modes; in
// visual mode the search predicate already guarantees the visibility
// gate holds for every sample, so the magnitude curve covers the
// whole arc — but a daytime radio pass arc still gets a brightness
// gradient where the sun briefly dips below twilight, etc.
// (issAlphaForMag / arcSampleStyle / renderArcSegments + ARC_*
//  constants live in lib/pass-finder/polar-arc.js. computeArcSamples
//  is a thin wrapper that hands the pure version our scene-local
//  issEcefAt callback so the module stays satrec-free.)
function computeArcSamples(obs, win, cx, cy, R, SAMPLES) {
  return _computeArcSamplesPure(obs, win, cx, cy, R, SAMPLES, issEcefAt);
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

// (STAR_LABEL_MIN_DIST + paintPolarModalStars live in
// pass-finder/polar-stars.js. moonLitPath lives in pass-finder/
// polar-arc.js.)

// paintPolarModalSunMoon + paintPolarModalLegend + the
// appendPlanetGlyph / appendBodyGlyph primitives live in
// pass-finder/polar-bodies.js. Thin wrappers thread MODAL_GEOM in.
function paintPolarModalSunMoon(svg, obs, jsDate, limMag) {
  return _paintModalSunMoonPure(svg, obs, jsDate, limMag, MODAL_GEOM);
}
function paintPolarModalLegend(svg, obs, jsDate, limMag) {
  return _paintModalLegendPure(svg, obs, jsDate, limMag, MODAL_GEOM);
}

// CONSTELLATION_LINES + the pure paint function live in
// pass-finder/constellations.js. The wrapper threads MODAL_GEOM in
// so the pure function stays scene-free.
function paintPolarModalConstellations(svg, obs, jsDate, sunAltDeg) {
  return _paintConstellationsPure(svg, obs, jsDate, sunAltDeg, MODAL_GEOM);
}

function paintPolarModalStars(svg, obs, jsDate, limMag) {
  return _paintModalStarsPure(svg, obs, jsDate, limMag, MODAL_GEOM);
}

// EVENT_STYLE/COLS/ROW_Y constants, diamond helpers, pathTangentSvg,
// passPeakMs, and paintPolarModalEvents now live in pass-finder/
// polar-events.js. Thin scene wrappers below bind MODAL_GEOM +
// issEcefAt + POLAR_ARC_COLOR for callers that still expect the
// scene-local signatures.
function pathTangentSvg(obs, ms) {
  return _pathTangentSvgPure(obs, ms, MODAL_GEOM, issEcefAt);
}
function passPeakMs(w, obs) {
  return _passPeakMsPure(w, obs, issEcefAt);
}
function paintPolarModalEvents(svg, obs, peakMs, win) {
  const w = win ?? state.windows?.[state.activeWindowIdx];
  return _paintModalEventsPure(svg, obs, peakMs, w, {
    modalGeom: MODAL_GEOM,
    issEcefAtFn: issEcefAt,
    polarArcColor: POLAR_ARC_COLOR,
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
// Polar modal lifecycle (open/close, Escape, backdrop, save/copy
// buttons) lives in components/passes/PolarModal.tsx; React owns the
// DOM and store.polarModalObsId. We expose the imperative paint +
// PNG-rasterize helpers via the typed scene bridge so React can call
// them with the modal's own SVG / img / link refs.

async function renderPolarModalInto(svgEl, obs) {
  // Modal uses the OBSERVER's full pass (extended from the joint
  // window outward until this station can't see ISS) — that's the
  // user's actual horizon-to-horizon view regardless of when other
  // observers join in. Resolution order: joint window → per-observer
  // cache → fresh expansion at clock time → null (renders no arc).
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
  // Sky backdrop is anchored at the pass PEAK time, not the playback
  // clock — opening the modal for a pass three hours away would
  // otherwise show today's sky behind a chart annotated with that
  // distant pass's timestamp.
  const peakMsTop = obsWin ? passPeakMs(obsWin, obs) : Date.now();
  const sunAltAtPeak = sunAltitudeDeg(obs, new Date(peakMsTop));
  const limMag = naturalSkyLimMag(sunAltAtPeak);
  paintPolarModalStatic(svgEl, obs, peakMsTop, sunAltAtPeak);
  paintPolarModalArc(svgEl, obs, obsWin);
  const jsDate = new Date(peakMsTop);
  paintPolarModalEvents(svgEl, obs, peakMsTop, obsWin);
  paintPolarModalConstellations(svgEl, obs, jsDate, sunAltAtPeak);
  paintPolarModalStars(svgEl, obs, jsDate, limMag);
  paintPolarModalSunMoon(svgEl, obs, jsDate, limMag);
  paintPolarModalLegend(svgEl, obs, jsDate, limMag);
}

async function bridgeRenderPolarModal(svgEl, obsId) {
  if (!svgEl) return null;
  const obs = state.observers.find(o => o.id === obsId);
  if (!obs) return null;
  await renderPolarModalInto(svgEl, obs);
  const blob = await svgToPngBlob(svgEl);
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, filename: polarModalFileNameFor(obs) };
}

async function bridgeCopyPolarPng(svgEl) {
  if (!svgEl) throw new Error("svg ref missing");
  const blob = await svgToPngBlob(svgEl);
  if (!navigator.clipboard?.write) throw new Error("Clipboard API unavailable");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

// svgToPngBlob + polarModalFileNameFor now live in
// pass-finder/polar-png.js. svgToPngBlob is re-exported as the
// fully-pure helper; the filename helper gets a thin scene wrapper
// that resolves the anchor moment from the active window (so the
// filename describes the pass, not when Save was clicked).
function polarModalFileNameFor(obs) {
  const w = state.windows?.[state.activeWindowIdx];
  const ms = w?.startMs ?? Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime();
  return _polarModalFileNameForPure(obs, ms);
}

// PNG export (Save) is handled in PolarModal.tsx by clicking the
// hidden <a download> wrapping the img. Clipboard copy is delegated
// to copyPolarPng from the scene bridge, which rasterizes the same SVG.

// Observer cards (header + buttons + polar-plot SVG skeleton) are
// React-rendered by components/passes/ObserverCard.tsx +
// components/passes/PolarPlot.tsx. The skeleton ships with empty
// .bodies / .arc / .events groups + an .iss-dot placeholder; the
// scene's painters below fill them via the SVG ref. We also handle
// card-level CustomEvents (remove, fps-toggle) here.
//
// renderObsList is kept for compatibility with a few legacy callers
// (search rerun, FPS toggle); it just refreshes the 3D-scene icons
// + polar arcs since React handles the card chrome.
function renderObsList() {
  renderObserverIcons();
}

function syncObserversToStore() {
  // Push a fresh array so Zustand's referential-equality check fires.
  usePassFinderStore.getState().setObservers([...state.observers]);
  // 3D-scene icon overlay is also keyed off state.observers — keep it
  // in sync any time the observer set changes.
  renderObserverIcons();
}

// Paint the dynamic groups inside a React-mounted polar-plot SVG.
// React owns the skeleton (horizon / rings / cardinals / empty
// groups); we fill .arc, .events, .bodies, and the .iss-dot dot.
function bridgePaintPolarPlot(svgEl, obsId) {
  if (!svgEl) return;
  const obs = state.observers.find(o => o.id === obsId);
  if (!obs) return;
  updatePolarPlotArc(svgEl, obs);
  updatePolarPlotEvents(svgEl, obs);
}

// AddObserverForm + ObserverCard call scene-bridge functions directly
// (addObserver / removeObserver / toggleFps) instead of dispatching
// CustomEvents — the bridge registration at the bottom of init wires
// each one to the internal scene fn. Click-place is a store slice
// that we mirror into state.clickToPlace for the canvas handler below.

const _unsubClickToPlace = usePassFinderStore.subscribe((s, prev) => {
  if (s.clickToPlace !== prev.clickToPlace) {
    state.clickToPlace = s.clickToPlace;
  }
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

// TLE form (fetch on load, editable textareas, Refetch button)
// migrated to components/passes/TlePanel.tsx. Bootstrap just mirrors
// store.tle into state.tle for the rest of the scene that still
// reads it; satrec refresh + cache invalidation are wired below in
// the existing tle-change subscription block.

state.tle = null;

function readTleFromStore() {
  const t = usePassFinderStore.getState().tle;
  const line1 = t.line1.trim();
  const line2 = t.line2.trim();
  if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) return null;
  return { name: t.name.trim(), line1, line2 };
}
state.tle = readTleFromStore();

// (No bootstrap-side loadTle anymore — components/passes/TlePanel.tsx
//  owns the fetch; we react to its store writes via the subscription
//  below.)

// ---------------------------------------------------------------------------
// Task 10: ISS entity + clock-driven position (CallbackProperty)
// ---------------------------------------------------------------------------

let issEntity = null;
let orbitEntity = null;
let satrec = null;

function refreshSatrec() {
  const t = readTleFromStore();
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
      // Two layers of dimming on the ISS dot:
      //  - sunlit vs Earth-shadow: white when sunlit, slate-blue when
      //    in Earth's shadow (not naked-eye visible anywhere on the
      //    planet at that instant)
      //  - in-front vs behind Earth from the camera: full alpha when
      //    in front, 33% alpha when occluded so the dot "shows through"
      //    the globe like an X-ray. depthTest stays disabled so the
      //    point renders at every pixel; the callback controls
      //    visibility purely via alpha.
      color: new Cesium.CallbackProperty((time) => {
        const d = Cesium.JulianDate.toDate(time);
        const p = issEcefAt(d);
        if (!p) return Cesium.Color.WHITE;
        const base = issIlluminated(p, sunPositionEcef(d))
          ? Cesium.Color.WHITE
          : Cesium.Color.fromCssColorString("#5a6678");
        const inFront = isInFrontOfEarth(
          Cesium.Cartesian3.fromElements(p[0], p[1], p[2]),
        );
        return inFront ? base : base.withAlpha(0.33);
      }, false),
      outlineColor: new Cesium.CallbackProperty((time) => {
        const d = Cesium.JulianDate.toDate(time);
        const p = issEcefAt(d);
        const baseOutline = Cesium.Color.fromCssColorString("#7eb8ff");
        if (!p) return baseOutline;
        const inFront = isInFrontOfEarth(
          Cesium.Cartesian3.fromElements(p[0], p[1], p[2]),
        );
        return inFront ? baseOutline : baseOutline.withAlpha(0.33);
      }, false),
      outlineWidth: 3,
      // Always render on top of geometry; the in-front/behind
      // distinction is encoded in the color alpha above.
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
  const t = readTleFromStore();
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
      // depthFailMaterial is drawn for the segments of the polyline
      // that fail the depth test (i.e., are behind Earth). Bumped to
      // ~75% of the in-front alpha so it's clearly visible against
      // the dark night-side hemisphere; lower values disappear into
      // the globe at typical zoom levels.
      depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString("#cfe0ff").withAlpha(0.33),
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
      // X-ray through Earth: orbit segments occluded by the globe
      // still render at 33% alpha so the full ring is visible at
      // all times. (Earlier 0.15 was too dim against the dark
      // night-side hemisphere — the line disappeared in practice.)
      depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString("#7eb8ff").withAlpha(0.33),
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
// Catalogs (BRIGHT_STARS, MORE_STARS, FAINT_STARS, DIM_STARS), the
// SPECTRAL_COLOR table, starDotColor / starDotRadius / starDotOpacity,
// STAR_FAR_M, and starDirectionEcef now live in pass-finder/star-
// catalog.js (imported at the top of this file).

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
      // with the same label spacing — a few pixels of gap above the
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
// bright-star labels — keeps each planet stuck at its real direction
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
    // Name label sits ABOVE the planet dot — bottom-anchored at the
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
// Rendered as N short polyline entities (one per sample segment) — each
// gets a single solid material color, so the segments together form a
// smooth gradient line along the ISS path.
// ---------------------------------------------------------------------------

const PASS_GRADIENT_SAMPLES = 60;
let activePassEntities = [];

// (Rating gradient + per-factor probability math lives in
//  lib/pass-finder/ratings.js. ratingColorAt below is the tiny
//  Cesium-flavored wrapper that the orbit-gradient overlay uses.)
function ratingColorAt(score) {
  return ratingColorAtCesium(score, Cesium);
}

// captureProbJoint / passSuccessProbability /
// radioPassSuccessProbability / radioCaptureAt /
// peakMagnitudeInWindow now live in pass-finder/scoring.js as
// pure functions taking explicit deps. Thin scene wrappers below
// bind state.mode, state.minElevDeg, issEcefAt, and a
// cloudForecastForObs(obsId) lookup. radioCaptureAt is imported
// directly since it has no state coupling.
function captureProbJoint(observers, issEcef, jsDate, ms, nowMs) {
  return _captureProbJointPure(observers, issEcef, jsDate, ms, nowMs,
    (id) => state.cloudForecasts.get(id));
}
function passSuccessProbability(win, observers) {
  return _passSuccessProbabilityPure(win, observers, {
    mode: state.mode,
    minElevDeg: state.minElevDeg,
    issEcefAtFn: issEcefAt,
    cloudForecastForObs: (id) => state.cloudForecasts.get(id),
  });
}
function radioPassSuccessProbability(win, observers, minElevDeg) {
  return _radioPassSuccessProbabilityPure(win, observers, minElevDeg, issEcefAt);
}
function peakMagnitudeInWindow(win, observers) {
  return _peakMagnitudeInWindowPure(win, observers, issEcefAt);
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
  // midpoint quality. Solid color material (not glow — glow's white core
  // washes the color out) keeps the gradient vivid against the dashed
  // full-orbit guide underneath.
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    const segQ = (a.quality + b.quality) / 2;
    const segColor = ratingColorAt(segQ);
    const ent = viewer.entities.add({
      polyline: {
        positions: [a.pos, b.pos],
        width: 9,
        material: new Cesium.ColorMaterialProperty(segColor.withAlpha(0.95)),
        // X-ray through Earth: segment is still visible (at ~33% of
        // in-front alpha) when occluded by the globe so the user can
        // see the full pass trajectory even when the camera is on the
        // wrong side of the planet for it.
        depthFailMaterial: new Cesium.ColorMaterialProperty(segColor.withAlpha(0.31)),
        arcType: Cesium.ArcType.NONE,
      },
    });
    activePassEntities.push(ent);
  }
}

// React TlePanel writes through the store; mirror to state.tle and
// refresh satrec / orbit cache / search whenever it changes. Initial
// auto-fetch happens inside TlePanel on first mount and lands here
// via the same subscription.
function applyStoreTleSideEffects() {
  state.tle = readTleFromStore();
  if (state.tle) {
    refreshSatrec();
    ensureIssEntity();
    ensureOrbitEntity();
    ensureGpLineEntity();
    invalidateOrbitCache();
    rerunSearchIfActive();
  }
}
const _unsubTle = usePassFinderStore.subscribe((s, prev) => {
  if (s.tle === prev.tle) return;
  applyStoreTleSideEffects();
});
// Race-fix scheduled at the bottom of the bootstrap — see the
// queueMicrotask call near the return statement. Firing it inline
// here would TDZ on windowsListEl + friends that get declared later
// in this same function.

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
// Encoder + localStorage IO live in lib/pass-finder/state-blob.js.
// These tiny wrappers gather the current `state` into the snapshot
// shape that module accepts.

// Time-of-pass that was on the URL when the page loaded — consumed by
// the first runSearch to jump to the matching window instead of #0.
let _pendingPassTimeMs = null;

function currentStateSnapshot() {
  const active = state.activeWindowIdx >= 0 ? state.windows[state.activeWindowIdx] : null;
  return {
    observers: state.observers.map(o => ({ name: o.name, latDeg: o.latDeg, lonDeg: o.lonDeg })),
    activePassMs: active ? active.startMs : null,
    mode: state.mode,
    minElevDeg: state.minElevDeg,
  };
}

// localStorage only — the URL is left clean. Share button generates a
// fresh ?s=... URL on demand so the ugly blob only shows up when
// explicitly copying a link to share with someone else.
function persistState() {
  writePersistedBlob(encodeStateBlob(currentStateSnapshot()));
}

// Build the URL a recipient would open to land on the current pass +
// observer + mode setup. Used by the Share button.
function buildShareUrl() {
  const url = new URL(window.location.href);
  url.search = state.observers.length
    ? `?s=${encodeStateBlob(currentStateSnapshot())}`
    : "";
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
  const fromStorage = decodeStateBlob(readPersistedBlob());
  if (fromStorage && fromStorage.observers.length) {
    if (fromStorage.mode) state.mode = fromStorage.mode;
    if (fromStorage.minElevDeg != null) state.minElevDeg = fromStorage.minElevDeg;
    for (const o of fromStorage.observers) addObserver(o.name, o.latDeg, o.lonDeg);
    return;
  }
  // No URL/localStorage state — leave observer list empty. The empty
  // state shows the "Add observer" form prominently (incl. the "use
  // my location" geolocation button) so first-time users start with
  // a clean slate rather than three preset cities.
}

loadInitialObservers();

// First-time-visitor handling moved further down — see the
// `if (!state.observers.length) { … dismissPageLoader() … }` block
// AFTER dismissPageLoader / _pageLoaderDismissed are declared. Calling
// it here hit a TDZ (let _pageLoaderDismissed wasn't initialized yet).

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

// Default the clock to "now", PAUSED. startTime stays at "now" so
// Reset returns here; stopTime far enough out that later real-time
// playback doesn't bump into ClockRange.CLAMPED before the user runs
// a search.
//
// Paused (not animating) during init so the sim clock can't sprint
// ahead during the 1–5s of Cesium boot + TLE fetch + first window
// search. Otherwise a slow first-load can elapse 30–50s of sim time
// before any UI appears, and on reload that looks like "the clock is
// racing and no passes loaded." Resumed at state.multiplier inside
// runSearch once the first results are rendered.
{
  // trueNow() pulls from the clock-sync offset (server-Date-header
  // derived) so a user with their system clock set wrong still gets
  // accurate pass forecasts — the search window anchors to "true now"
  // not whatever their wonky clock reports.
  const nowJd = Cesium.JulianDate.fromDate(new Date(trueNow()));
  viewer.clock.startTime = nowJd;
  viewer.clock.stopTime  = Cesium.JulianDate.addDays(nowJd, 7, new Cesium.JulianDate());
  viewer.clock.currentTime = nowJd;
  viewer.clock.multiplier = state.multiplier;
  viewer.clock.shouldAnimate = false;
}

// Speed select migrated to components/passes/PlaybackControls.tsx,
// which applies state.multiplier to viewer.clock directly. The
// bootstrap still owns state.multiplier (read by various scene
// callbacks) — it's seeded once at boot and only re-read on the
// (rare) automatic bumps in renderWindowsList. Manual user changes
// happen entirely client-side via the React component, so we don't
// need a store mirror for them here.
// (windowsListEl is owned by React's WindowsList component now; the
//  scene publishes via usePassFinderStore.setWindows instead.)

// (Pane toggle migrated to PassFinderApp.tsx — it owns the
//  panel-collapsed body class via a store-driven useEffect.)

// Mode toggle + min-elev stepper migrated to components/passes/
// ModeToggle.tsx + MinElevControl.tsx. Push current state into the
// store (URL/localStorage values land in state.* before this runs),
// then subscribe to store changes so the search reruns when the user
// flips mode or steps the min-elev.
usePassFinderStore.getState().setMode(state.mode);
usePassFinderStore.getState().setMinElevDeg(state.minElevDeg);

let _minElevDebounce = null;
const _unsubControls = usePassFinderStore.subscribe((s, prev) => {
  if (s.mode !== prev.mode) {
    state.mode = s.mode;
    persistState();
    rerunSearchIfActive();
  }
  if (s.minElevDeg !== prev.minElevDeg) {
    state.minElevDeg = s.minElevDeg;
    persistState();
    if (_minElevDebounce) clearTimeout(_minElevDebounce);
    _minElevDebounce = setTimeout(() => { rerunSearchIfActive(); }, 250);
  }
});

// React's WindowsList clicks set store.activeWindowIdx; the scene
// runs the actual jump (camera, clock, entity reframe). Guard against
// the loop by no-oping when state already matches the new value —
// jumpToWindow writes both state.activeWindowIdx AND the store.
const _unsubActiveWindow = usePassFinderStore.subscribe((s, prev) => {
  if (s.activeWindowIdx === prev.activeWindowIdx) return;
  if (s.activeWindowIdx === state.activeWindowIdx) return;
  if (s.activeWindowIdx < 0) {
    state.activeWindowIdx = -1;
    renderActivePassGradient(null);
    refreshAllPolarPlotArcs();
    return;
  }
  if (state.windows[s.activeWindowIdx]) jumpToWindow(s.activeWindowIdx);
});

// Share button (button + copied/failed feedback) migrated to
// components/passes/ShareButton.tsx. Registered via the scene bridge
// below; React calls buildShareUrl() from lib/scene-bridge.

// (Speed picker now in PlaybackControls.tsx — it updates
//  viewer.clock.multiplier directly.)

let searchGen = 0;
let _autoSelectedFirst = false; // ensures we auto-jump to the first window once
let _firstSearchComplete = false; // gates the clock-multiplier bump

function runSearch(startMs, endMs) {
  if (!satrec) return; // wait for TLE
  if (!state.observers.length) return; // wait for observers
  // Only show the "searching…" placeholder if the list is currently
  // empty (initial load or after clearing observers). On subsequent
  // searches the old rows stay visible until renderWindowsList
  // atomically swaps in the new ones — avoids a jarring blank/flash
  // on observer add/remove.
  const storeNow = usePassFinderStore.getState();
  if (!storeNow.windowRows.length) {
    storeNow.setWindows(storeNow.windowHeaders, [], "searching");
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
      // Surface slow searches and empty results — the most common cause
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
  // PassFinderApp tags #page-loader with .hidden based on
  // store.firstSearchComplete — flip the store flag here.
  usePassFinderStore.getState().setFirstSearchComplete(true);
}
// Safety net: if something goes wrong (TLE fetch fails, etc.) and
// runSearch never fires, drop the loader so the user isn't stuck on
// a black screen. 12s covers slow first-load searches (30-day
// horizon × multiple observers can run 3–8s on cold caches); shorter
// timeouts would dismiss while the search is still running, surfacing
// an empty "no passes" panel that fills in a few seconds later.
setTimeout(dismissPageLoader, 12000);

// First-time visitor (no observers seeded from URL or localStorage):
// nothing to search for, so dismiss the loading screen immediately
// rather than letting it sit through the 12-second safety net, and
// start the clock animating at 1× from real time so the globe shows
// live earth rotation behind the empty "Add observer" panel. As soon
// as the user adds an observer, rerunSearchIfActive() will kick off
// the first real search + jump-to-pass logic.
if (!state.observers.length) {
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(trueNow()));
  viewer.clock.multiplier = 1;
  viewer.clock.shouldAnimate = true;
  dismissPageLoader();
}

// Auto-search whenever observers AND TLE are available, starting "now" and
// running for state.horizonDays. Called on observer add/remove and after
// TLE load. No-op if either prerequisite is missing.
function rerunSearchIfActive() {
  // Per-observer pass cache depends on mode + minElevDeg + observer
  // set — any change that triggers a search re-run invalidates them
  // too. The next preRender will repopulate any observer currently
  // sighting ISS.
  invalidateObsPassCache();
  if (!state.observers.length) {
    // No observers → nothing to search. Clear state + list so the prior
    // results don't linger after the user removes the last observer.
    state.windows = [];
    state.activeWindowIdx = -1;
    clearActivePassGradient();
    usePassFinderStore.getState().setWindows([], [], "no-observers");
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
  const headerLabels = state.mode === "radio"
    ? ["P%", "Time (UTC)", "Dur", "Peak El."]
    : ["P%", "Time (UTC)", "Dur", "Alt", "Mag", "Sun", "Clouds"];
  if (!state.windows.length) {
    usePassFinderStore.getState().setWindows(headerLabels, [], "empty");
    return;
  }
  const rows = [];
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
    // Rating = P(every observer captures ISS + reference stars at the
    // same instant in the window), scaled by a duration sigmoid for
    // coordination headroom. Displayed as percent digits, colored on
    // the shared red→yellow→green gradient. Time-of-day is deliberately
    // not part of this score (it's a "will the human be outside?"
    // factor, separate from "can the capture succeed?").
    const passP = passSuccessProbability(w, state.observers);
    const ratingTooltip = `joint capture probability ${(passP * 100).toFixed(0)}% (best moment in window, scaled by duration headroom)`;

    const cells = [];

    // Rating column.
    cells.push({
      className: "rating",
      text: `${Math.round(passP * 100)}`,
      color: ratingCssColor(passP),
      title: ratingTooltip,
    });

    // Time column (UTC, peak/best moment) — uncolored.
    cells.push({
      className: "time",
      text: new Date(peakMs).toISOString().slice(5, 19).replace("T", " "),
    });

    // Duration column.
    const mm = Math.floor(durSec / 60), ss = durSec % 60;
    const durQuality = state.mode === "radio"
      ? radioDurationFactor(durSec)
      : coordinationFactor(durSec);
    cells.push({
      className: "dur",
      text: `${mm}m${ss < 10 ? "0" : ""}${ss}s`,
      color: ratingCssColor(durQuality),
    });

    if (state.mode === "radio") {
      // Peak elevation — worst observer's max elevation across the window.
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
      if (Number.isFinite(worstPeakElev)) {
        cells.push({
          className: "alt",
          text: `${Math.round(worstPeakElev)}°`,
          color: ratingCssColor(peakElevFactor(worstPeakElev)),
        });
      } else {
        cells.push({ className: "alt", text: "—", na: true });
      }
      rows.push({ startMs: w.startMs, cells });
      return;
    }

    // Altitude range — value is min–max alt across observers at peak.
    const altLo = Math.round(minAlt), altHi = Math.round(maxAlt);
    let prodAlt = 1;
    if (issEcef) {
      for (const obs of state.observers) {
        prodAlt *= altitudeFactor(apparentAltDeg(issAltitudeDeg(obs, issEcef)));
      }
    } else {
      prodAlt = 0;
    }
    cells.push({
      className: "alt",
      text: altLo === altHi ? `${altHi}°` : `${altLo}–${altHi}°`,
      color: ratingCssColor(prodAlt),
    });

    // Peak magnitude.
    const peakMag = peakMagnitudeInWindow(w, state.observers);
    if (peakMag == null) {
      cells.push({ className: "mag", text: "—", na: true });
    } else {
      cells.push({
        className: "mag",
        text: peakMag.toFixed(1),
        color: ratingCssColor(Math.max(0, Math.min(1, (-peakMag + 1) / 4))),
      });
    }

    // Sun-altitude column — worst observer at peak.
    const peakDate = new Date(peakMs);
    let worstSunAlt = -Infinity;
    for (const obs of state.observers) {
      const sa = apparentAltDeg(sunAltitudeDeg(obs, peakDate));
      if (sa > worstSunAlt) worstSunAlt = sa;
    }
    if (Number.isFinite(worstSunAlt)) {
      cells.push({
        className: "sun",
        text: `${Math.round(worstSunAlt)}°`,
        color: ratingCssColor(twilightFactor(worstSunAlt)),
      });
    } else {
      cells.push({ className: "sun", text: "—", na: true });
    }

    // Cloud cover range, skill-faded with forecast horizon age.
    if (cloud === null) {
      cells.push({ className: "cloud", text: "—", na: true });
    } else {
      const clLo = Math.round(cloud.min), clHi = Math.round(cloud.max);
      const ageDays = (peakMs - Date.now()) / 86_400_000;
      cells.push({
        className: "cloud",
        text: clLo === clHi ? `${clHi}%` : `${clLo}–${clHi}%`,
        color: ratingCssColorWithSkill(1 - clHi / 100, ageDays),
      });
    }

    rows.push({ startMs: w.startMs, cells });
  });
  usePassFinderStore.getState().setWindows(headerLabels, rows, "ready");
}

// cloudRange + bestMomentMs now live in pass-finder/window-scoring.js
// as pure functions; these wrappers bind state.observers /
// state.cloudForecasts / issEcefAt for the existing call sites.
function cloudRange(ms) {
  return _cloudRangePure(ms, state.observers, (id) => state.cloudForecasts.get(id));
}
function bestMomentMs(w) {
  return _bestMomentMsPure(w, state.observers, issEcefAt);
}

// Index of the window whose [startMs, endMs] contains `ms`, or -1.
// Small tolerance on each edge — clicking a pass parks the clock at
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
  if (i === state.activeWindowIdx) return;
  state.activeWindowIdx = i;
  usePassFinderStore.getState().setActiveWindowIdx(i);
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
  usePassFinderStore.getState().setActiveWindowIdx(i);
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
    usePassFinderStore.getState().setPanelCollapsed(true);
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

// Play / Pause / Reset migrated to components/passes/PlaybackControls.tsx
// — clock manipulation happens there directly. Reset additionally
// calls setActiveWindowIdx(-1); the scene's activeWindowIdx
// subscription above handles the visual teardown.

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
  usePassFinderStore.getState().setFpsObserverId(newId);
  renderObsList();
}
function exitFpsMode() {
  if (_fpsObserverId !== null && _savedFov !== null) {
    viewer.camera.frustum.fov = _savedFov;
    _savedFov = null;
  }
  _fpsObserverId = null;
  usePassFinderStore.getState().setFpsObserverId(null);
  renderObsList();
}

// Per-frame: keep each observer card's polar plot ISS dot in sync with
// the current sim time. Arc is static for the active window — only the
// dot moves frame-to-frame.
viewer.scene.preRender.addEventListener(autoTrackActiveWindow);

// Per-observer "sighting now" tracker. Toggles the polar-plot icons
// (obs-list + 3D-scene) per observer based on observerSeesIss at the
// current clock time. On the invisible→visible transition, computes
// the observer's full pass window and refreshes their arc — so a
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
    // with the new stroke color — no SGP4 re-propagation.
    const sunAltDeg = apparentAltDeg(sunAltitudeDeg(obs, d));
    // Display toggle — same per-observer flag drives both placements.
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
  // Tell the shared frameAll how much of the canvas is covered by the
  // left panel so it can fit the bounding sphere into the visible
  // (un-occluded) area rather than the full canvas. Bottom-controls
  // strip is ~50px tall — reserve a little vertical room too.
  getFrameViewportInset: () => {
    const panel = document.getElementById("panel-left");
    const leftPx = (panel && !document.body.classList.contains("panel-collapsed"))
      ? Math.ceil(panel.getBoundingClientRect().right + 8)
      : 0;
    return { left: leftPx, right: 0, top: 0, bottom: 60 };
  },
  getAnchorPosition: () => {
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
    // Only include the ISS in the frame when there's an active pass.
    // Outside a pass the satellite could be anywhere on its orbit
    // (often the far side of Earth from the observers), which would
    // zoom the camera all the way out to a hemisphere view. With no
    // active pass, framing just the observer pins keeps the user
    // focused on their station setup.
    const w = state.windows?.[state.activeWindowIdx];
    if (w) {
      // Sample positions along the pass window so the frame includes
      // the full colored arc — not just the ISS at "now". Without this
      // the frame is too tight when the current clock time happens to
      // sit at the pass start/end.
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

  // Race-fix: if TlePanel's auto-fetch already landed before we
  // finished bootstrapping (Cesium viewer slow, or page navigated
  // away + back), the tle subscription above never fires for that
  // initial value. Schedule the side effects in a microtask so
  // every binding in this function (windowsListEl, refreshSatrec,
  // etc.) is in scope by the time we touch them.
  queueMicrotask(() => {
    if (readTleFromStore()) applyStoreTleSideEffects();
  });

  // Register the typed bridge React components consume. Single
  // assignment swaps in all functions atomically; teardown clears
  // the slot.
  setSceneBridge({
    paintPolarPlot:   bridgePaintPolarPlot,
    renderPolarModal: bridgeRenderPolarModal,
    copyPolarPng:     bridgeCopyPolarPng,
    buildShareUrl:    buildShareUrl,
    addObserver:      addObserver,
    removeObserver:   removeObserver,
    toggleFps:        setFpsObserver,
  });

  return () => {
    _unsubControls();
    _unsubTle();
    _unsubClickToPlace();
    _unsubActiveWindow();
    clearSceneBridge();
    if (_minElevDebounce) clearTimeout(_minElevDebounce);
    // Viewer disposal is owned by useCesiumViewer's cleanup. DOM
    // listeners on JSX-rendered elements get torn down by React on
    // unmount; nothing else to detach here yet.
  };
}
