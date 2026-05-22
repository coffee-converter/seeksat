// camera-controls.js -- shared camera preset wiring for the
// #camera-controls nav. Apps supply callbacks describing the anchor
// point (where the camera locks to) and the set of points to keep
// in frame. Built-in buttons are data-cam="frame", "top", "anchor".
// Apps can wire additional preset buttons via `extraHandlers`.

const Cesium = window.Cesium;

export function wireCameraControls(viewer, {
  getAnchorPosition,  // () => Cartesian3 | null — where the anchor toggle locks to
  getFramePositions,  // () => Cartesian3[]
  getTopDownCenter,   // optional () => Cartesian3 | null; defaults to bs.center
  topDownAltitude,    // optional (bsRadius:number) => meters
  // optional (bs:BoundingSphere) => { headingDeg, pitchDeg }
  // Lets callers position the frame view perpendicular to their geometry
  // (e.g., perpendicular to a triangulation baseline so rays appear edge-on).
  // Defaults to { 20, -30 } — a generic over-the-shoulder tilt.
  getFrameHeadingPitch,
  // optional () => { left, right, top, bottom } in pixels — how much of
  // the canvas is obscured by overlay UI (e.g., a left side panel).
  // When provided, frameAll fits the bounding sphere into the visible
  // (un-occluded) canvas region instead of the full canvas, and aims
  // the camera so the data lands centered in that visible region.
  getFrameViewportInset,
  beforePreset,       // optional (camName:string) => void
  extraHandlers = {}, // optional { camName: (btn:Element) => void }
} = {}) {
  let anchorLocked = false;

  function setBtnActive(cam, on) {
    const btn = document.querySelector(`[data-cam="${cam}"]`);
    if (btn) btn.classList.toggle("active", on);
  }

  // "Anchor" mode pins viewer.camera.lookAtTransform to the supplied
  // ECEF point — mouse-drag then orbits the camera around it, scroll
  // wheel zooms in/out. Unlocking restores Cesium's default identity
  // transform (free-fly camera).
  function lockAnchor() {
    const anchor = getAnchorPosition?.();
    if (!anchor) return false;
    viewer.camera.lookAtTransform(Cesium.Transforms.eastNorthUpToFixedFrame(anchor));
    anchorLocked = true;
    setBtnActive("anchor", true);
    return true;
  }
  function unlockAnchor() {
    if (!anchorLocked) return;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    anchorLocked = false;
    setBtnActive("anchor", false);
  }
  function toggleAnchorLock() {
    if (anchorLocked) unlockAnchor(); else lockAnchor();
  }

  // Derive both horizontal and vertical FOV from the camera's frustum.
  // Cesium semantics: PerspectiveFrustum.fov is the HORIZONTAL FOV when
  // viewport width > height, otherwise the VERTICAL FOV. Naively
  // treating it as horizontal gives wildly wrong results on portrait
  // viewports (the actual horizontal FOV is much narrower there, so
  // the framed/top view overflows the sides).
  function cameraFovs() {
    const frustum = viewer.camera.frustum;
    const fov = frustum.fov ?? Math.PI / 3;
    const aspect = frustum.aspectRatio ?? 1;
    let fovH, fovV;
    if (aspect >= 1) {
      fovH = fov;
      fovV = 2 * Math.atan(Math.tan(fov / 2) / aspect);
    } else {
      fovV = fov;
      fovH = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    }
    return { fovH, fovV, aspect };
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
    const { fovH, fovV } = cameraFovs();
    const hp = getFrameHeadingPitch?.(bs) ?? { headingDeg: 20, pitchDeg: -30 };
    const inset = getFrameViewportInset?.() ?? { left: 0, right: 0, top: 0, bottom: 0 };
    const cW = viewer.scene.canvas.clientWidth;
    const cH = viewer.scene.canvas.clientHeight;
    const insetSum = inset.left + inset.right + inset.top + inset.bottom;
    if (insetSum === 0) {
      // No occlusion — Cesium's flyToBoundingSphere is the simplest path.
      const halfMinFov = Math.min(fovH, fovV) / 2;
      const range = (bs.radius / Math.sin(halfMinFov)) * 1.15;
      viewer.camera.flyToBoundingSphere(bs, {
        duration: 1.2,
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(hp.headingDeg),
          Cesium.Math.toRadians(hp.pitchDeg),
          range,
        ),
      });
      return;
    }
    // Inset path: bias bs.center toward visible-area center by a
    // FRACTION of the full inset (not all the way), then size range
    // for whichever side of the shifted center has the tighter
    // half-FOV. Fully centering in the visible area would let the data
    // grow as large as possible, but pushes it visibly off-center on
    // the canvas — a 50% bias reads as "respecting the panel" without
    // looking lopsided.
    const SHIFT_FRACTION = 0.5;
    const shiftPxX_partial = ((inset.left - inset.right) / 2) * SHIFT_FRACTION;
    const shiftPxY_partial = ((inset.top - inset.bottom) / 2) * SHIFT_FRACTION;
    const centerX = cW / 2 + shiftPxX_partial;
    const centerY = cH / 2 + shiftPxY_partial;
    const halfWinXpx = Math.min(centerX - inset.left, (cW - inset.right) - centerX);
    const halfWinYpx = Math.min(centerY - inset.top, (cH - inset.bottom) - centerY);
    const halfFovHvis = Math.atan((2 * halfWinXpx / cW) * Math.tan(fovH / 2));
    const halfFovVvis = Math.atan((2 * halfWinYpx / cH) * Math.tan(fovV / 2));
    const halfMinVis = Math.max(0.05, Math.min(halfFovHvis, halfFovVvis));
    const range = (bs.radius / Math.sin(halfMinVis)) * 1.15;

    const H = Cesium.Math.toRadians(hp.headingDeg);
    const P = Cesium.Math.toRadians(hp.pitchDeg);
    // Local ENU offset (east, north, up) from bs.center to camera.
    // Negative pitch positions camera above the target.
    const eOff = range * Math.cos(P) * Math.sin(H);
    const nOff = range * Math.cos(P) * Math.cos(H);
    const uOff = -range * Math.sin(P);
    const enuFrame = Cesium.Transforms.eastNorthUpToFixedFrame(bs.center);
    const offWorld = Cesium.Matrix4.multiplyByPointAsVector(
      enuFrame, new Cesium.Cartesian3(eOff, nOff, uOff), new Cesium.Cartesian3());
    const camPos = Cesium.Cartesian3.add(bs.center, offWorld, new Cesium.Cartesian3());

    // Camera-right axis = forward × worldUp (perpendicular to the
    // view direction in the horizontal plane). Used to shift the
    // look-at point so the bounding sphere lands at visible-center.
    const fwd = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.subtract(bs.center, camPos, new Cesium.Cartesian3()),
      new Cesium.Cartesian3());
    const worldUp = Cesium.Cartesian3.normalize(bs.center, new Cesium.Cartesian3());
    const camRight = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.cross(fwd, worldUp, new Cesium.Cartesian3()),
      new Cesium.Cartesian3());

    // Use the (already SHIFT_FRACTION-scaled) pixel offsets so the
    // look-at point — and therefore canvas-center — sits part-way
    // toward the visible-area center rather than all the way there.
    // World units per pixel at distance `range`.
    const wppH = (2 * range * Math.tan(fovH / 2)) / cW;
    const wppV = (2 * range * Math.tan(fovV / 2)) / cH;
    // To shift bs.center RIGHT by N px in canvas, aim the camera LEFT
    // of bs.center by N px-worth of world units along camRight.
    const shiftRightW = -shiftPxX_partial * wppH;
    const shiftUpW = shiftPxY_partial * wppV;
    const camUpApprox = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.cross(camRight, fwd, new Cesium.Cartesian3()),
      new Cesium.Cartesian3());
    const shiftVec = Cesium.Cartesian3.add(
      Cesium.Cartesian3.multiplyByScalar(camRight, shiftRightW, new Cesium.Cartesian3()),
      Cesium.Cartesian3.multiplyByScalar(camUpApprox, shiftUpW, new Cesium.Cartesian3()),
      new Cesium.Cartesian3());
    const target = Cesium.Cartesian3.add(bs.center, shiftVec, new Cesium.Cartesian3());

    const newFwd = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.subtract(target, camPos, new Cesium.Cartesian3()),
      new Cesium.Cartesian3());
    const newRight = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.cross(newFwd, worldUp, new Cesium.Cartesian3()),
      new Cesium.Cartesian3());
    const newUp = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.cross(newRight, newFwd, new Cesium.Cartesian3()),
      new Cesium.Cartesian3());

    viewer.camera.flyTo({
      destination: camPos,
      orientation: { direction: newFwd, up: newUp },
      duration: 1.2,
    });
  }

  function topDown() {
    viewer.camera.cancelFlight();
    let center = getTopDownCenter?.();
    let altitude;
    // Camera looking straight down at altitude h sees a circle on the
    // ground of radius h * tan(halfMinFov). Solve for h so a bounding
    // sphere of radius r fits with breathing room.
    const { fovH, fovV } = cameraFovs();
    const halfMinFov = Math.min(fovH, fovV) / 2;
    const margin = 1.15;
    if (!center) {
      const positions = getFramePositions?.() ?? [];
      if (!positions.length) { viewer.camera.flyHome(1.2); return; }
      const bs = Cesium.BoundingSphere.fromPoints(positions);
      center = bs.center;
      altitude = topDownAltitude
        ? topDownAltitude(bs.radius)
        : Math.max(2_000_000, (bs.radius / Math.tan(halfMinFov)) * margin);
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
    // Re-framing presets release the anchor lock first; the anchor
    // button itself is a toggle and is excluded from the reset set.
    if (RESET_PRESETS.has(cam)) {
      unlockAnchor();
      beforePreset?.(cam);
    }
    if (cam === "frame") return frameAll();
    if (cam === "top") return topDown();
    if (cam === "anchor") return toggleAnchorLock();
    extraHandlers[cam]?.(ev.target);
  });

  return { frameAll, topDown, lockAnchor, unlockAnchor, toggleAnchorLock };
}
