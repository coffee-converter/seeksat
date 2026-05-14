// viewer-setup.js -- shared Cesium Viewer construction.
//
// Builds a Viewer with our common defaults: no Cesium Ion (avoids 401),
// Esri World Imagery as the base layer, NASA SVS 2020 starmap cubemap,
// MSAA 4× + FXAA antialiasing, Cesium credit hidden.

const Cesium = window.Cesium;

const DEFAULT_VIEWER_OPTIONS = {
  baseLayer: false, // skip Cesium Ion's default world imagery (avoids 401)
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
};

const ESRI_IMAGERY_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export function makeViewer(containerId, opts = {}) {
  const viewer = new Cesium.Viewer(containerId, {
    ...DEFAULT_VIEWER_OPTIONS,
    ...(opts.viewer || {}),
  });

  // Default base imagery: Esri (no auth). Apps can override by passing
  // opts.imagery=false and managing their own layers.
  if (opts.imagery !== false) {
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
      url: ESRI_IMAGERY_URL,
      credit: "Tiles © Esri, Maxar, Earthstar Geographics",
      maximumLevel: 19,
    }));
  }

  // NASA SVS Deep Star Map 2020 cubemap.
  const starsBase = opts.starsBase ?? "./assets/stars";
  viewer.scene.skyBox = new Cesium.SkyBox({
    sources: {
      positiveX: `${starsBase}/starmap_2020_4k_px.jpg`,
      negativeX: `${starsBase}/starmap_2020_4k_mx.jpg`,
      positiveY: `${starsBase}/starmap_2020_4k_py.jpg`,
      negativeY: `${starsBase}/starmap_2020_4k_my.jpg`,
      positiveZ: `${starsBase}/starmap_2020_4k_pz.jpg`,
      negativeZ: `${starsBase}/starmap_2020_4k_mz.jpg`,
    },
  });
  viewer.scene.skyBox.show = true;
  viewer.scene.skyAtmosphere.show = true;
  viewer.scene.globe.enableLighting = opts.lighting ?? true;
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#0a0e1a");
  viewer.scene.msaaSamples = 4;
  viewer.scene.postProcessStages.fxaa.enabled = true;
  viewer.cesiumWidget.creditContainer.style.display = "none";

  // Prevent the camera from going through the surface during zoom/orbit.
  // enableCollisionDetection is the default-true in Cesium but we set it
  // explicitly; minimumZoomDistance is a low floor (1m) so we can still get
  // very close to the surface without dipping below it.
  const ctrl = viewer.scene.screenSpaceCameraController;
  ctrl.enableCollisionDetection = true;
  ctrl.minimumZoomDistance = 1.0;

  return viewer;
}

// Wire the bottom-center sim-time readout. Pages with a #sim-time element
// get a UTC clock display that ticks with the viewer's clock. `precision`
// is the number of fractional-second digits to show — defaults to 0 (whole
// seconds). Use Cesium's JulianDate ISO formatter so values like the
// observation timestamp's 4-decimal sub-seconds round-trip intact (JS
// Date.toISOString only carries 3-decimal milliseconds).
export function wireSimTime(viewer, { precision = 0 } = {}) {
  const el = document.getElementById("sim-time");
  if (!el) return;
  viewer.clock.onTick.addEventListener((clock) => {
    const iso = Cesium.JulianDate.toIso8601(clock.currentTime, precision);
    el.textContent = iso.replace("T", " ").replace(/Z$/, " UTC");
  });
}
