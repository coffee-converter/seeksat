// lib/triangulate-bootstrap.js — wrap-and-mount port of legacy/app.js.
//
// Exports `initTriangulate(container)` — async, runs once after Cesium
// is loaded and TriangulateApp's JSX is mounted. The DOM element IDs
// referenced here MUST match what TriangulateApp.tsx renders (mirrors
// legacy/index.html). Pure imperative logic — React owns the mount
// lifecycle, this owns every DOM interaction inside.

import {
  raDecToEciDir,
  altAzToEnuDir,
  geodeticToEcef,
  gmstFromDate,
  eciToEcefRotate,
  enuToEcefRotate,
  parseDmsToDecimal,
  parseRaToHours,
  parseDecToDegrees,
} from "./coords.js";
import { triangulateRays } from "./triangulate.js";
import { lookupElev } from "./elevation.js";
import { correctRefraction } from "./refraction.js";
import { tlePositionEcef, tleOrbitTrackEcef } from "./truth.js";
import { makeViewer, wireSimTime } from "./cesium-viewer";
import { wireCameraControls } from "./camera-controls.js";
import { useTriangulateStore } from "./store";
import { pickTleLines } from "./tle-utils";
import {
  loadManifestAttempts,
  fetchAttemptData,
  pickInitialAttemptId,
  persistCurrent,
} from "./triangulate-attempts";
import { loadUserAttempts } from "./store";

const Cesium = typeof window !== "undefined" ? window.Cesium : undefined;

export async function initTriangulate(container) {
// Build the viewer without imagery — we install our own provider via the
// imagery-picker dropdown below.
const viewer = makeViewer(container, { imagery: false });

// No Cesium Ion auth — list of free imagery providers with no token required.
const IMAGERY_PROVIDERS = [
  { id: "esri-imagery",       label: "Esri Imagery (satellite)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    credit: "Tiles © Esri, Maxar, Earthstar Geographics", maximumLevel: 19 },
  { id: "esri-topo",          label: "Esri Topographic",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    credit: "Tiles © Esri", maximumLevel: 19 },
  { id: "esri-natgeo",        label: "Esri National Geographic",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
    credit: "Tiles © Esri, National Geographic", maximumLevel: 12 },
  { id: "esri-dark",          label: "Esri Dark Gray Canvas",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    credit: "Tiles © Esri", maximumLevel: 16 },
  { id: "esri-light",         label: "Esri Light Gray Canvas",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    credit: "Tiles © Esri", maximumLevel: 16 },
  { id: "osm",                label: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    credit: "© OpenStreetMap contributors", maximumLevel: 19 },
  { id: "carto-dark",         label: "CartoDB Dark Matter",
    url: "https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png",
    credit: "© CartoDB", maximumLevel: 19 },
  { id: "carto-voyager",      label: "CartoDB Voyager",
    url: "https://cartodb-basemaps-a.global.ssl.fastly.net/rastertiles/voyager/{z}/{x}/{y}.png",
    credit: "© CartoDB", maximumLevel: 19 },
];

function setImagery(id) {
  const p = IMAGERY_PROVIDERS.find(x => x.id === id) ?? IMAGERY_PROVIDERS[0];
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: p.url, credit: p.credit, maximumLevel: p.maximumLevel,
  }));
}

const imagerySelect = document.getElementById("imagery-select");
for (const p of IMAGERY_PROVIDERS) {
  const opt = document.createElement("option");
  opt.value = p.id;
  opt.textContent = p.label;
  imagerySelect.appendChild(opt);
}
imagerySelect.value = "esri-imagery";
imagerySelect.addEventListener("change", () => setImagery(imagerySelect.value));
setImagery("esri-imagery");

wireSimTime(viewer, { precision: 4 }); // observation timestamp has 4-decimal sub-seconds

window.__viewer = viewer; // for debugging in dev console
console.log("Cesium viewer ready");

