// lib/pass-finder-scene.js — Cesium scene for the pass-finder page.
// Receives a viewer already created by useCesiumViewer (called from
// PassFinderApp). Same hook-composition pattern as the triangulate
// page, just with a much larger imperative island inside.

import { parseDmsToDecimal, geodeticToEcef } from "./coords.js";
import { geocodeOne } from "./pass-finder/geocode.js";
import { fetchIssTle } from "./pass-finder/tle.js";
import { isVisibleAtAll, isRadioReachable, issAltitudeDeg, issAltAzDeg, issIlluminated, sunAltitudeDeg } from "./pass-finder/visibility.js";
import { sunPositionEcef } from "./pass-finder/sun.js";
import { findVisibilityWindows } from "./pass-finder/search.js";
import { tleOrbitTrackEcef } from "./truth.js";
import { fetchCloudForecast, cloudAt } from "./pass-finder/weather.js";
import { fetchTimezone } from "./pass-finder/timezone.js";
import { moonPositionEcef, moonPhaseAngle, moonIlluminatedFraction } from "./pass-finder/moon.js";
import { planetPositionEcef, planetApparentMagnitude, PLANET_STYLE, PLANET_NAMES } from "./pass-finder/planets.js";
import { apparentAltDeg } from "./refraction.js";
import {
  ratingCssColor, ratingCssColorWithSkill, ratingColorAtCesium,
  twilightFactor, altitudeFactor, coordinationFactor,
  forecastSkill, effectivePClear,
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
  ARC_OPACITY_UNIFORM, ARC_DASH_ALPHA,
  issAlphaForMag, arcSampleStyle,
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
import * as sat from "satellite.js";
import { wireCameraControls } from "./camera-controls.js";
import { usePassFinderStore } from "./pass-finder-store";

const Cesium = typeof window !== "undefined" ? window.Cesium : undefined;

export function initPassFinderScene(viewer) {
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
//  renders the static skeleton. The scene paints into it via
//  window.__passesPaintPolarPlot.)

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
  return altAzToSvg(altDeg, azDeg, ICON_GEOM.cx, ICON_GEOM.cy, ICON_GEOM.R);
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
//  into the window.__passesRenderPolarModal / CopyPolarPng helpers
//  defined below.)


// CSS embedded inside the SVG so the chart still renders correctly
// when serialized to a standalone file (PNG export / right-click save).
// Page CSS in pass-finder.css covers the on-screen display, but a
// blob-loaded <img> only sees what's inside the SVG itself.
const MODAL_SVG_STYLE = `
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
`;

function paintPolarModalStatic(svg, obs, anchorMs, sunAltDeg) {
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
  // selected window — shouldn't happen but stays defensive).
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

// Plot the sun (if above horizon) and the moon (if above horizon, with
// correct phase + orientation pointing toward the sun's chart position)
// on the polar modal. Painted once when the modal opens. Both bodies
// only show when ≥ 0° apparent altitude — below-horizon bodies are
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
  // they're geometrically close — e.g. on a new-moon day). Sun and
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
    // it — the M reads dark on the bright lit hemisphere and bright
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
    // Same difference trick on the S — white fill inverts the yellow
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
  // moon's apparent disc — literal occlusion. Sun and moon both
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
    // Glyph-only rendering — planet color on the glyph itself with a
    // thin dark stroke (paint-order: stroke) keeps it legible against
    // any sky shade. The disc-and-overlay approach made the inner
    // glyph too small to read; here the whole footprint IS the glyph.
    appendPlanetGlyph(layer, px, py, style.glyph, r, style.color);
  }
}

// Planet glyph — traditional astrological symbol painted in the
// planet's own color with a thin dark halo (paint-order: stroke) for
// legibility against any sky shade. No disc backing — the glyph itself
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
// Caller picks the fill (and optionally a CSS blend mode — the moon's
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
  // literal mini-render of the chart's pass arc — colors and contrast
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
  // the shade matches the modal background — invisible anyway.
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
        // near 0.85 — mirrors the issAlphaForMag curve a bright pass
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
      // sampling phaseAngle an hour later — phase angle increases
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

// CONSTELLATION_LINES + the pure paint function live in
// pass-finder/constellations.js. The wrapper threads MODAL_GEOM in
// so the pure function stays scene-free.
function paintPolarModalConstellations(svg, obs, jsDate, sunAltDeg) {
  return _paintConstellationsPure(svg, obs, jsDate, sunAltDeg, MODAL_GEOM);
}

function paintPolarModalStars(svg, obs, jsDate, limMag) {
  return _paintModalStarsPure(svg, obs, jsDate, limMag, MODAL_GEOM);
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

// Diamond-marker geometry. A diamond at (cx, cy) with half-extent r
// is rotated by `ang` so its long diagonal points ALONG the path —
// gives the marker a sense of direction. Vertices in moon-local
// (before rotation): forward (+r,0), perp (0,+r), backward (−r,0),
// anti-perp (0,−r). After rotating each by `ang`:
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
  // SPLIT diamond — rotated to align one of its diagonals with the
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
// <img> element, so the caller can wait before unhiding the modal —
// otherwise the user sees a frame of empty <img> while the PNG paints.
// Polar modal lifecycle (open/close, Escape, backdrop, save/copy
// buttons) lives in components/passes/PolarModal.tsx; React owns the
// DOM and store.polarModalObsId. We expose the imperative paint +
// PNG-rasterize helpers via window.__passes* so React can call them
// with the modal's own SVG / img / link refs.

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

window.__passesRenderPolarModal = async (svgEl, obsId) => {
  if (!svgEl) return null;
  const obs = state.observers.find(o => o.id === obsId);
  if (!obs) return null;
  await renderPolarModalInto(svgEl, obs);
  const blob = await svgToPngBlob(svgEl);
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, filename: polarModalFileNameFor(obs) };
};

window.__passesCopyPolarPng = async (svgEl) => {
  if (!svgEl) throw new Error("svg ref missing");
  const blob = await svgToPngBlob(svgEl);
  if (!navigator.clipboard?.write) throw new Error("Clipboard API unavailable");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
};

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

function polarModalFileNameFor(obs) {
  const obsSlug = (obs?.name ?? "observer").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // Timestamp from the ACTIVE pass start, formatted in the observer's
  // local timezone — filename describes when the pass is, not when
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
  // as "GMT-05:00" or "GMT+05:30" — strip prefix and colon for the
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

// PNG export (Save) is handled in PolarModal.tsx by clicking the
// hidden <a download> wrapping the img. Clipboard copy is delegated
// to window.__passesCopyPolarPng, which rasterizes the same SVG.

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
window.__passesPaintPolarPlot = function (svgEl, obsId) {
  if (!svgEl) return;
  const obs = state.observers.find(o => o.id === obsId);
  if (!obs) return;
  updatePolarPlotArc(svgEl, obs);
  updatePolarPlotEvents(svgEl, obs);
};

const _onPassesRemoveObserver = (ev) => {
  const id = ev.detail?.obsId;
  if (id) removeObserver(id);
};
const _onPassesToggleFps = (ev) => {
  const id = ev.detail?.obsId;
  if (id) setFpsObserver(id);
};
window.addEventListener("passes-remove-observer", _onPassesRemoveObserver);
window.addEventListener("passes-toggle-fps", _onPassesToggleFps);

// Add-observer form (lat/lon input, geocode, click-place toggle)
// migrated to components/passes/AddObserverForm.tsx. The form
// dispatches `passes-add-observer` CustomEvents that we listen for
// here to actually create the Cesium entities + fetch cloud forecasts.
// Click-place is a store slice that we mirror into state.clickToPlace
// for the canvas click handler below.
const _onPassesAddObserver = (ev) => {
  const { name, latDeg, lonDeg } = ev.detail ?? {};
  if (latDeg == null || lonDeg == null) return;
  addObserver(name, latDeg, lonDeg);
};
window.addEventListener("passes-add-observer", _onPassesAddObserver);

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

// ---------------------------------------------------------------------------
// Joint capture-probability model. Pure factor curves
// (twilightFactor / altitudeFactor / coordinationFactor / forecastSkill
// / effectivePClear / peakElevFactor / radioDurationFactor /
// magnitudeAt) live in lib/pass-finder/ratings.js — this section is
// the state-aware glue that pulls observers, satrec, mode, and cloud
// caches through them.
// ---------------------------------------------------------------------------

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
// gets — the worst observer's peak elevation, which limits the joint
// best signal-to-noise — and (b) how LONG the window lasts (more time
// = more opportunities for a QSO / better Doppler measurement). The
// peakElevFactor + radioDurationFactor curves themselves live in
// pass-finder/ratings.js.
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
// Worst observer's elevation factor at this instant — gradient turns
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


// (magnitudeAt is imported from pass-finder/ratings.js — pure given
//  obs / issEcef / sunDir.)

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
  const nowJd = Cesium.JulianDate.fromDate(new Date());
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
    // has-active-pass body class is mirrored by PassFinderApp.
    renderActivePassGradient(null);
    refreshAllPolarPlotArcs();
    return;
  }
  if (state.windows[s.activeWindowIdx]) jumpToWindow(s.activeWindowIdx);
});

