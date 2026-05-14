// pass-finder.js -- ISS multi-observer pass finder.

const Cesium = window.Cesium;
const sat = window.satellite;

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
  shouldAnimate: false,
});

// Use Esri imagery (no Cesium Ion auth needed).
viewer.imageryLayers.removeAll();
viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  credit: "Tiles © Esri, Maxar, Earthstar Geographics",
  maximumLevel: 19,
}));

viewer.scene.skyBox.show = true;
viewer.scene.skyAtmosphere.show = true;
viewer.scene.globe.enableLighting = true;
viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#0a0e1a");
viewer.cesiumWidget.creditContainer.style.display = "none";
viewer.scene.msaaSamples = 4;
viewer.scene.postProcessStages.fxaa.enabled = true;

window.__viewer = viewer;
console.log("Pass finder viewer ready");
