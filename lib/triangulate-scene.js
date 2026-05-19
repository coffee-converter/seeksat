// lib/triangulate-scene.js — Cesium scene reconciliation for the
// triangulate page. Receives a viewer already created by
// useCesiumViewer + a store already seeded by useTriangulateAttempts,
// and wires up everything that has to live in the imperative Cesium
// layer: observer pins, sightline rays, the triangulated point,
// TLE-truth entities, camera controls, persistence.
//
// Returns a teardown function that unsubscribes from the store.
// Cesium entities are owned by the viewer; viewer.destroy() (called
// by useCesiumViewer's cleanup) handles their disposal.

import {
  raDecToEciDir,
  altAzToEnuDir,
  geodeticToEcef,
  gmstFromDate,
  eciToEcefRotate,
  enuToEcefRotate,
} from "./coords.js";
import { triangulateRays } from "./triangulate.js";
import { lookupElev } from "./elevation.js";
import { correctRefraction } from "./refraction.js";
import { tlePositionEcef, tleOrbitTrackEcef } from "./truth.js";
import { wireCameraControls } from "./camera-controls.js";
import { useTriangulateStore } from "./store";
import { pickTleLines } from "./tle-utils";
import { persistCurrent } from "./triangulate-attempts";

const Cesium = typeof window !== "undefined" ? window.Cesium : undefined;

