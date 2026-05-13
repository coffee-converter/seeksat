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

const Cesium = window.Cesium;

const viewer = new Cesium.Viewer("cesium-container", {
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  shouldAnimate: true, // needed for CallbackProperty animations later
});

// Photoreal Earth defaults are already on; turn on stars + atmosphere + lighting explicitly.
viewer.scene.skyBox.show = true;
viewer.scene.skyAtmosphere.show = true;
viewer.scene.globe.enableLighting = true;

// Dark canvas behind the globe.
viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#0a0e1a");

// Hide the Cesium logo overlay (optional but cleaner UI).
viewer.cesiumWidget.creditContainer.style.display = "none";

window.__viewer = viewer; // for debugging in dev console
console.log("Cesium viewer ready");

const monday = await fetch("./data/monday.json").then(r => r.json());

// In-memory state.
const state = {
  timestampUTC: monday.timestampUTC,
  observations: monday.observations,
  triangulated: null, // [x,y,z] ECEF (meters)
  residuals: [],
};

// Render layer references so we can clear and redraw on every recompute.
const layer = {
  observers: [],
  rays: [],
  triangulated: null,
};

function clearLayer() {
  for (const e of layer.observers) viewer.entities.remove(e);
  for (const e of layer.rays) viewer.entities.remove(e);
  if (layer.triangulated) viewer.entities.remove(layer.triangulated);
  layer.observers = [];
  layer.rays = [];
  layer.triangulated = null;
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
  return { origin, dir: dirEcef };
}

