// lib/cesium-viewer.ts - typed port of legacy/viewer-setup.js
//
// makeViewer constructs a Cesium.Viewer wired up with our app-wide
// defaults: no Cesium Ion, Esri World Imagery as the base layer, the
// NASA SVS 2020 starmap cubemap, MSAA 4× + FXAA antialiasing, hidden
// credit container. Cesium itself is loaded as a global via the
// <Script> tag in app/layout.tsx, so callers must wait for
// window.Cesium to exist before invoking this.
//
// Cesium global + CesiumViewer alias come from types/cesium.d.ts.

import type { CesiumViewer } from "@/types/cesium";

export interface MakeViewerOptions {
  /** Pass-through to `new Cesium.Viewer(container, ...)`. */
  viewer?: Record<string, unknown>;
  /** Skip adding the default Esri base imagery layer. */
  imagery?: boolean;
  /** Override path to the directory holding the 6 NASA SVS face JPGs. */
  starsBase?: string;
  /** Enable Cesium sun-direction lighting on the globe (default true). */
  lighting?: boolean;
}

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
  // Disable Cesium's default Tycho cubemap (6× ~140 kB JPGs from the
  // CDN). We install our own NASA SVS 2020 starfield below, deferred,
  // so loading two cubemaps is pure waste. `skyBox: false` skips the
  // built-in entirely.
  skyBox: false,
};

const ESRI_IMAGERY_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export function makeViewer(
  container: HTMLElement,
  opts: MakeViewerOptions = {},
): CesiumViewer {
  if (typeof window === "undefined" || !window.Cesium) {
    throw new Error("makeViewer called before window.Cesium loaded");
  }
  const Cesium = window.Cesium;

  const viewer = new Cesium.Viewer(container, {
    ...DEFAULT_VIEWER_OPTIONS,
    ...(opts.viewer || {}),
  });

  // Default base imagery: Esri (no auth). Apps can override by passing
  // opts.imagery=false and managing their own layers.
  if (opts.imagery !== false) {
    viewer.imageryLayers.removeAll();
    const layer = viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: ESRI_IMAGERY_URL,
        credit: "Tiles © Esri, Maxar, Earthstar Geographics",
        maximumLevel: 19,
      }),
    );
    // brightness multiplies imagery RGB; contrast bump keeps the
    // sunlit hemisphere vivid at the lower brightness (the contrast
    // curve in Cesium's imagery filter crushes blacks while preserving
    // highlights - exactly what we want for a stronger day/night gap).
    // saturation slightly below 1 gives the night a mildly greyed-out
    // feel without making the day side look washed out.
    layer.brightness = 0.55;
    layer.contrast = 1.15;
    layer.saturation = 0.92;
  }

  // NASA SVS Deep Star Map 2020 cubemap, lazy-loaded so it doesn't
  // block the first frame. The 6 4k JPGs total ~10MB and pile onto
  // an already-saturated connection during Cesium's own ~3MB CDN
  // pull. Cesium ships a tiny default starfield that renders fine
  // until ours swaps in. Defer to requestIdleCallback (or a 1-frame
  // setTimeout fallback) so we yield to the user-visible first paint.
  const starsBase = opts.starsBase ?? "/assets/stars";
  const installSkyBox = () => {
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
  };
  // requestIdleCallback fires almost immediately during Cesium's
  // bursty boot (the main thread is never idle for long enough to
  // be useful here), so we use a hard delay instead. 5 s lets the
  // Cesium worker chunks land + the first ArcGIS tile batch settle
  // before the 10 MB cubemap fetch starts. The starfield is purely
  // decorative behind the globe; the polar-modal sky chart renders
  // its stars from a separate ~250-entry catalog, not the cubemap.
  setTimeout(installSkyBox, 5000);
  // Atmospheric glow disabled - the rim halo gets clipped along part
  // of the terminator (visible band/dashed cut on the dark side
  // edge of the globe) and isn't worth the visual artifact for an
  // app that's mostly looking up at orbits rather than down at the
  // ground. Both the sky-rim halo and the ground-atmosphere wash
  // are turned off below.
  viewer.scene.skyAtmosphere.show = false;
  viewer.scene.globe.enableLighting = opts.lighting ?? true;
  // Force the day/night terminator to stay visible at every zoom
  // level. By default Cesium turns OFF sun-direction lighting as the
  // camera approaches the surface (~½π × earthRadius), which flattens
  // the terminator. Setting fade-out near 0 keeps real Lambert
  // lighting active at all distances. Leave nightFadeOut/In at the
  // far-pushed values so the "dim earth glow" mode never kicks in
  // - Lambert shading handles night-side appearance uniformly.
  viewer.scene.globe.lightingFadeOutDistance = 1;
  viewer.scene.globe.lightingFadeInDistance = 100;
  viewer.scene.globe.nightFadeOutDistance = 1e9;
  viewer.scene.globe.nightFadeInDistance = 2e9;
  // Moderate diffuse multiplier - real darkening comes from imagery
  // brightness; higher values saturate without sharpening the
  // terminator more.
  viewer.scene.globe.lambertDiffuseMultiplier = 3;
  // Enable depth-testing of primitives against the globe surface so
  // polyline depthFailMaterial actually kicks in (X-ray through-Earth
  // rendering for the orbit ring + ground line). The known side
  // effects of this flag (entity ground-clamping, camera-collision
  // tweaks) don't apply to our scene - we don't ship real terrain,
  // and the ISS dot / observer pins use
  // disableDepthTestDistance: Infinity to bypass the depth buffer.
  viewer.scene.globe.depthTestAgainstTerrain = true;
  // Ground atmosphere also off - it was contributing to the same
  // hazy rim that gets clipped on the night side. atmosphereLight
  // values are now moot since both atmospheric layers are disabled,
  // but kept for the lambert lighting block.
  viewer.scene.globe.showGroundAtmosphere = false;
  viewer.scene.globe.dynamicAtmosphereLighting = false;
  // Disable scene fog - Cesium's distance fog brightens distant
  // terrain and contributes to the brightness step at certain zooms.
  viewer.scene.fog.enabled = false;
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#0a0e1a");
  viewer.scene.msaaSamples = 4;
  viewer.scene.postProcessStages.fxaa.enabled = true;
  viewer.cesiumWidget.creditContainer.style.display = "none";

  // Prevent the camera from going through the surface during
  // zoom/orbit. minimumZoomDistance = 1m lets the camera get very
  // close to the surface without dipping below it.
  const ctrl = viewer.scene.screenSpaceCameraController;
  ctrl.enableCollisionDetection = true;
  ctrl.minimumZoomDistance = 1.0;

  return viewer;
}

// Wire the bottom-center sim-time readout. Pages with a #sim-time
// element get a UTC clock display that ticks with the viewer's clock.
// `precision` is the number of fractional-second digits.
export function wireSimTime(
  viewer: CesiumViewer,
  { precision = 0 }: { precision?: number } = {},
): void {
  const el = document.getElementById("sim-time");
  if (!el) return;
  const Cesium = window.Cesium;
  viewer.clock.onTick.addEventListener((clock: CesiumViewer) => {
    const iso = Cesium.JulianDate.toIso8601(clock.currentTime, precision);
    el.textContent = iso.replace("T", " ").replace(/Z$/, " UTC");
  });
}
