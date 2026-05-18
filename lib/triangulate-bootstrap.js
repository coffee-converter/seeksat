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

// Triangulation attempts come from two sources:
//   - Manifest (data/attempts.json) — read-only, ships with the site.
//     Each entry: { id, label, file }.
//   - User-created — stored in localStorage under USER_ATTEMPTS_KEY,
//     fully editable, downloadable as JSON so the user can commit
//     them to data/ later. Each entry: { id, label, timestampUTC,
//     observations, defaultTle?, createdAt }.
// The dropdown shows the combined list with manifest entries first.
async function loadManifestAttempts() {
  try {
    const m = await fetch("/data/attempts.json").then(r => r.json());
    return m.map(a => ({ ...a, source: "manifest" }));
  } catch (_) {
    return [{ id: "monday", label: "Monday", file: "monday.json", source: "manifest" }];
  }
}
const USER_ATTEMPTS_KEY = "triangulation-user-attempts";
const MANIFEST_OVERRIDES_KEY = "triangulation-manifest-overrides";

// Browser-local edits to read-only manifest attempts go here. The
// next time the page loads, switchAttempt overlays these on top of
// the JSON fetched from data/. Cleared by the manifest attempt's
// "reset" affordance.
function loadManifestOverrides() {
  try { return JSON.parse(localStorage.getItem(MANIFEST_OVERRIDES_KEY) || "{}"); }
  catch (_) { return {}; }
}
function saveManifestOverride(id, data) {
  const all = loadManifestOverrides();
  all[id] = data;
  localStorage.setItem(MANIFEST_OVERRIDES_KEY, JSON.stringify(all));
}
function loadUserAttempts() {
  try {
    const raw = localStorage.getItem(USER_ATTEMPTS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.map(a => ({ ...a, source: "user" })) : [];
  } catch (_) {
    return [];
  }
}
function saveUserAttempts(list) {
  // Drop transient source: flag before serializing — it's derived.
  const serializable = list.map(({ source: _src, ...rest }) => rest);
  localStorage.setItem(USER_ATTEMPTS_KEY, JSON.stringify(serializable));
}
function persistUserAttempt(attempt) {
  const users = loadUserAttempts();
  const idx = users.findIndex(a => a.id === attempt.id);
  const entry = { ...attempt };
  delete entry.source;
  if (idx >= 0) users[idx] = entry;
  else users.push(entry);
  saveUserAttempts(users);
}
function deleteUserAttempt(id) {
  saveUserAttempts(loadUserAttempts().filter(a => a.id !== id));
}

const manifestAttempts = await loadManifestAttempts();
const attemptsList = [...manifestAttempts, ...loadUserAttempts()];

function pickInitialAttemptId() {
  const hash = (location.hash || "").replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const id = params.get("attempt");
  return attemptsList.find(a => a.id === id)?.id
    ?? attemptsList[0]?.id
    ?? null;
}
const initialAttemptId = pickInitialAttemptId();
const initialAttemptEntry = attemptsList.find(a => a.id === initialAttemptId);
let currentAttemptId = initialAttemptId;
let currentAttemptSource = initialAttemptEntry?.source ?? "manifest";

async function fetchAttemptData(entry) {
  if (!entry) return { timestampUTC: "", observations: [] };
  if (entry.source === "user") {
    const users = loadUserAttempts();
    const u = users.find(a => a.id === entry.id);
    return u ? { ...u } : { timestampUTC: "", observations: [] };
  }
  // Manifest: start from the data/ file, then overlay any browser-
  // local override so user edits survive page reloads. defaultTle is
  // tristate in the override: undefined → keep file value; null →
  // user explicitly cleared; object → user-edited TLE.
  const fileData = await fetch(`/data/${entry.file}`).then(r => r.json());
  const override = loadManifestOverrides()[entry.id];
  if (override) {
    return {
      ...fileData,
      timestampUTC: override.timestampUTC ?? fileData.timestampUTC,
      observations: override.observations ?? fileData.observations,
      defaultTle: override.defaultTle !== undefined
        ? override.defaultTle
        : fileData.defaultTle,
    };
  }
  return fileData;
}
const initialData = await fetchAttemptData(initialAttemptEntry);

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

const elTri = document.getElementById("result-triangulated");
const elSlant = document.getElementById("result-slant");
const elRes = document.getElementById("result-residuals");

function setBlock(el, headerText, lines) {
  el.replaceChildren();
  const hdr = document.createElement("span");
  hdr.className = "label";
  hdr.textContent = headerText;
  el.appendChild(hdr);
  for (const line of lines) {
    el.appendChild(document.createTextNode("\n" + line));
  }
}

function renderResultPanel() {
  if (!state.triangulated) {
    elTri.textContent = "Need >= 2 valid observations.";
    elSlant.textContent = "";
    elRes.textContent = "";
    return;
  }
  const cart = Cesium.Cartographic.fromCartesian(
    Cesium.Cartesian3.fromElements(...state.triangulated)
  );
  const latDeg = Cesium.Math.toDegrees(cart.latitude);
  const lonDeg = Cesium.Math.toDegrees(cart.longitude);
  const altKm  = cart.height / 1000;
  setBlock(elTri, "Triangulated", [
    `lat  ${latDeg.toFixed(5)}°`,
    `lon  ${lonDeg.toFixed(5)}°`,
    `alt  ${altKm.toFixed(2)} km above WGS84`,
  ]);

  const slantLines = state.observations.map((obs) => {
    const o = geodeticToEcef(obs.latDeg, obs.lonDeg, obs.elevM || 0);
    const d = Math.hypot(
      state.triangulated[0] - o[0],
      state.triangulated[1] - o[1],
      state.triangulated[2] - o[2],
    );
    return `${obs.name.padEnd(10)} ${(d / 1000).toFixed(2)} km`;
  });
  setBlock(elSlant, "Slant range", slantLines);

  const lines = state.residuals.map((r, i) => {
    const name = state.observations[i]?.name ?? `Obs ${i}`;
    return `${name.padEnd(10)} ${(r / 1000).toFixed(3)} km`;
  });
  setBlock(elRes, "Per-ray residuals", lines);
}

// Compose renderResultPanel onto recompute.
const _recompute1 = recompute;
recompute = function () {
  _recompute1();
  renderResultPanel();
};

const tleL1 = document.getElementById("tle-line1");
const tleL2 = document.getElementById("tle-line2");
const tleL3 = document.getElementById("tle-line3");
const elTruth = document.getElementById("result-truth");

const truthLayer = { entity: null, miss: null, orbit: null };

function clearTruthLayer() {
  if (truthLayer.entity) viewer.entities.remove(truthLayer.entity);
  if (truthLayer.miss) viewer.entities.remove(truthLayer.miss);
  if (truthLayer.orbit) viewer.entities.remove(truthLayer.orbit);
  truthLayer.entity = null;
  truthLayer.miss = null;
  truthLayer.orbit = null;
}

function pickTleLines() {
  const l1 = tleL1.value.trim();
  const l2 = tleL2.value.trim();
  const l3 = tleL3.value.trim();
  if (l1.startsWith("1 ") && l2.startsWith("2 ")) return [l1, l2];
  if (l2.startsWith("1 ") && l3.startsWith("2 ")) return [l2, l3];
  return null;
}

function renderTruth() {
  clearTruthLayer();
  elTruth.textContent = "";
  state.truthPos = null;
  const lines = pickTleLines();
  if (!lines) return;
  const [line1, line2] = lines;

  let pos;
  try {
    pos = tlePositionEcef(line1, line2, new Date(state.timestampUTC));
  } catch (e) {
    elTruth.textContent = `TLE error: ${e.message}`;
    return;
  }
  if (!pos) {
    elTruth.textContent = "TLE propagation returned no position.";
    return;
  }
  state.truthPos = pos;

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
      text: `TLE: ${tleL1.value.trim() || "Truth"}`,
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
    const cart = Cesium.Cartographic.fromCartesian(
      Cesium.Cartesian3.fromElements(...pos)
    );
    const tleName = tleL1.value.trim() || "TLE";
    setBlock(elTruth, `TLE: ${tleName}`, [
      `lat  ${Cesium.Math.toDegrees(cart.latitude).toFixed(5)}°`,
      `lon  ${Cesium.Math.toDegrees(cart.longitude).toFixed(5)}°`,
      `alt  ${(cart.height / 1000).toFixed(2)} km`,
      `Δ    ${(miss / 1000).toFixed(2)} km`,
    ]);
  }
}

