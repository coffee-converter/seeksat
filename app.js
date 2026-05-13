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

recompute();
