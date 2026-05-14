// camera-controls.js -- shared camera preset wiring for the #camera-controls
// nav. Apps supply callbacks describing their orbit anchor and the set of
// points to keep in frame. Built-in buttons are data-cam="frame", "top",
// "orbit", "rotate". Apps can wire additional preset buttons via
// `extraHandlers`.

const Cesium = window.Cesium;

export function wireCameraControls(viewer, {
  getOrbitAnchor,     // () => Cartesian3 | null
  getFramePositions,  // () => Cartesian3[]
  getTopDownCenter,   // optional () => Cartesian3 | null; defaults to bs.center
  topDownAltitude,    // optional (bsRadius:number) => meters
  beforePreset,       // optional (camName:string) => void
  extraHandlers = {}, // optional { camName: (btn:Element) => void }
} = {}) {
  let orbitLocked = false;
  let rotateAnim = null;

  function setBtnActive(cam, on) {
    const btn = document.querySelector(`[data-cam="${cam}"]`);
    if (btn) btn.classList.toggle("active", on);
  }

  function lockOrbit() {
    const anchor = getOrbitAnchor?.();
    if (!anchor) return false;
    viewer.camera.lookAtTransform(Cesium.Transforms.eastNorthUpToFixedFrame(anchor));
    orbitLocked = true;
    setBtnActive("orbit", true);
    return true;
  }
  function unlockOrbit() {
    if (!orbitLocked) return;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    orbitLocked = false;
    setBtnActive("orbit", false);
  }
  function toggleOrbitLock() {
    if (orbitLocked) unlockOrbit(); else lockOrbit();
  }

  function stopAutoRotate() {
    if (rotateAnim) cancelAnimationFrame(rotateAnim);
    rotateAnim = null;
    setBtnActive("rotate", false);
  }
  function toggleAutoRotate(btn) {
    if (rotateAnim) { stopAutoRotate(); return; }
    if (!orbitLocked && !lockOrbit()) return;
    if (btn) btn.classList.add("active");
    function step() {
      viewer.camera.rotateRight(0.004); // ~14°/sec at 60fps
      rotateAnim = requestAnimationFrame(step);
    }
    step();
  }

  function frameAll() {
    viewer.camera.cancelFlight();
    const positions = getFramePositions?.() ?? [];
    if (positions.length === 0) { viewer.camera.flyHome(1.2); return; }
    if (positions.length === 1) {
      const cart = Cesium.Cartographic.fromCartesian(positions[0]);
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          Cesium.Math.toDegrees(cart.longitude),
          Cesium.Math.toDegrees(cart.latitude),
          5_000_000
        ),
        duration: 1.2,
      });
      return;
    }
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

  function topDown() {
    viewer.camera.cancelFlight();
    let center = getTopDownCenter?.();
    let altitude;
    if (!center) {
      const positions = getFramePositions?.() ?? [];
      if (!positions.length) { viewer.camera.flyHome(1.2); return; }
      const bs = Cesium.BoundingSphere.fromPoints(positions);
      center = bs.center;
      altitude = topDownAltitude
        ? topDownAltitude(bs.radius)
        : Math.max(2_000_000, 2.2 * bs.radius);
    } else {
      altitude = topDownAltitude ? topDownAltitude(0) : 2_000_000;
    }
    const cart = Cesium.Cartographic.fromCartesian(center);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        Cesium.Math.toDegrees(cart.longitude),
        Cesium.Math.toDegrees(cart.latitude),
        altitude
      ),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      duration: 1.2,
    });
  }

  const RESET_PRESETS = new Set(["frame", "top", ...Object.keys(extraHandlers)]);

  document.getElementById("camera-controls").addEventListener("click", (ev) => {
    const cam = ev.target?.dataset?.cam;
    if (!cam) return;
    // Re-framing presets release orbit lock + stop auto-rotate first; orbit
    // and rotate are the toggle buttons themselves so they don't reset.
    if (RESET_PRESETS.has(cam)) {
      stopAutoRotate();
      unlockOrbit();
      beforePreset?.(cam);
    }
    if (cam === "frame") return frameAll();
    if (cam === "top") return topDown();
    if (cam === "orbit") return toggleOrbitLock();
    if (cam === "rotate") return toggleAutoRotate(ev.target);
    extraHandlers[cam]?.(ev.target);
  });

  return { frameAll, topDown, lockOrbit, unlockOrbit, toggleOrbitLock, stopAutoRotate, toggleAutoRotate };
}