export function initTriangulateScene(viewer) {

// Panel-toggle button + .panel-collapsed body class are owned by
// TriangulateApp (local React state + useBodyClass). The scene still
// reads body.panel-collapsed in renderTruth() to size the camera
// viewport inset — the CSS class is the shared state.

// Initial state is seeded by useTriangulateAttempts before this hook
// runs; we read it from the store. `state` is a thin module-local
// mirror that the imperative recompute/renderTruth code reads each
// pass — kept in sync by the subscriber below.
const _init = useTriangulateStore.getState();
const state = {
  timestampUTC: _init.timestampUTC,
  observations: _init.observations,
  triangulated: null,
  residuals: [],
  refractionEnabled: _init.refractionEnabled,
};
window.__state = state; // dev-console inspection

// Render layer references so we can clear and redraw on every recompute.
const layer = {
  observers: [],
  rays: [],
  triangulated: null,
  normal: null,
};

function clearLayer() {
  for (const e of layer.observers) viewer.entities.remove(e);
  for (const e of layer.rays) viewer.entities.remove(e);
  if (layer.triangulated) viewer.entities.remove(layer.triangulated);
  if (layer.normal) viewer.entities.remove(layer.normal);
  layer.observers = [];
  layer.rays = [];
  layer.triangulated = null;
  layer.normal = null;
}

function ensureElev(obs) {
  if (obs.elevM != null) return;
  const id = obs.id;
  lookupElev(obs.latDeg, obs.lonDeg).then(elev => {
    const current = state.observations.find(o => o.id === id);
    if (current && current.elevM == null) {
      current.elevM = elev;
      renderObsList();
      recompute();
    }
  });
}

function observerUpEcef(latDeg, lonDeg) {
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

function buildRay(obs, jsDate) {
  const origin = geodeticToEcef(obs.latDeg, obs.lonDeg, obs.elevM || 0);
  let dirEcef;
  if (obs.dir.mode === "radec") {
    const dirEci = raDecToEciDir(obs.dir.raHours, obs.dir.decDeg);
    dirEcef = eciToEcefRotate(dirEci, gmstFromDate(jsDate));
  } else {
    const dirEnu = altAzToEnuDir(obs.dir.altDeg, obs.dir.azDeg);
    dirEcef = enuToEcefRotate(dirEnu, obs.latDeg, obs.lonDeg);
  }
  if (state.refractionEnabled) {
    dirEcef = correctRefraction(dirEcef, observerUpEcef(obs.latDeg, obs.lonDeg));
  }
  return { origin, dir: dirEcef };
}

function obsHasLocation(o) { return o.latDeg != null && o.lonDeg != null; }
function obsHasDirection(o) {
  if (!o.dir || !o.dir.mode) return false;
  if (o.dir.mode === "radec") return o.dir.raHours != null && o.dir.decDeg != null;
  return o.dir.azDeg != null && o.dir.altDeg != null;
}

let recompute = function () {
  for (const obs of state.observations) {
    if (obsHasLocation(obs)) ensureElev(obs);
  }
  clearLayer();
  const jsDate = new Date(state.timestampUTC);
  const timeOk = !Number.isNaN(jsDate.getTime());

  // Observers with complete location render a pin. Those that also
  // have a direction get a ray. Triangulation runs only when there
  // are ≥2 fully-complete observations — but we still want each
  // individual ray to render before that, so the user can see
  // alignment as they add data.
  const located = state.observations.filter(obsHasLocation);
  const rayObs = located.filter(obsHasDirection);
  const rays = (timeOk ? rayObs : []).map(o => buildRay(o, jsDate));

  let triangulationOk = false;
  if (timeOk && rays.length >= 2) {
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(jsDate);
    const result = triangulateRays(rays);
    state.triangulated = result.point;
    state.residuals = result.residuals;
    triangulationOk = !!state.triangulated;
  } else {
    state.triangulated = null;
    state.residuals = [];
  }
  // Mirror the triangulation result into the Zustand store so React
  // panels (ResultPanel, …) can subscribe to it. The bootstrap's
  // own state object stays the live source while the rest of the
  // imperative code is still in flight.
  useTriangulateStore.getState().setTriangulationResult(
    state.triangulated, state.residuals,
  );

  // Observer pins — anchor at sea level (elev 0) so the dot sits on the
  // rendered globe surface (Cesium's ellipsoid imagery has no 3D terrain).
  // Math still uses the observer's real elevation for the ray direction.
  for (const obs of located) {
    const pos = Cesium.Cartesian3.fromDegrees(obs.lonDeg, obs.latDeg, 0);
    const color = Cesium.Color.fromCssColorString(obs.color);
    layer.observers.push(viewer.entities.add({
      name: obs.name,
      position: pos,
      point: {
        pixelSize: 12, color,
        outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
      },
      label: {
        text: obs.name, font: "12px sans-serif",
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(12, -10),
        fillColor: color, showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(10,14,26,0.7)"),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }));
  }

  // Rays as polylines extending past the triangulated point — drawn
  // whenever an observer has a complete direction, even when there
  // aren't yet ≥2 to triangulate. Length defaults to 1000 km when
  // there's nothing to anchor to.
  const refOrigin = rays[0]?.origin;
  const rayLength = (triangulationOk && refOrigin)
    ? 2 * Math.hypot(
        state.triangulated[0] - refOrigin[0],
        state.triangulated[1] - refOrigin[1],
        state.triangulated[2] - refOrigin[2],
      )
    : 1_000_000;

  for (let i = 0; i < rays.length; i++) {
    const { origin, dir } = rays[i];
    const obs = rayObs[i];
    const end = [
      origin[0] + dir[0] * rayLength,
      origin[1] + dir[1] * rayLength,
      origin[2] + dir[2] * rayLength,
    ];
    // Visually start the ray at sea level (matches the observer dot);
    // the few hundred meters of offset along the same direction is invisible.
    layer.rays.push(viewer.entities.add({
      polyline: {
        positions: [
          Cesium.Cartesian3.fromDegrees(obs.lonDeg, obs.latDeg, 0),
          Cesium.Cartesian3.fromElements(...end),
        ],
        width: 3,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.25,
          color: Cesium.Color.fromCssColorString(obs.color),
        }),
        arcType: Cesium.ArcType.NONE, // straight line through space
      },
    }));
  }

  // Faint dashed plumb line from triangulated point to its ground projection.
  if (state.triangulated) {
    const cart = Cesium.Cartographic.fromCartesian(
      Cesium.Cartesian3.fromElements(...state.triangulated)
    );
    const groundEcef = Cesium.Cartesian3.fromDegrees(
      Cesium.Math.toDegrees(cart.longitude),
      Cesium.Math.toDegrees(cart.latitude),
      0
    );
    layer.normal = viewer.entities.add({
      polyline: {
        positions: [
          Cesium.Cartesian3.fromElements(...state.triangulated),
          groundEcef,
        ],
        width: 1.5,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString("#cfe0ff").withAlpha(0.45),
          dashLength: 10,
        }),
        arcType: Cesium.ArcType.NONE,
      },
    });
  }

  // Triangulated marker with gentle pulse.
  if (state.triangulated) {
    layer.triangulated = viewer.entities.add({
      position: Cesium.Cartesian3.fromElements(...state.triangulated),
      point: {
        pixelSize: new Cesium.CallbackProperty(() => {
          // Use wall-clock time so the pulse runs even when the Cesium clock is paused.
          return 12 + 4 * Math.abs(Math.sin(Date.now() / 500));
        }, false),
        color: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString("#7eb8ff"),
        outlineWidth: 3,
      },
      label: {
        text: formatTriangulatedLabel(),
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
};

function formatTriangulatedLabel() {
  if (!state.triangulated) return "";
  const cart = Cesium.Cartographic.fromCartesian(
    Cesium.Cartesian3.fromElements(...state.triangulated)
  );
  return `Triangulated · ${(cart.height / 1000).toFixed(1)} km`;
}


const PALETTE = ["#ff9b54", "#7fe5d1", "#c084fc", "#facc15", "#f87171"];

// Observations form (UTC input, refraction toggle, obs cards, +Add)
// migrated to components/triangulate/ObservationsPanel.tsx +
// ObservationCard.tsx. The bootstrap now subscribes to store changes
// for the side effects it still owns (camera buttons that name
// observers by index, recompute on refraction toggle).
function renderObsList() {
  // No-op: ObservationsPanel renders the obs-list and
  // FromObserverButtons (a sibling component subscribed to the
  // observations store slice) re-renders the "From <obs>" camera-
  // preset buttons on any observation change.
}

// Result-panel text rendering migrated to components/triangulate/
// ResultPanel.tsx — subscribes to the store via setTriangulationResult
// above. Bootstrap retains only the Cesium-entity side (observer pins,
// rays, triangulated marker) which still lives in `recompute` above.

// TLE form/textareas + Fetch/Clear buttons + stale-warn hint migrated
// to components/triangulate/TlePanel.tsx — all of that state lives in
// the Zustand store now. Bootstrap keeps only the Cesium-entity side
// (truth point, orbit track, miss dashed line) plus the store mirror
// for state.truthPos.

const truthLayer = { entity: null, miss: null, orbit: null };

function clearTruthLayer() {
  if (truthLayer.entity) viewer.entities.remove(truthLayer.entity);
  if (truthLayer.miss) viewer.entities.remove(truthLayer.miss);
  if (truthLayer.orbit) viewer.entities.remove(truthLayer.orbit);
  truthLayer.entity = null;
  truthLayer.miss = null;
  truthLayer.orbit = null;
}

function renderTruth() {
  clearTruthLayer();
  state.truthPos = null;
  useTriangulateStore.getState().setTruthPos(null);
  const storeTle = useTriangulateStore.getState().tle;
  const lines = pickTleLines(storeTle);
  if (!lines) return;
  const [line1, line2] = lines;

  let pos;
  try {
    pos = tlePositionEcef(line1, line2, new Date(state.timestampUTC));
  } catch (e) {
    console.error("TLE error:", e.message);
    return;
  }
  if (!pos) {
    console.warn("TLE propagation returned no position.");
    return;
  }
  state.truthPos = pos;
  useTriangulateStore.getState().setTruthPos(pos);

  // Orbit track: snapshot of the ISS orbit in the Earth-fixed frame at obs time.
  try {
    const orbit = tleOrbitTrackEcef(line1, line2, new Date(state.timestampUTC));
    if (orbit.length >= 2) {
      truthLayer.orbit = viewer.entities.add({
        polyline: {
          positions: orbit.map(p => Cesium.Cartesian3.fromElements(...p)),
          width: 1.5,
          material: Cesium.Color.fromCssColorString("#7eb8ff").withAlpha(0.45),
          arcType: Cesium.ArcType.NONE,
        },
      });
    }
  } catch (e) {
    console.warn("orbit track failed:", e.message);
  }

  truthLayer.entity = viewer.entities.add({
    position: Cesium.Cartesian3.fromElements(...pos),
    point: {
      pixelSize: 12,
      color: Cesium.Color.fromCssColorString("#7eb8ff").withAlpha(0.6),
      outlineColor: Cesium.Color.fromCssColorString("#7eb8ff"),
      outlineWidth: 2,
    },
    label: {
      text: `TLE: ${(storeTle.name || "").trim() || "Truth"}`,
      font: "12px sans-serif",
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      verticalOrigin: Cesium.VerticalOrigin.TOP,
      pixelOffset: new Cesium.Cartesian2(14, 12),
      fillColor: Cesium.Color.fromCssColorString("#7eb8ff"),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("rgba(10,14,26,0.7)"),
      backgroundPadding: new Cesium.Cartesian2(6, 4),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  if (state.triangulated) {
    const miss = Math.hypot(
      pos[0] - state.triangulated[0],
      pos[1] - state.triangulated[1],
      pos[2] - state.triangulated[2],
    );
    truthLayer.miss = viewer.entities.add({
      polyline: {
        positions: [
          Cesium.Cartesian3.fromElements(...state.triangulated),
          Cesium.Cartesian3.fromElements(...pos),
        ],
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString("#cfe0ff"),
          dashLength: 12,
        }),
        arcType: Cesium.ArcType.NONE,
      },
    });
    // Truth-block text (lat/lon/alt/Δ) lives in ResultPanel.tsx now —
    // it reads state.truthPos + state.triangulated from the store.
    void miss;
  }
}

// Read the active TLE from the store. Returns null when all three
// fields are empty — distinguishes "user cleared the TLE" from "TLE
// was never set", which matters for persistCurrent (manifest
// overrides treat null as "user explicitly cleared").
function currentTleFromForm() {
  const t = useTriangulateStore.getState().tle;
  const name = t.name.trim();
  const line1 = t.line1.trim();
  const line2 = t.line2.trim();
  if (!name && !line1 && !line2) return null;
  return { name, line1, line2 };
}

// Any TLE change in the store (typing in the form, Fetch, Clear,
// attempt switch) re-runs the recompute chain so renderTruth picks
// up the new lines and persistCurrent saves them. We hold the
// unsubscribe fn so the teardown can revoke it.
const _unsubTle = useTriangulateStore.subscribe((s, prev) => {
  if (s.tle !== prev.tle) recompute();
});

// Compose renderTruth onto recompute.
const _recompute2 = recompute;
recompute = function () {
  _recompute2();
  renderTruth();
};

const cameraCtrl = wireCameraControls(viewer, {
  getOrbitAnchor: () => state.triangulated
    ? Cesium.Cartesian3.fromElements(...state.triangulated)
    : null,
  // Hand the shared camera-controls the observers, the triangulated point
  // (if any), AND samples along each observer→triangulated line so the
  // bounding sphere captures meaningful horizontal extent even when the
  // ISS is roughly overhead the observers. Letting the shared frameAll /
  // topDown derive bounds + altitude from these points (no hardcoded
  // altitude override) gives the same auto-scaling pass-finder enjoys.
  // Tell the shared frameAll how much of the canvas is covered by the
  // left panel so it can fit the bounding sphere into the visible area
  // (rather than fitting the full canvas and letting the panel hide the
  // left edge of the data). When the panel is collapsed we report 0.
  getFrameViewportInset: () => {
    const panel = document.getElementById("panel-observations");
    if (!panel || document.body.classList.contains("panel-collapsed")) {
      return { left: 0, right: 0, top: 0, bottom: 0 };
    }
    // 16px panel left-offset + panel width, total horizontal real estate
    // the panel takes from the canvas's left edge.
    const rect = panel.getBoundingClientRect();
    return { left: Math.ceil(rect.right + 8), right: 0, top: 0, bottom: 0 };
  },
  // Position the frame camera perpendicular to the observer baseline so
  // the rays converging on the ISS are seen edge-on rather than along
  // their length. With 1 observer, use the bearing observer→ISS-subpoint;
  // with 0 observers, fall back to the shared default tilt.
  getFrameHeadingPitch: () => {
    const obs = state.observations.filter(obsHasLocation);
    if (obs.length === 0) return { headingDeg: 20, pitchDeg: -30 };
    let dx = 0, dy = 0;
    if (obs.length >= 2) {
      let i0 = 0, i1 = 1, dmax = -1;
      for (let i = 0; i < obs.length; i++) {
        for (let j = i + 1; j < obs.length; j++) {
          const a = obs[i], b = obs[j];
          const ay = b.latDeg - a.latDeg;
          const ax = (b.lonDeg - a.lonDeg) * Math.cos(a.latDeg * Math.PI / 180);
          const d = ax * ax + ay * ay;
          if (d > dmax) { dmax = d; i0 = i; i1 = j; }
        }
      }
      const a = obs[i0], b = obs[i1];
      dy = b.latDeg - a.latDeg;
      dx = (b.lonDeg - a.lonDeg) * Math.cos(a.latDeg * Math.PI / 180);
    } else if (state.triangulated) {
      const triCart = Cesium.Cartographic.fromCartesian(
        Cesium.Cartesian3.fromElements(...state.triangulated));
      dy = Cesium.Math.toDegrees(triCart.latitude) - obs[0].latDeg;
      dx = (Cesium.Math.toDegrees(triCart.longitude) - obs[0].lonDeg)
        * Math.cos(obs[0].latDeg * Math.PI / 180);
    } else {
      return { headingDeg: 20, pitchDeg: -30 };
    }
    const baselineDeg = Math.atan2(dx, dy) * 180 / Math.PI;
    // Two perpendiculars to the baseline give equally-valid "from
    // the side" views. Prefer whichever sits closer to looking-from-
    // south (heading 180°) — keeps map north up and the scene
    // tilted toward the viewer the way we naturally read maps.
    const norm = (a) => ((a % 360) + 360) % 360;
    const cand1 = norm(baselineDeg + 90);
    const cand2 = norm(baselineDeg - 90);
    const distToSouth = (h) => Math.min(Math.abs(h - 180), 360 - Math.abs(h - 180));
    const headingDeg = distToSouth(cand1) <= distToSouth(cand2) ? cand1 : cand2;
    return { headingDeg, pitchDeg: -15 };
  },
  getFramePositions: () => {
    const ps = state.observations
      .filter(obsHasLocation)
      .map(o => Cesium.Cartesian3.fromDegrees(o.lonDeg, o.latDeg, o.elevM || 0));
    const skyPoints = [];
    if (state.triangulated) {
      skyPoints.push(Cesium.Cartesian3.fromElements(...state.triangulated));
    }
    if (state.truthPos) {
      skyPoints.push(Cesium.Cartesian3.fromElements(...state.truthPos));
    }
    for (const p of skyPoints) {
      ps.push(p);
      // Sample the ground projection so the bounding sphere isn't a
      // thin sliver dominated by ISS altitude — pulling in the sub-
      // point gives the frame a sensible footprint even when observers
      // are close together.
      const cart = Cesium.Cartographic.fromCartesian(p);
      ps.push(Cesium.Cartesian3.fromDegrees(
        Cesium.Math.toDegrees(cart.longitude),
        Cesium.Math.toDegrees(cart.latitude),
        0
      ));
    }
    return ps;
  },
  beforePreset: () => { if (layer.observers.length) setObserverVisibility(-1); },
  extraHandlers: {
    // "from-<idx>" buttons are React-rendered by
    // components/triangulate/FromObserverButtons.tsx; the data-cam
    // attribute carries the index that we route to viewFromObserver.
    "from-observer": (btn) => {
      const idx = Number(btn.dataset.obsIdx);
      if (Number.isFinite(idx)) viewFromObserver(idx);
    },
  },
});

// "From <name>" camera-preset buttons rendered by
// components/triangulate/FromObserverButtons.tsx — it subscribes to
// the observations store slice and rebuilds on change. The buttons
// still carry data-cam="from-observer" + data-obs-idx, which the
// wireCameraControls event delegation above routes to
// viewFromObserver(idx).

function setObserverVisibility(hiddenIdx) {
  for (let i = 0; i < layer.observers.length; i++) {
    layer.observers[i].show = (i !== hiddenIdx);
  }
}

function viewFromObserver(idx) {
  const obs = state.observations[idx];
  if (!obs || !obsHasLocation(obs)) return;
  // Keep all observers visible — camera sits 50 m behind the observer so the
  // pin/label is in the foreground rather than blocking the lens.
  const origin = geodeticToEcef(obs.latDeg, obs.lonDeg, obs.elevM || 0);
  // Target: the triangulated point if we have one; otherwise a virtual
  // point 1000 km along the observer's own ray (so a single observer
  // with just a direction can still look "toward where they aimed").
  let target = state.triangulated;
  if (!target) {
    if (!obsHasDirection(obs)) return;
    const ray = buildRay(obs, new Date(state.timestampUTC));
    if (!ray) return;
    const reach = 1_000_000; // 1000 km along the ray
    target = [
      ray.origin[0] + ray.dir[0] * reach,
      ray.origin[1] + ray.dir[1] * reach,
      ray.origin[2] + ray.dir[2] * reach,
    ];
  }
  const dir = [target[0]-origin[0], target[1]-origin[1], target[2]-origin[2]];
  const L = Math.hypot(...dir);
  const dirUnit = [dir[0]/L, dir[1]/L, dir[2]/L];
  // Local geodetic up at the observer (ECEF). Spherical-Earth approximation is
  // accurate enough here for camera placement (sub-meter at WGS84 scales).
  const R = Math.hypot(...origin);
  const up = [origin[0]/R, origin[1]/R, origin[2]/R];
  // Project the sightline onto the local horizontal plane so "behind the
  // observer along the sightline" doesn't mean "underground" when the ISS is
  // high overhead. Step 50 m back horizontally and lift the camera 3 m up so
  // it sits at roughly eye level rather than dipping into surface imagery.
  const dotUp = dirUnit[0]*up[0] + dirUnit[1]*up[1] + dirUnit[2]*up[2];
  const dh = [
    dirUnit[0] - dotUp*up[0],
    dirUnit[1] - dotUp*up[1],
    dirUnit[2] - dotUp*up[2],
  ];
  const Lh = Math.hypot(...dh) || 1;
  const dirHoriz = [dh[0]/Lh, dh[1]/Lh, dh[2]/Lh];
  const camPos = [
    origin[0] - dirHoriz[0]*50 + up[0]*3,
    origin[1] - dirHoriz[1]*50 + up[1]*3,
    origin[2] - dirHoriz[2]*50 + up[2]*3,
  ];
  // View center = angular bisector of (camera→observer) and (camera→ISS) so
  // the observer/ground sit in the lower frame and the ISS sits in the upper.
  // Aiming straight at the ISS would push the ground off the bottom edge.
  const toObs = [origin[0]-camPos[0], origin[1]-camPos[1], origin[2]-camPos[2]];
  const Lo = Math.hypot(...toObs);
  const toIss = [target[0]-camPos[0], target[1]-camPos[1], target[2]-camPos[2]];
  const Li = Math.hypot(...toIss);
  const sum = [
    toObs[0]/Lo + toIss[0]/Li,
    toObs[1]/Lo + toIss[1]/Li,
    toObs[2]/Lo + toIss[2]/Li,
  ];
  const Ls = Math.hypot(...sum);
  const aimUnit = [sum[0]/Ls, sum[1]/Ls, sum[2]/Ls];
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromElements(...camPos),
    orientation: {
      direction: Cesium.Cartesian3.fromElements(...aimUnit),
      up: Cesium.Cartesian3.fromElements(...up),
    },
    duration: 1.2,
    // Both endpoints sit a few meters above the surface. Cap the arc at
    // ~5000 ft so the camera rises gently rather than arcing up to several
    // km, which used to trigger Cesium's auto-pitch-adjust and made the
    // mid-flight view stare straight at the ground.
    maximumHeight: 15240, // 50,000 ft
  });
}

// Attempt picker (dropdown + new / download / delete + new-attempt
// form) migrated to components/triangulate/AttemptPicker.tsx. The
// picker writes through the store; we bridge those store writes
// back into the legacy `state` object here, then trigger the recompute
// ObservationsPanel lands and the bridge becomes unnecessary.
const _unsubBridge = useTriangulateStore.subscribe((s, prev) => {
  if (
    s.observations !== prev.observations ||
    s.timestampUTC !== prev.timestampUTC ||
    s.refractionEnabled !== prev.refractionEnabled
  ) {
    state.observations = s.observations;
    state.timestampUTC = s.timestampUTC;
    state.refractionEnabled = s.refractionEnabled;
    recompute();
  }
  if (s.currentAttemptId !== prev.currentAttemptId && s.currentAttemptId) {
    cameraCtrl.frameAll();
  }
});

// Wrap recompute so any edit persists to localStorage automatically.
// Persist FIRST (caller writes state before recompute) so a downstream
// throw in the render chain can't swallow the user's edit.
const _recomputeForPersist = recompute;
recompute = function () {
  const s = useTriangulateStore.getState();
  if (s.currentAttemptId && s.currentAttemptSource) {
    const formTle = currentTleFromForm();
    persistCurrent(
      s.currentAttemptId,
      s.currentAttemptSource,
      state.timestampUTC,
      state.observations,
      formTle,
    );
  }
  try {
    _recomputeForPersist();
  } catch (e) {
    console.error("recompute chain failed:", e);
  }
};

// Initial sync: store has the freshly-loaded attempt; mirror into
// `state` (still used by recompute + Cesium entity render) and fire
// the pipeline once.
{
  const s = useTriangulateStore.getState();
  state.observations = s.observations;
  state.timestampUTC = s.timestampUTC;
  state.refractionEnabled = s.refractionEnabled;
}
recompute();
cameraCtrl.frameAll(); // initial framing only; edits afterward leave the view alone

  return () => {
    _unsubTle();
    _unsubBridge();
    // viewer disposal is owned by useCesiumViewer's cleanup.
  };
}