// Share button (button + copied/failed feedback) migrated to
// components/passes/ShareButton.tsx. The component calls into
// window.__passesBuildShareUrl for the URL since it depends on state
// we haven't moved to the store (observers blob, active window).
window.__passesBuildShareUrl = buildShareUrl;

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
// Safety net: if something goes wrong (TLE fetch fails, no observers,
// etc.) and runSearch never fires, drop the loader so the user isn't
// stuck on a black screen. 12s covers slow first-load searches (30-day
// horizon × multiple observers can run 3–8s on cold caches); shorter
// timeouts would dismiss while the search is still running, surfacing
// an empty "no passes" panel that fills in a few seconds later.
setTimeout(dismissPageLoader, 12000);

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
  // body.has-active-pass is mirrored from store.activeWindowIdx by
  // PassFinderApp — no direct mutation here.
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
  // body.has-active-pass is mirrored by PassFinderApp.
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

  // Race-fix: if TlePanel's auto-fetch already landed before we
  // finished bootstrapping (Cesium viewer slow, or page navigated
  // away + back), the tle subscription above never fires for that
  // initial value. Schedule the side effects in a microtask so
  // every binding in this function (windowsListEl, refreshSatrec,
  // etc.) is in scope by the time we touch them.
  queueMicrotask(() => {
    if (readTleFromStore()) applyStoreTleSideEffects();
  });

  return () => {
    _unsubControls();
    _unsubTle();
    _unsubClickToPlace();
    _unsubActiveWindow();
    window.removeEventListener("passes-add-observer", _onPassesAddObserver);
    window.removeEventListener("passes-remove-observer", _onPassesRemoveObserver);
    window.removeEventListener("passes-toggle-fps", _onPassesToggleFps);
    delete window.__passesPaintPolarPlot;
    delete window.__passesBuildShareUrl;
    delete window.__passesRenderPolarModal;
    delete window.__passesCopyPolarPng;
    if (_minElevDebounce) clearTimeout(_minElevDebounce);
    // Viewer disposal is owned by useCesiumViewer's cleanup. DOM
    // listeners on JSX-rendered elements get torn down by React on
    // unmount; nothing else to detach here yet.
  };
}