// Pane toggle — slides #panel-observations off-screen via the
// .panel-collapsed body class (all visual changes are CSS-driven).
document.getElementById("panel-toggle").addEventListener("click", () => {
  document.body.classList.toggle("panel-collapsed");
});

// Attempt loading + persistence live in lib/triangulate-attempts.ts now.
// We pull the same shape of data here at boot, seed the Zustand store,
// and let AttemptPicker drive everything from there.
const manifestAttempts = await loadManifestAttempts();
const attemptsList = [...manifestAttempts, ...loadUserAttempts()];
const initialAttemptId = pickInitialAttemptId(attemptsList);
const initialAttemptEntry = attemptsList.find(a => a.id === initialAttemptId);
useTriangulateStore.getState().setAttempts(attemptsList);
if (initialAttemptEntry) {
  useTriangulateStore.getState().setCurrentAttempt(
    initialAttemptEntry.id, initialAttemptEntry.source,
  );
}
const initialData = await fetchAttemptData(initialAttemptEntry);
useTriangulateStore.getState().applyAttemptData(initialData);

// In-memory state.
const state = {
  timestampUTC: initialData.timestampUTC,
  observations: initialData.observations,
  triangulated: null, // [x,y,z] ECEF (meters)
  residuals: [],
  refractionEnabled: true,
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

const tsInput = document.getElementById("ts-utc");
const tsLocal = document.getElementById("ts-local");
const obsList = document.getElementById("obs-list");
const addBtn  = document.getElementById("add-obs");

function makeInput(field, value, attrs = {}) {
  const el = document.createElement("input");
  el.type = "text";
  el.dataset.field = field;
  el.value = String(value ?? "");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function makeField(labelText, child) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const lbl = document.createElement("span");
  lbl.className = "field-label";
  lbl.textContent = labelText;
  wrap.appendChild(lbl);
  wrap.appendChild(child);
  return wrap;
}

function makeRow(...children) {
  const row = document.createElement("div");
  row.className = "obs-row";
  for (const c of children) row.appendChild(c);
  return row;
}

function buildObsCard(obs, idx) {
  const card = document.createElement("div");
  card.className = "obs-card";
  card.dataset.idx = String(idx);

  // Header: swatch + name + delete. Tab order: name → lat → lon → …
  // (skip the ✕ button) so keyboarding through a new row goes through
  // the data fields. Delete stays clickable but tabindex=-1 takes it
  // out of the keyboard sequence.
  const header = document.createElement("div");
  header.className = "obs-card-header";
  const swatch = document.createElement("span");
  swatch.className = "color-swatch";
  swatch.style.background = obs.color;
  header.appendChild(swatch);
  header.appendChild(makeInput("name", obs.name));
  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "remove";
  rm.textContent = "✕";
  rm.title = "Remove observation";
  rm.tabIndex = -1;
  header.appendChild(rm);
  card.appendChild(header);

  // Mode <select>
  const sel = document.createElement("select");
  sel.dataset.field = "mode";
  for (const [val, label] of [["radec", "RA/Dec"], ["altaz", "Alt/Az"]]) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    if (obs.dir.mode === val) opt.selected = true;
    sel.appendChild(opt);
  }

  // null-friendly defaults: a brand-new observation has no values
  // for direction yet — show empty inputs rather than "0" zeros.
  const v1Source = obs.dir.mode === "radec" ? obs.dir.raHours : obs.dir.azDeg;
  const v2Source = obs.dir.mode === "radec" ? obs.dir.decDeg : obs.dir.altDeg;
  const v1Default = obs.rawV1 ?? (v1Source != null ? String(v1Source) : "");
  const v2Default = obs.rawV2 ?? (v2Source != null ? String(v2Source) : "");
  const v1Label = obs.dir.mode === "radec" ? "RA" : "Az";
  const v2Label = obs.dir.mode === "radec" ? "Dec" : "Alt";

  card.appendChild(makeRow(
    makeField("Lat", makeInput("lat", obs.rawLat ?? (obs.latDeg != null ? obs.latDeg : ""))),
    makeField("Lon", makeInput("lon", obs.rawLon ?? (obs.lonDeg != null ? obs.lonDeg : ""))),
    makeField("Elev (m)", makeInput("elev", obs.elevM == null ? "" : obs.elevM)),
  ));
  const dirRow = makeRow(
    makeField("Mode", sel),
    makeField(v1Label, makeInput("v1", v1Default)),
    makeField(v2Label, makeInput("v2", v2Default)),
  );
  dirRow.classList.add("mode-row");
  card.appendChild(dirRow);

  return card;
}

