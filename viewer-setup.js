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
    const layer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
      url: ESRI_IMAGERY_URL,
      credit: "Tiles © Esri, Maxar, Earthstar Geographics",
      maximumLevel: 19,
    }));
    // brightness multiplies imagery RGB; contrast bump keeps the sunlit
    // hemisphere vivid at the lower brightness (the contrast curve in
    // Cesium's imagery filter crushes blacks while preserving highlights
    // — exactly what we want for a stronger day/night gap). saturation
    // slightly below 1 gives the night a mildly greyed-out feel without
    // making the day side look washed out.
    layer.brightness = 0.55;
    layer.contrast = 1.15;
    layer.saturation = 0.92;
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
  // Force the day/night terminator to stay visible at every zoom level.
  //
  // By default Cesium turns OFF the sun-direction lighting calculation
  // as the camera approaches the surface (lightingFadeOutDistance, which
  // defaults to ~½π × earthRadius ≈ 10,000 km), so imagery stays bright
  // and readable when zoomed in — which also flattens the day/night
  // terminator. Setting the fade-out to ~0 keeps real Lambert lighting
  // active at all camera distances, giving a natural twilight gradient
  // and a dark unlit hemisphere.
  //
  // Note: we deliberately leave nightFadeOut/InDistance at their
  // defaults. Forcing them small pushes the entire night side into the
  // "dim earth glow" appearance regardless of camera position, which
  // also greys out twilight zones near the terminator — not what we want.
  viewer.scene.globe.lightingFadeOutDistance = 1;
  viewer.scene.globe.lightingFadeInDistance = 100;
  // Push the night-atmosphere fade distances out past any reasonable
  // camera range so the hard transition between "lit-atmosphere night"
  // (close) and "dim-glow night" (far) never happens — Lambert shading
  // handles the day/night appearance uniformly at every zoom level
  // instead.
  viewer.scene.globe.nightFadeOutDistance = 1e9;
  viewer.scene.globe.nightFadeInDistance = 2e9;
  // lambertDiffuseMultiplier moderate (high values saturated quickly and
  // didn't visibly sharpen the terminator more); the real darkening
  // comes from the imagery-layer brightness reduction above.
  viewer.scene.globe.lambertDiffuseMultiplier = 3;
  // Atmosphere settings widen the day/night gap rather than eliminating
  // both. dynamicAtmosphereLighting=true makes the ground atmosphere
  // track the actual sun direction (lifting the DAY side without lifting
  // the night) — the previous false setting + intensity=0 dimmed the day
  // side too. Moderate intensity gives a visible bonus lift to lit terrain.
  viewer.scene.globe.atmosphereLightIntensity = 4;
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.scene.globe.dynamicAtmosphereLighting = true;
  // Disable scene fog — Cesium's distance fog brightens distant terrain
  // and contributes to the brightness step seen at certain zooms.
  viewer.scene.fog.enabled = false;
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