// Read the TLE form into the JSON shape stored on disk / in attempts.
// Returns null when all three textareas are empty — that distinguishes
// "user cleared the TLE" from "TLE was never set".
function currentTleFromForm() {
  const name = tleL1.value.trim();
  const line1 = tleL2.value.trim();
  const line2 = tleL3.value.trim();
  if (!name && !line1 && !line2) return null;
  return { name, line1, line2 };
}

const tleFetchBtn = document.getElementById("tle-fetch");
const tleClearBtn = document.getElementById("tle-clear");
const tleWarnEl = document.getElementById("tle-warn");

function updateTleControlsState() {
  const hasContent = !!(tleL1.value.trim() || tleL2.value.trim() || tleL3.value.trim());
  tleFetchBtn.disabled = hasContent;
  tleFetchBtn.title = hasContent
    ? "Clear TLE fields first to refetch"
    : "Fetch the current ISS TLE from CelesTrak";
  tleClearBtn.disabled = !hasContent;
  // Warning: CelesTrak only serves the current TLE, so if the attempt
  // is from more than a day ago, fetched values won't match that pass.
  const ms = new Date(state.timestampUTC).getTime();
  const ageHours = Number.isFinite(ms) ? (Date.now() - ms) / 3_600_000 : 0;
  if (!hasContent && ageHours > 24) {
    tleWarnEl.hidden = false;
    tleWarnEl.textContent = `⚠ ${Math.round(ageHours)}h ago — current TLE won't match`;
  } else {
    tleWarnEl.hidden = true;
  }
}

