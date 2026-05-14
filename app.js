// app.js -- bootstrap CesiumJS viewer.
//
// Ion access token: Cesium ships with a free default development token that
// works locally. To use your own token (higher quota, custom imagery), set
// it here:
//   Cesium.Ion.defaultAccessToken = "...";

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
import { makeViewer, wireSimTime } from "./viewer-setup.js";
import { wireCameraControls } from "./camera-controls.js";

const Cesium = window.Cesium;

// Build the viewer without imagery — we install our own provider via the
// imagery-picker dropdown below.
const viewer = makeViewer("cesium-container", { imagery: false });

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

const monday = await fetch("./data/monday.json").then(r => r.json());

// In-memory state.
const state = {
  timestampUTC: monday.timestampUTC,
  observations: monday.observations,
  triangulated: null, // [x,y,z] ECEF (meters)
  residuals: [],
  refractionEnabled: false,
};

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

let recompute = function () {
  for (const obs of state.observations) ensureElev(obs);
  clearLayer();
  const jsDate = new Date(state.timestampUTC);
  if (Number.isNaN(jsDate.getTime()) || state.observations.length < 2) {
    state.triangulated = null;
    state.residuals = [];
    return;
  }
  // Pin the Cesium clock to the observation moment so the skybox stars
  // (rendered in ICRF) align with the actual sky for that timestamp.
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(jsDate);
  const rays = state.observations.map(o => buildRay(o, jsDate));
  const result = triangulateRays(rays);
  state.triangulated = result.point;
  state.residuals = result.residuals;

  // Observer pins — anchor at sea level (elev 0) so the dot sits on the
  // rendered globe surface (Cesium's ellipsoid imagery has no 3D terrain).
  // Math still uses the observer's real elevation for the ray direction.
  for (const obs of state.observations) {
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

  // Rays as polylines extending past the triangulated point.
  const refOrigin = rays[0].origin;
  const rayLength = state.triangulated
    ? 2 * Math.hypot(
        state.triangulated[0] - refOrigin[0],
        state.triangulated[1] - refOrigin[1],
        state.triangulated[2] - refOrigin[2],
      )
    : 1_000_000;

  for (let i = 0; i < rays.length; i++) {
    const { origin, dir } = rays[i];
    const obs = state.observations[i];
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

  // Header: swatch + name + delete
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

  const v1Default = obs.dir.mode === "radec"
    ? (obs.rawV1 ?? String(obs.dir.raHours))
    : (obs.rawV1 ?? String(obs.dir.azDeg));
  const v2Default = obs.dir.mode === "radec"
    ? (obs.rawV2 ?? String(obs.dir.decDeg))
    : (obs.rawV2 ?? String(obs.dir.altDeg));
  const v1Label = obs.dir.mode === "radec" ? "RA" : "Az";
  const v2Label = obs.dir.mode === "radec" ? "Dec" : "Alt";

  card.appendChild(makeRow(
    makeField("Lat", makeInput("lat", obs.rawLat ?? obs.latDeg)),
    makeField("Lon", makeInput("lon", obs.rawLon ?? obs.lonDeg)),
    makeField("Elev", makeInput("elev", obs.elevM == null ? "" : obs.elevM)),
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

function renderObsList() {
  obsList.replaceChildren(...state.observations.map(buildObsCard));
}

function renderTimestampLocal() {
  const d = new Date(state.timestampUTC);
  tsLocal.textContent = Number.isNaN(d.getTime())
    ? "(invalid)"
    : "(" + d.toLocaleString() + ")";
}

function reparseObsFromDom() {
  const rows = [...obsList.querySelectorAll(".obs-card")];
  const next = rows.map((tr, idx) => {
    const prev = state.observations[idx] || {};
    const get = (n) => tr.querySelector(`[data-field=${n}]`).value;
    const mode = get("mode");
    const v1 = get("v1");
    const v2 = get("v2");
    let dir;
    try {
      if (mode === "radec") {
        dir = { mode, raHours: parseRaToHours(v1), decDeg: parseDecToDegrees(v2) };
      } else {
        dir = { mode, azDeg: parseDmsToDecimal(v1), altDeg: parseDmsToDecimal(v2) };
      }
    } catch (e) {
      console.warn(`Observation ${idx}: bad direction (${e.message})`);
      return null;
    }
    let latDeg, lonDeg;
    try {
      latDeg = parseDmsToDecimal(get("lat"));
      lonDeg = parseDmsToDecimal(get("lon"));
    } catch (e) {
      console.warn(`Observation ${idx}: bad lat/lon (${e.message})`);
      return null;
    }
    return {
      id: prev.id || `obs-${idx}`,
      name: get("name") || `Obs ${idx + 1}`,
      color: prev.color || PALETTE[idx % PALETTE.length],
      latDeg, lonDeg,
      elevM: get("elev").trim() === "" ? null : (Number(get("elev")) || 0),
      dir,
      rawLat: get("lat"), rawLon: get("lon"),
      rawV1: v1, rawV2: v2,
    };
  }).filter(Boolean);

  if (next.length >= 2) {
    state.observations = next;
    state.timestampUTC = tsInput.value;
    renderTimestampLocal();
    recompute();
  }
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
    if (state.observations.length >= 2) recompute();
  }
});

addBtn.addEventListener("click", () => {
  const idx = state.observations.length;
  state.observations.push({
    id: `obs-${Date.now()}-${idx}`,
    name: `Obs ${idx + 1}`,
    color: PALETTE[idx % PALETTE.length],
    latDeg: 0, lonDeg: 0,
    dir: { mode: "radec", raHours: 0, decDeg: 0 },
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

import { tlePositionEcef, tleOrbitTrackEcef } from "./truth.js";

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
      text: "Truth (TLE)",
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
    setBlock(elTruth, "Truth (TLE)", [
      `lat  ${Cesium.Math.toDegrees(cart.latitude).toFixed(5)}°`,
      `lon  ${Cesium.Math.toDegrees(cart.longitude).toFixed(5)}°`,
      `alt  ${(cart.height / 1000).toFixed(2)} km`,
      `Δ    ${(miss / 1000).toFixed(2)} km`,
    ]);
  }
}

[tleL1, tleL2, tleL3].forEach(el => el.addEventListener("input", renderTruth));

// Pre-fill TLE inputs from data/monday.json so the truth overlay + orbit
// track render alongside the pre-filled observation on first load.
if (monday.defaultTle) {
  tleL1.value = monday.defaultTle.name ?? "";
  tleL2.value = monday.defaultTle.line1 ?? "";
  tleL3.value = monday.defaultTle.line2 ?? "";
  document.getElementById("tle-details").open = true;
}

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
  getFramePositions: () => {
    const ps = state.observations.map(o =>
      Cesium.Cartesian3.fromDegrees(o.lonDeg, o.latDeg, o.elevM || 0));
    if (state.triangulated) ps.push(Cesium.Cartesian3.fromElements(...state.triangulated));
    return ps;
  },
  getTopDownCenter: () => state.triangulated
    ? Cesium.Cartesian3.fromElements(...state.triangulated)
    : null,
  topDownAltitude: () => 2_000_000,
  beforePreset: () => { if (layer.observers.length) setObserverVisibility(-1); },
  extraHandlers: {
    coffee:  () => viewFromObserver(0),
    seafoam: () => viewFromObserver(1),
  },
});

function setObserverVisibility(hiddenIdx) {
  for (let i = 0; i < layer.observers.length; i++) {
    layer.observers[i].show = (i !== hiddenIdx);
  }
}

function viewFromObserver(idx) {
  const obs = state.observations[idx];
  if (!obs || !state.triangulated) return;
  // Keep all observers visible — camera sits 50 m behind the observer so the
  // pin/label is in the foreground rather than blocking the lens.
  const origin = geodeticToEcef(obs.latDeg, obs.lonDeg, obs.elevM || 0);
  const target = state.triangulated;
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

renderObsList();
tsInput.value = state.timestampUTC; // show the precise value from data file
renderTimestampLocal();
recompute();
cameraCtrl.frameAll(); // initial framing only; edits afterward leave the view alone