// Guard against re-entrant reparseObsFromDom calls that the DOM
// rebuild can trigger. When replaceChildren removes a focused input,
// that input fires a synchronous `change` event mid-removal; if it
// bubbles to obsList's listener while DOM is partially empty, the
// reparse will see fewer rows than state and shrink state.observations
// to that shorter length. Setting a flag skips reparses for the
// duration of the rebuild — state stays the authoritative source.
let _suppressReparse = false;
function renderObsList() {
  _suppressReparse = true;
  try {
    obsList.replaceChildren(...state.observations.map(buildObsCard));
  } finally {
    _suppressReparse = false;
  }
  renderFromObserverButtons();
}

function renderTimestampLocal() {
  const d = new Date(state.timestampUTC);
  tsLocal.textContent = Number.isNaN(d.getTime())
    ? "(invalid)"
    : "(" + d.toLocaleString() + ")";
}

function reparseObsFromDom() {
  if (_suppressReparse) return;
  const rows = [...obsList.querySelectorAll(".obs-card")];
  // Always preserve a slot per DOM row. When a field fails to parse,
  // keep the previous state's value for that field — so partial
  // typing doesn't drop the whole row, and the form keeps what the
  // user typed (rendered via the rawV1/rawV2/rawLat/rawLon fields).
  const next = rows.map((tr, idx) => {
    const prev = state.observations[idx] || {};
    const get = (n) => tr.querySelector(`[data-field=${n}]`).value;
    const mode = get("mode");
    const v1 = get("v1");
    const v2 = get("v2");
    let dir = prev.dir;
    try {
      if (mode === "radec") {
        dir = { mode, raHours: parseRaToHours(v1), decDeg: parseDecToDegrees(v2) };
      } else {
        dir = { mode, azDeg: parseDmsToDecimal(v1), altDeg: parseDmsToDecimal(v2) };
      }
    } catch (e) {
      // Keep prev.dir while user finishes typing; warn but don't drop.
      if (v1 || v2) console.warn(`Observation ${idx}: bad direction (${e.message})`);
    }
    let latDeg = prev.latDeg ?? null;
    let lonDeg = prev.lonDeg ?? null;
    try {
      latDeg = parseDmsToDecimal(get("lat"));
      lonDeg = parseDmsToDecimal(get("lon"));
    } catch (e) {
      if (get("lat") || get("lon")) console.warn(`Observation ${idx}: bad lat/lon (${e.message})`);
    }
    return {
      id: prev.id || `obs-${Date.now()}-${idx}`,
      name: get("name") || `Obs ${idx + 1}`,
      color: prev.color || PALETTE[idx % PALETTE.length],
      latDeg, lonDeg,
      elevM: get("elev").trim() === "" ? null : (Number(get("elev")) || 0),
      dir,
      rawLat: get("lat"), rawLon: get("lon"),
      rawV1: v1, rawV2: v2,
    };
  });

  state.observations = next;
  state.timestampUTC = tsInput.value;
  renderTimestampLocal();
  // Refresh the "From <name>" camera buttons so renames in the obs-list
  // propagate immediately. Cheap DOM mutation that doesn't touch state.
  renderFromObserverButtons();
  // Always recompute — even with 0 or 1 obs, so clearLayer() wipes
  // any stale rays / triangulated point from a previous state. The
  // function itself bails out before triangulating when there aren't
  // enough rays.
  recompute();
}

obsList.addEventListener("input", reparseObsFromDom);
obsList.addEventListener("change", reparseObsFromDom);
tsInput.addEventListener("input", reparseObsFromDom);