[tleL1, tleL2, tleL3].forEach(el => el.addEventListener("input", () => {
  updateTleControlsState();
  // Run renderTruth + persistCurrent through the recompute chain so
  // edits to the TLE form are saved alongside everything else.
  recompute();
}));

tleClearBtn.addEventListener("click", () => {
  tleL1.value = "";
  tleL2.value = "";
  tleL3.value = "";
  updateTleControlsState();
  recompute();
});

tleFetchBtn.addEventListener("click", async () => {
  // Guard against double-clicks while the request is in flight.
  if (tleFetchBtn.disabled) return;
  const prevLabel = tleFetchBtn.textContent;
  tleFetchBtn.disabled = true;
  tleFetchBtn.textContent = "Fetching…";
  try {
    const url = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CelesTrak HTTP ${res.status}`);
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 3) throw new Error("malformed TLE response");
    tleL1.value = lines[0].trim();
    tleL2.value = lines[1].trim();
    tleL3.value = lines[2].trim();
  } catch (e) {
    alert(`Couldn't fetch latest TLE: ${e.message}`);
  } finally {
    tleFetchBtn.textContent = prevLabel;
    updateTleControlsState();
    recompute();
  }
});

// Pre-fill TLE inputs from the loaded attempt. switchAttempt() below
// mirrors this when the user picks a different attempt from the
// dropdown — passing null clears the form so a stale TLE from one
// attempt can't bleed into the next.
function applyDefaultTle(defaultTle) {
  if (defaultTle) {
    tleL1.value = defaultTle.name ?? "";
    tleL2.value = defaultTle.line1 ?? "";
    tleL3.value = defaultTle.line2 ?? "";
  } else {
    tleL1.value = "";
    tleL2.value = "";
    tleL3.value = "";
  }
  updateTleControlsState();
}
applyDefaultTle(initialData.defaultTle);

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

// Populate the attempt-picker dropdown from the manifest + user
// list, and wire switching, creating, downloading, and deleting.
// Selecting a different attempt fetches its data, swaps state,
// re-renders observations + result, applies the TLE if the entry
// carries one, and reframes the camera. The URL hash is kept in
// sync so the choice is deep-linkable / shareable.
const attemptSelect = document.getElementById("attempt-select");
const attemptNewBtn = document.getElementById("attempt-new");
const attemptDownloadBtn = document.getElementById("attempt-download");
const attemptDeleteBtn = document.getElementById("attempt-delete");
const attemptNewForm = document.getElementById("attempt-new-form");

function repopulateAttemptSelect(activeId) {
  attemptSelect.replaceChildren();
  const combined = [...manifestAttempts, ...loadUserAttempts()];
  for (const a of combined) {
    const opt = document.createElement("option");
    opt.value = a.id;
    // Mark user-created entries so they read as distinct from the
    // read-only manifest ones.
    opt.textContent = a.source === "user" ? `${a.label}  (local)` : a.label;
    attemptSelect.appendChild(opt);
  }
  if (activeId) attemptSelect.value = activeId;
  // Download is always available — covers both built-in and user
  // attempts (exports current state). Delete is only for user-
  // created entries (built-ins can't be removed; they're in data/).
  const active = combined.find(a => a.id === attemptSelect.value);
  const isUser = active?.source === "user";
  attemptDownloadBtn.hidden = !active;
  attemptDeleteBtn.hidden = !isUser;
}

async function switchAttempt(id) {
  const combined = [...manifestAttempts, ...loadUserAttempts()];
  const entry = combined.find(a => a.id === id);
  if (!entry) return;
  const data = await fetchAttemptData(entry);
  state.timestampUTC = data.timestampUTC ?? "";
  state.observations = data.observations ?? [];
  // Update active-attempt pointers BEFORE the render/recompute pass —
  // recompute fires persistCurrent, which keys on currentAttemptId.
  // If we updated those AFTER recompute, switching A→B would persist
  // B's just-loaded data under A's id and corrupt both records.
  currentAttemptId = id;
  currentAttemptSource = entry.source;
  applyDefaultTle(data.defaultTle);
  tsInput.value = state.timestampUTC;
  renderTimestampLocal();
  renderObsList();
  recompute();
  cameraCtrl.frameAll();
  attemptDownloadBtn.hidden = false;
  attemptDeleteBtn.hidden = entry.source !== "user";
  history.replaceState(null, "", `#attempt=${id}`);
}