let recompute = function () {
  clearLayer();
  const jsDate = new Date(state.timestampUTC);
  if (Number.isNaN(jsDate.getTime()) || state.observations.length < 2) {
    state.triangulated = null;
    state.residuals = [];
    return;
  }
  const rays = state.observations.map(o => buildRay(o, jsDate));
  const result = triangulateRays(rays);
  state.triangulated = result.point;
  state.residuals = result.residuals;

  // Observer pins.
  for (const obs of state.observations) {
    const ecef = geodeticToEcef(obs.latDeg, obs.lonDeg, obs.elevM || 0);
    const pos = Cesium.Cartesian3.fromElements(...ecef);
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
        pixelOffset: new Cesium.Cartesian2(12, -8),
        fillColor: color, showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(10,14,26,0.7)"),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
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
    layer.rays.push(viewer.entities.add({
      polyline: {
        positions: [
          Cesium.Cartesian3.fromElements(...origin),
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

  // Triangulated marker with gentle pulse.
  if (state.triangulated) {
    layer.triangulated = viewer.entities.add({
      position: Cesium.Cartesian3.fromElements(...state.triangulated),
      point: {
        pixelSize: new Cesium.CallbackProperty((t) => {
          const sec = Cesium.JulianDate.secondsDifference(t, viewer.clock.startTime);
          return 12 + 4 * Math.abs(Math.sin(sec * 2));
        }, false),
        color: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString("#7eb8ff"),
        outlineWidth: 3,
      },
      label: {
        text: formatTriangulatedLabel(),
        font: "12px sans-serif",
        pixelOffset: new Cesium.Cartesian2(14, -10),
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(10,14,26,0.7)"),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
      },
    });
  }

  frameAll();
};

function formatTriangulatedLabel() {
  if (!state.triangulated) return "";
  const cart = Cesium.Cartographic.fromCartesian(
    Cesium.Cartesian3.fromElements(...state.triangulated)
  );
  return `Triangulated · ${(cart.height / 1000).toFixed(1)} km`;
}

function frameAll() {
  const positions = state.observations.map(o =>
    Cesium.Cartesian3.fromDegrees(o.lonDeg, o.latDeg, (o.elevM || 0))
  );
  if (state.triangulated) {
    positions.push(Cesium.Cartesian3.fromElements(...state.triangulated));
  }
  if (positions.length === 0) return;
  const bs = Cesium.BoundingSphere.fromPoints(positions);
  viewer.camera.flyToBoundingSphere(bs, {
    duration: 1.2,
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(20),
      Cesium.Math.toRadians(-30),
      bs.radius * 3.5
    ),
  });
}

const PALETTE = ["#ff9b54", "#7fe5d1", "#c084fc", "#facc15", "#f87171"];

const tsInput = document.getElementById("ts-utc");
const tsLocal = document.getElementById("ts-local");
const tbody   = document.querySelector("#obs-table tbody");
const addBtn  = document.getElementById("add-obs");

function makeInput(field, value, attrs = {}) {
  const el = document.createElement("input");
  el.type = "text";
  el.dataset.field = field;
  el.value = String(value ?? "");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function makeCell(child) {
  const td = document.createElement("td");
  if (child) td.appendChild(child);
  return td;
}

function buildObsRow(obs, idx) {
  const tr = document.createElement("tr");
  tr.dataset.idx = String(idx);

  // Name cell: swatch + name input
  const nameTd = document.createElement("td");
  const swatch = document.createElement("span");
  swatch.className = "color-swatch";
  swatch.style.background = obs.color;
  nameTd.appendChild(swatch);
  nameTd.appendChild(makeInput("name", obs.name));
  tr.appendChild(nameTd);

  tr.appendChild(makeCell(makeInput("lat", obs.rawLat ?? obs.latDeg)));
  tr.appendChild(makeCell(makeInput("lon", obs.rawLon ?? obs.lonDeg)));
  tr.appendChild(makeCell(makeInput("elev", obs.elevM ?? 0)));

  // Mode <select>
  const modeTd = document.createElement("td");
  const sel = document.createElement("select");
  sel.dataset.field = "mode";
  for (const [val, label] of [["radec", "RA/Dec"], ["altaz", "Alt/Az"]]) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    if (obs.dir.mode === val) opt.selected = true;
    sel.appendChild(opt);
  }
  modeTd.appendChild(sel);
  tr.appendChild(modeTd);

  const v1Default = obs.dir.mode === "radec"
    ? (obs.rawV1 ?? String(obs.dir.raHours))
    : (obs.rawV1 ?? String(obs.dir.azDeg));
  const v2Default = obs.dir.mode === "radec"
    ? (obs.rawV2 ?? String(obs.dir.decDeg))
    : (obs.rawV2 ?? String(obs.dir.altDeg));
  tr.appendChild(makeCell(makeInput("v1", v1Default)));
  tr.appendChild(makeCell(makeInput("v2", v2Default)));

  // Remove button
  const btnTd = document.createElement("td");
  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "remove";
  rm.textContent = "✕";
  rm.title = "Remove";
  btnTd.appendChild(rm);
  tr.appendChild(btnTd);

  return tr;
}

function renderObsRows() {
  tbody.replaceChildren(...state.observations.map(buildObsRow));
}

function renderTimestampLocal() {
  const d = new Date(state.timestampUTC);
  tsLocal.textContent = Number.isNaN(d.getTime())
    ? "(invalid)"
    : "(" + d.toLocaleString() + ")";
}

function reparseObsFromDom() {
  const rows = [...tbody.querySelectorAll("tr")];
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
      elevM: Number(get("elev")) || 0,
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

tbody.addEventListener("input", reparseObsFromDom);
tbody.addEventListener("change", reparseObsFromDom);
tsInput.addEventListener("input", reparseObsFromDom);

tbody.addEventListener("click", (ev) => {
  if (ev.target.classList && ev.target.classList.contains("remove")) {
    const idx = Number(ev.target.closest("tr").dataset.idx);
    state.observations.splice(idx, 1);
    renderObsRows();
    if (state.observations.length >= 2) recompute();
  }
});

addBtn.addEventListener("click", () => {
  const idx = state.observations.length;
  state.observations.push({
    id: `obs-${idx}`,
    name: `Obs ${idx + 1}`,
    color: PALETTE[idx % PALETTE.length],
    latDeg: 0, lonDeg: 0, elevM: 0,
    dir: { mode: "radec", raHours: 0, decDeg: 0 },
  });
  renderObsRows();
});

renderObsRows();
renderTimestampLocal();
recompute();