const refractionCheckbox = document.getElementById("opt-refraction");
refractionCheckbox.addEventListener("change", () => {
  state.refractionEnabled = refractionCheckbox.checked;
  recompute();
});

obsList.addEventListener("click", (ev) => {
  if (ev.target.classList && ev.target.classList.contains("remove")) {
    const idx = Number(ev.target.closest(".obs-card").dataset.idx);
    state.observations.splice(idx, 1);
    renderObsList();
    // Always recompute so clearLayer wipes the removed observer's
    // dot/label/ray even when fewer than 2 observers remain (the
    // function itself bails before triangulating).
    recompute();
  }
});

addBtn.addEventListener("click", () => {
  // Capture whatever the user has typed in existing rows BEFORE we
  // wipe + rebuild the DOM — otherwise typing in row 0 and then
  // clicking +Add would lose row 0's edits.
  reparseObsFromDom();
  const idx = state.observations.length;
  state.observations.push({
    id: `obs-${Date.now()}-${idx}`,
    name: `Obs ${idx + 1}`,
    color: PALETTE[idx % PALETTE.length],
    latDeg: null, lonDeg: null,
    // mode is fixed (the <select> needs it) but values stay absent
    // so the form inputs start empty rather than showing "0".
    dir: { mode: "radec" },
  });
  renderObsList();
});

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

// Seed the store from the attempt's defaultTle. Replaces the legacy
// imperative applyDefaultTle that mutated textareas.
function applyDefaultTle(defaultTle) {
  const store = useTriangulateStore.getState();
  if (defaultTle) {
    store.setTle({
      name: defaultTle.name ?? "",
      line1: defaultTle.line1 ?? "",
      line2: defaultTle.line2 ?? "",
    });
  } else {
    store.clearTle();
  }
}
applyDefaultTle(initialData.defaultTle);

// Any TLE change in the store (typing in the form, Fetch, Clear,
// attempt switch) re-runs the recompute chain so renderTruth picks
// up the new lines and persistCurrent saves them.
useTriangulateStore.subscribe((s, prev) => {
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
    // "from-<idx>" buttons are generated by renderFromObserverButtons
    // below and routed here. The data-cam attribute carries the idx.
    "from-observer": (btn) => {
      const idx = Number(btn.dataset.obsIdx);
      if (Number.isFinite(idx)) viewFromObserver(idx);
    },
  },
});

// Rebuild the per-observation "From <name>" buttons in the camera nav.
// Called from renderObsList so the buttons stay in sync with whatever
// the user has named / added / removed.
const fromObserverSlot = document.getElementById("from-observer-slot");
function renderFromObserverButtons() {
  fromObserverSlot.replaceChildren();
  for (let i = 0; i < state.observations.length; i++) {
    const obs = state.observations[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.cam = "from-observer";
    btn.dataset.obsIdx = String(i);
    btn.textContent = `From ${obs.name || `Obs ${i + 1}`}`;
    btn.title = `View from ${obs.name || `Obs ${i + 1}`} along their direction to the triangulated point`;
    fromObserverSlot.appendChild(btn);
  }
}

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
// back into the imperative DOM (obs-list + tsInput) here until
// ObservationsPanel lands and the bridge becomes unnecessary.
useTriangulateStore.subscribe((s, prev) => {
  if (
    s.observations !== prev.observations ||
    s.timestampUTC !== prev.timestampUTC
  ) {
    state.observations = s.observations;
    state.timestampUTC = s.timestampUTC;
    if (tsInput.value !== state.timestampUTC) tsInput.value = state.timestampUTC;
    renderObsList();
    renderTimestampLocal();
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

renderObsList();
tsInput.value = state.timestampUTC; // show the precise value from data file
renderTimestampLocal();
recompute();
cameraCtrl.frameAll(); // initial framing only; edits afterward leave the view alone

  return () => {
    try { viewer.destroy(); } catch (_) { /* ignore */ }
  };
}