attemptSelect.addEventListener("change", () => switchAttempt(attemptSelect.value));

// Persist current state back to localStorage after any edit. User
// attempts write the full record; manifest attempts write a partial
// override that overlays the data/ file on next load. Called by the
// recompute wrap below.
function persistCurrent() {
  if (!currentAttemptId) return;
  const formTle = currentTleFromForm();
  if (currentAttemptSource === "user") {
    const users = loadUserAttempts();
    const existing = users.find(a => a.id === currentAttemptId) ?? {};
    persistUserAttempt({
      id: currentAttemptId,
      label: existing.label ?? "Untitled",
      createdAt: existing.createdAt ?? new Date().toISOString(),
      timestampUTC: state.timestampUTC,
      observations: state.observations,
      defaultTle: formTle,
    });
  } else {
    saveManifestOverride(currentAttemptId, {
      timestampUTC: state.timestampUTC,
      observations: state.observations,
      defaultTle: formTle,
    });
  }
}

// ---- New-attempt form -----------------------------------------------
attemptNewBtn.addEventListener("click", () => {
  attemptNewForm.hidden = !attemptNewForm.hidden;
  if (!attemptNewForm.hidden) {
    document.getElementById("af-label").value = "";
    // Pre-fill UTC with current ISO timestamp for convenience.
    document.getElementById("af-utc").value = new Date().toISOString();
    document.getElementById("af-copy").checked = false;
    document.getElementById("af-label").focus();
  }
});
document.getElementById("af-cancel").addEventListener("click", () => {
  attemptNewForm.hidden = true;
});
attemptNewForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const label = document.getElementById("af-label").value.trim();
  const utc = document.getElementById("af-utc").value.trim();
  const copy = document.getElementById("af-copy").checked;
  if (!label) return;
  // Generate a stable, URL-safe id. Slug from label + short timestamp
  // suffix avoids collisions when two attempts share a label.
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const id = `user-${slug || "attempt"}-${Date.now().toString(36)}`;
  const observations = copy ? JSON.parse(JSON.stringify(state.observations)) : [];
  // Reassign observation ids so the new attempt doesn't share rows
  // with the source — otherwise editing one would update both via
  // the obs-card's id-keyed DOM lookup.
  for (const o of observations) o.id = `obs-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  persistUserAttempt({
    id, label,
    timestampUTC: utc,
    observations,
    createdAt: new Date().toISOString(),
  });
  repopulateAttemptSelect(id);
  attemptNewForm.hidden = true;
  await switchAttempt(id);
});

// ---- Download JSON --------------------------------------------------
// Exports CURRENT state (timestampUTC + observations + the active
// attempt's defaultTle if any) regardless of source — that's the
// natural "save my edits to disk" affordance for both built-in and
// user-created attempts.
attemptDownloadBtn.addEventListener("click", () => {
  const combined = [...manifestAttempts, ...loadUserAttempts()];
  const entry = combined.find(a => a.id === currentAttemptId);
  if (!entry) return;
  // Always pull the TLE from the live form so the JSON reflects the
  // exact state the user is looking at, regardless of source.
  const defaultTle = currentTleFromForm();
  const exported = {
    timestampUTC: state.timestampUTC,
    observations: state.observations,
    ...(defaultTle ? { defaultTle } : {}),
  };
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = (entry.label || "attempt").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  a.href = url;
  a.download = `${slug || "attempt"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// ---- Delete attempt -------------------------------------------------
attemptDeleteBtn.addEventListener("click", () => {
  if (currentAttemptSource !== "user") return;
  if (!confirm(`Delete this attempt? (browser-local only — won't touch data/)`)) return;
  deleteUserAttempt(currentAttemptId);
  // Switch to first remaining attempt.
  const combined = [...manifestAttempts, ...loadUserAttempts()];
  const nextId = combined[0]?.id;
  repopulateAttemptSelect(nextId);
  if (nextId) switchAttempt(nextId);
});

repopulateAttemptSelect(initialAttemptId);

// Wrap recompute so any user-attempt edit persists automatically.
// Persist FIRST (state is set by the caller before recompute runs),
// so a downstream throw inside the triangulation/render chain can't
// swallow the user's edit. Try/catch keeps the page alive if the
// triangulation does throw.
const _recomputeForPersist = recompute;
recompute = function () {
  persistCurrent();
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
