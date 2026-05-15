// pass-finder.js -- ISS multi-observer pass finder.

import { parseDmsToDecimal, geodeticToEcef } from "./coords.js";
import { geocodeOne } from "./pass-finder/geocode.js";
import { fetchIssTle } from "./pass-finder/tle.js";
import { isVisibleAtAll, issAltitudeDeg, issAltAzDeg, issIlluminated, sunAltitudeDeg } from "./pass-finder/visibility.js";
import { sunPositionEcef } from "./pass-finder/sun.js";
import { findVisibilityWindows } from "./pass-finder/search.js";
import { tleOrbitTrackEcef } from "./truth.js";
import { fetchCloudForecast, cloudAt } from "./pass-finder/weather.js";
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
// Pin label spans 1 line (just name + clouds) or 2 lines (when alt/az
// also appears), so use the worst-case 2-line height as the canonical
// reservation — small over-spacing for the 1-line case is fine.
const PIN_LABEL_W = 180, PIN_LABEL_H = 42;

// Candidate offset slots (added to a label's natural pixel position) tried
// in priority order. The first slot that doesn't collide with any
// previously-placed label wins, so most labels stay at their natural
// position and only conflicting ones get bumped to a small set of nearby
// alternates — keeps every label close to its anchor (no long stack
// drift like an always-down algorithm).
const PIN_CANDIDATES = [
  { dx: 0,    dy:   0 },   // natural (upper-right of pin)
  { dx: 0,    dy:  46 },
  { dx: 0,    dy: -46 },
  { dx: 0,    dy:  92 },
  { dx: 0,    dy: -92 },
  { dx: -204, dy:   0 },   // flip to upper-left of pin
  { dx: -204, dy:  46 },
  { dx: -204, dy: -46 },
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
    label: {
      // Pin label = observer name + current cloud cover on line 1, then
      // alt/az on line 2 whenever the ISS is currently visible from this
      // observer. Consolidated here so the user has one crisp single-
      // color label per observer instead of separate midpoint label
      // boxes that need to be decluttered against the pins.
      text: new Cesium.CallbackProperty((time) => {
        const ms = Cesium.JulianDate.toDate(time).getTime();
        const f = state.cloudForecasts.get(obs.id);
        const c = f ? cloudAt(f, ms) : null;
        const line1 = c == null ? obs.name : `${obs.name} · ${Math.round(c)}% clouds`;
        const d = Cesium.JulianDate.toDate(time);
        const issEcef = issEcefAt(d);
        if (issEcef && isVisibleAtAll([obs], issEcef, d)) {
          const { alt, az } = issAltAzDeg(obs, issEcef);
          const azStr = String(Math.round(az) % 360).padStart(3, "0");
          // Instantaneous magnitude for THIS observer at THIS moment —
          // changes through the pass as range and phase angle evolve.
          const m = magnitudeAt(obs, issEcef, sunPositionEcef(d));
          const magStr = m == null ? "" : `  m ${m.toFixed(1)}`;
          return `${line1}\nalt ${alt.toFixed(1)}°  az ${azStr}°${magStr}`;
        }
        return line1;
      }, false),
      show: new Cesium.CallbackProperty(
        () => isInFrontOfEarth(Cesium.Cartesian3.fromDegrees(lonDeg, latDeg, 0)),
        false,
      ),
      font: "12px sans-serif",
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.CallbackProperty(() => {
        const o = labelOffsets.get(`pin:${obs.id}`);
        if (!o) return new Cesium.Cartesian2(12, -10);
        return new Cesium.Cartesian2(12 + o.dx, -10 + o.dy);
      }, false),
      fillColor: Cesium.Color.fromCssColorString(color),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("rgba(10,14,26,0.7)"),
      backgroundPadding: new Cesium.Cartesian2(6, 4),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
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

function renderObsList() {
  obsListEl.replaceChildren();
  for (const obs of state.observers) {
    const card = document.createElement("div");
    card.className = "obs-card";
    const header = document.createElement("div");
    header.className = "obs-card-header";
    const swatch = document.createElement("span");
    swatch.className = "color-swatch";
    swatch.style.background = obs.color;
    header.appendChild(swatch);
    const nameSpan = document.createElement("span");
    nameSpan.textContent = obs.name;
    nameSpan.style.flex = "1";
    nameSpan.style.fontSize = "13px";
    nameSpan.style.fontWeight = "600";
    header.appendChild(nameSpan);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "remove";
    rm.textContent = "✕";
    rm.title = "Remove";
    rm.addEventListener("click", () => removeObserver(obs.id));
    header.appendChild(rm);
    card.appendChild(header);
    const coords = document.createElement("div");
    coords.style.fontFamily = "'SF Mono', 'Fira Code', monospace";
    coords.style.fontSize = "11px";
    coords.style.color = "#8899bb";
    coords.textContent = `${obs.latDeg.toFixed(4)}°, ${obs.lonDeg.toFixed(4)}°`;
    card.appendChild(coords);
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

function ratingColorAt(score) {
  const c = _interpRatingStop(score);
  return Cesium.Color.fromBytes(c.r, c.g, c.b);
}

// Blend a point-forecast clear probability with a neutral 0.5 by
// exponential skill decay. Day-1 forecasts are trusted almost fully;
// by day 4 we're ~37% direct, ~63% neutral; by day 10 we're nearly all
// neutral. tau = 4 days roughly matches deterministic-cloud skill
// decay for hourly forecasts.
function effectivePClear(cloudPct, ageDays) {
  if (cloudPct == null) return 0.5;
  const direct = Math.max(0, 1 - cloudPct / 100);
  if (ageDays <= 0) return direct;
  const skill = Math.exp(-ageDays / 4);
  return skill * direct + (1 - skill) * 0.5;
}

// Per-observer probability that this observer can capture ISS + ≥2
// reference stars at this instant. Three independent factors:
//   pDark  — sky dark enough for stars (sun altitude). Linear from
//            horizon (sun=0°) to nautical (sun=−12°), saturating at 1.
//            Camera-reality threshold: nautical twilight is dark enough
//            for sub-mag-3 stars in a short exposure.
//   pAlt   — ISS high enough to image cleanly (refraction-corrected
//            apparent altitude). 0 below ~5°, 1 by 30°.
//   pClear — Cloud forecast P(clear), blended toward a neutral 0.5 as
//            the forecast horizon stretches out (deterministic point
//            forecasts lose skill quickly past day 1-2).
// Returns 0 when the ISS isn't visible to this observer at all.
function captureProbForObserver(obs, issEcef, jsDate, ms, nowMs) {
  const apparentAlt = apparentAltDeg(issAltitudeDeg(obs, issEcef));
  if (apparentAlt < 5) return 0;
  const sunAlt = apparentAltDeg(sunAltitudeDeg(obs, jsDate));
  if (sunAlt >= 0) return 0; // sun still up — sky too bright
  const pDark = Math.min(1, -sunAlt / 12);
  const pAlt = Math.min(1, Math.max(0, (apparentAlt - 5) / 25));
  const cloudPct = cloudAt(state.cloudForecasts.get(obs.id), ms);
  const ageDays = (ms - nowMs) / 86_400_000;
  const pClear = effectivePClear(cloudPct, ageDays);
  return pDark * pAlt * pClear;
}

// Joint probability that EVERY observer succeeds at the same instant.
// Product across observers under the independent-cloud-cover assumption
// (true for sparsely-spaced observers; slightly optimistic when clusters
// of observers share the same cloud system, but the bias is small).
function captureProbJoint(observers, issEcef, jsDate, ms, nowMs) {
  let p = 1;
  for (const obs of observers) {
    p *= captureProbForObserver(obs, issEcef, jsDate, ms, nowMs);
    if (p === 0) return 0; // early-exit when any observer fails
  }
  return p;
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
  // Duration sigmoid: more discriminating than the previous +30
  // constant — 30s → 0.33 (yellow), 60s → 0.5 (yellow-green), 120s →
  // 0.67 (green), 240s → 0.80, so short passes don't auto-rate green
  // just because the geometry/cloud factors lined up.
  const durSec = totalMs / 1000;
  const pCoord = durSec / (durSec + 60);
  return best * pCoord;
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
  for (const label of ["", "Time (UTC)", "Sun", "Dur", "Alt", "Mag", "Clouds"]) {
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

    // Sun-altitude column — worst (highest = brightest sky) observer at
    // peak, refraction-corrected. Color is the SAME pDark score used in
    // the rating math: pDark = −sunAlt / 12, clamped to [0, 1]. Combined
    // with the gradient stops (yellow at 1/3, green at 2/3), that maps:
    //   sun =   0° → 0.00  red
    //   sun =  −4° → 0.33  yellow
    //   sun =  −6° → 0.50  yellow→green lime
    //   sun =  −8° → 0.67  green (saturated)
    //   sun = −12° → 1.00  green (saturated, pDark maxed out)
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
      sun.style.color = ratingCssColor(Math.max(0, Math.min(1, -worstSunAlt / 12)));
    } else {
      sun.classList.add("na");
    }
    row.appendChild(sun);

    // Duration column — color follows the coordination sigmoid
    // dur/(dur+60) on the shared red→yellow→green gradient. A 30s pass
    // shows yellow-orange (pCoord 0.33), 1m shows mid-yellow-green
    // (0.50), 2m hits green (0.67), 4m+ saturated. Tightened from a
    // previous +30 constant so short passes don't auto-rate green.
    const dur = document.createElement("span");
    dur.className = "dur";
    const mm = Math.floor(durSec / 60), ss = durSec % 60;
    dur.textContent = `${mm}m${ss < 10 ? "0" : ""}${ss}s`;
    dur.style.color = ratingCssColor(durSec / (durSec + 60));
    row.appendChild(dur);

    // Altitude range — color matches captureProbForObserver's pAlt ramp
    // (apparent altitude 5°→0, 30°→1) on the same gradient. The worst
    // observer's altitude drives the color since that's the binding
    // constraint on joint visibility.
    const alt = document.createElement("span");
    alt.className = "alt";
    const altLo = Math.round(minAlt), altHi = Math.round(maxAlt);
    alt.textContent = altLo === altHi ? `${altHi}°` : `${altLo}–${altHi}°`;
    alt.style.color = ratingCssColor(Math.max(0, Math.min(1, (apparentAltDeg(minAlt) - 5) / 25)));
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

    // Cloud cover range — colored continuously on the same gradient,
    // indexed by P(clear) = 1 − clHi/100 (worst-case cloud cover at peak
    // moment). 0% clouds → green, 50% → yellow-lime, 100% → red.
    const cl = document.createElement("span");
    cl.className = "cloud";
    if (cloud === null) {
      cl.textContent = "—";
      cl.classList.add("na");
    } else {
      const clLo = Math.round(cloud.min), clHi = Math.round(cloud.max);
      cl.textContent = clLo === clHi ? `${clHi}%` : `${clLo}–${clHi}%`;
      cl.style.color = ratingCssColor(1 - clHi / 100);
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
const cameraCtrl = wireCameraControls(viewer, {
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
    return ps;
  },
});
