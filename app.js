// app.js -- bootstrap CesiumJS viewer.
//
// Ion access token: Cesium ships with a free default development token that
// works locally. To use your own token (higher quota, custom imagery), set
// it here:
//   Cesium.Ion.defaultAccessToken = "...";

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
