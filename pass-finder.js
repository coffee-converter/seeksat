// pass-finder.js -- ISS multi-observer pass finder.

import { parseDmsToDecimal, geodeticToEcef } from "./coords.js";
import { geocodeOne } from "./pass-finder/geocode.js";
import { fetchIssTle } from "./pass-finder/tle.js";
import { isVisibleAtAll, issAltitudeDeg } from "./pass-finder/visibility.js";
import { findVisibilityWindows } from "./pass-finder/search.js";
import { tleOrbitTrackEcef } from "./truth.js";

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

// ---------------------------------------------------------------------------
// Task 8: Observer state + UI
// ---------------------------------------------------------------------------

const PALETTE = ["#ff9b54", "#7fe5d1", "#c084fc", "#facc15", "#f87171", "#34d399", "#a78bfa", "#fb923c"];

const state = {
  observers: [],
  clickToPlace: false,
};

const obsListEl = document.getElementById("obs-list");
const observerLayer = []; // Cesium entities, parallel to state.observers

function newObsId() { return `obs-${Date.now()}-${Math.floor(Math.random() * 1000)}`; }

function addObserver(name, latDeg, lonDeg) {
  const idx = state.observers.length;
  const color = PALETTE[idx % PALETTE.length];
  const obs = { id: newObsId(), name: name || `Point ${idx + 1}`, color, latDeg, lonDeg };
  state.observers.push(obs);
  const ent = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lonDeg, latDeg, 0),
    point: {
      pixelSize: 12,
      color: Cesium.Color.fromCssColorString(color),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
    label: {
      text: obs.name,
      font: "12px sans-serif",
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(12, -10),
      fillColor: Cesium.Color.fromCssColorString(color),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("rgba(10,14,26,0.7)"),
      backgroundPadding: new Cesium.Cartesian2(6, 4),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  observerLayer.push(ent);
  renderObsList();
  return obs;
}

function removeObserver(id) {
  const idx = state.observers.findIndex(o => o.id === id);
  if (idx < 0) return;
  state.observers.splice(idx, 1);
  viewer.entities.remove(observerLayer[idx]);
  observerLayer.splice(idx, 1);
  renderObsList();
}

function renderObsList() {
  obsListEl.replaceChildren();
  for (const obs of state.observers) {
    const card = document.createElement("div");
    card.className = "obs-card";
    const header = document.createElement("div");
    header.className = "obs-card-header";
    const swatch = document.createElement("span");
    swatch.className = "color-swatch";
    swatch.style.background = obs.color;
    header.appendChild(swatch);
    const nameSpan = document.createElement("span");
    nameSpan.textContent = obs.name;
    nameSpan.style.flex = "1";
    nameSpan.style.fontSize = "13px";
    nameSpan.style.fontWeight = "600";
    header.appendChild(nameSpan);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "remove";
    rm.textContent = "✕";
    rm.title = "Remove";
    rm.addEventListener("click", () => removeObserver(obs.id));
    header.appendChild(rm);
    card.appendChild(header);
    const coords = document.createElement("div");
    coords.style.fontFamily = "'SF Mono', 'Fira Code', monospace";
    coords.style.fontSize = "11px";
    coords.style.color = "#8899bb";
    coords.textContent = `${obs.latDeg.toFixed(4)}°, ${obs.lonDeg.toFixed(4)}°`;
    card.appendChild(coords);
    obsListEl.appendChild(card);
  }
}

// Add by lat/lon
document.getElementById("add-latlon-btn").addEventListener("click", () => {
  const inp = document.getElementById("add-latlon");
  const raw = inp.value.trim();
  if (!raw) return;
  // Split on comma; lat is before, lon is after.
  const parts = raw.split(",");
  if (parts.length !== 2) {
    alert("Format: lat, lon (DMS or decimal)");
    return;
  }
  try {
    const latDeg = parseDmsToDecimal(parts[0].trim());
    const lonDeg = parseDmsToDecimal(parts[1].trim());
    addObserver(null, latDeg, lonDeg);
    inp.value = "";
  } catch (e) {
    alert(`Bad lat/lon: ${e.message}`);
  }
});

// Geocode
document.getElementById("add-geocode-btn").addEventListener("click", async () => {
  const inp = document.getElementById("add-geocode");
  const q = inp.value.trim();
  if (!q) return;
  const result = await geocodeOne(q);
  if (!result) {
    alert(`No result for "${q}"`);
    return;
  }
  addObserver(q, result.latDeg, result.lonDeg);
  inp.value = "";
});

// Click on globe to place
const clickToggleBtn = document.getElementById("click-place-toggle");
clickToggleBtn.addEventListener("click", () => {
  state.clickToPlace = !state.clickToPlace;
  clickToggleBtn.classList.toggle("active", state.clickToPlace);
});
const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction((click) => {
  if (!state.clickToPlace) return;
  const cartesian = viewer.scene.pickPosition(click.position) ||
    viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
  if (!cartesian) return;
  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  addObserver(null, Cesium.Math.toDegrees(cartographic.latitude), Cesium.Math.toDegrees(cartographic.longitude));
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// ---------------------------------------------------------------------------
// Task 9: TLE panel (fetch on load, edit, refetch)
// ---------------------------------------------------------------------------

const tleNameEl = document.getElementById("tle-name");
const tleL1El = document.getElementById("tle-l1");
const tleL2El = document.getElementById("tle-l2");
const tleStatusEl = document.getElementById("tle-status");
const tleRefetchBtn = document.getElementById("tle-refetch");

state.tle = null;

let loadTle = async function () {
  tleStatusEl.textContent = "fetching from Celestrak…";
  tleStatusEl.className = "hint";
  const t = await fetchIssTle();
  if (t) {
    tleNameEl.value = t.name;
    tleL1El.value = t.line1;
    tleL2El.value = t.line2;
    state.tle = t;
    tleStatusEl.textContent = `fetched ${new Date().toUTCString()}`;
    tleStatusEl.className = "hint ok";
  } else {
    tleStatusEl.textContent = "fetch failed — paste a TLE below.";
    tleStatusEl.className = "hint error";
  }
};

function readTleFromUi() {
  const name = tleNameEl.value.trim();
  const line1 = tleL1El.value.trim();
  const line2 = tleL2El.value.trim();
  if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) return null;
  return { name, line1, line2 };
}

tleRefetchBtn.addEventListener("click", () => loadTle());
[tleNameEl, tleL1El, tleL2El].forEach(el => el.addEventListener("input", () => {
  state.tle = readTleFromUi();
}));

// ---------------------------------------------------------------------------
// Task 10: ISS entity + clock-driven position (CallbackProperty)
// ---------------------------------------------------------------------------

let issEntity = null;
let orbitEntity = null;
let satrec = null;

function refreshSatrec() {
  const t = readTleFromUi();
  if (!t) { satrec = null; return; }
  try {
    satrec = sat.twoline2satrec(t.line1, t.line2);
  } catch (e) {
    console.warn("TLE parse error:", e.message);
    satrec = null;
  }
}

function issEcefAt(jsDate) {
  if (!satrec) return null;
  const pv = sat.propagate(satrec, jsDate);
  if (!pv || !pv.position) return null;
  const gmst = sat.gstime(jsDate);
  const ecf = sat.eciToEcf(pv.position, gmst);
  return [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000];
}

function ensureIssEntity() {
  if (issEntity) return;
  issEntity = viewer.entities.add({
    position: new Cesium.CallbackProperty((time) => {
      const d = Cesium.JulianDate.toDate(time);
      const p = issEcefAt(d);
      if (!p) return Cesium.Cartesian3.ZERO;
      return Cesium.Cartesian3.fromElements(p[0], p[1], p[2]);
    }, false),
    point: {
      pixelSize: 14,
      color: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString("#7eb8ff"),
      outlineWidth: 3,
    },
    label: {
      text: new Cesium.CallbackProperty((time) => {
        const d = Cesium.JulianDate.toDate(time);
        const p = issEcefAt(d);
        if (!p) return "ISS";
        const cart = Cesium.Cartographic.fromCartesian(
          Cesium.Cartesian3.fromElements(p[0], p[1], p[2])
        );
        return `ISS · ${(cart.height / 1000).toFixed(0)} km`;
      }, false),
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

// Orbit polyline: animated. The positions are recomputed each time the clock
// moves more than ~10 simulated seconds, so the orbit ring stays centered on
// the current moment as the ISS races forward. Cache the Cartesian3 array
// between recomputes so we're not allocating 360 positions every frame.
let orbitCachedPositions = [];
let orbitCacheCenterMs = null;
const ORBIT_REFRESH_MS = 10_000; // simulated-time interval between recomputes

function invalidateOrbitCache() { orbitCacheCenterMs = null; }

function recomputeOrbitFor(jsDate) {
  if (!satrec) { orbitCachedPositions = []; return; }
  const t = readTleFromUi();
  if (!t) { orbitCachedPositions = []; return; }
  const pts = tleOrbitTrackEcef(t.line1, t.line2, jsDate);
  orbitCachedPositions = pts.map(p =>
    Cesium.Cartesian3.fromElements(p[0], p[1], p[2])
  );
}

function ensureOrbitEntity() {
  if (orbitEntity) return;
  orbitEntity = viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty((time) => {
        const ms = Cesium.JulianDate.toDate(time).getTime();
        if (orbitCacheCenterMs === null
            || Math.abs(ms - orbitCacheCenterMs) > ORBIT_REFRESH_MS) {
          recomputeOrbitFor(new Date(ms));
          orbitCacheCenterMs = ms;
        }
        return orbitCachedPositions;
      }, false),
      width: 1.5,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString("#7eb8ff").withAlpha(0.45),
        dashLength: 12,
      }),
      arcType: Cesium.ArcType.NONE,
    },
  });
}

// Refresh satrec whenever TLE inputs change. Invalidate orbit cache so it
// picks up the new TLE on the next frame.
[tleNameEl, tleL1El, tleL2El].forEach(el => el.addEventListener("input", () => {
  refreshSatrec();
  invalidateOrbitCache();
}));
// Also after initial fetch.
const _loadTle = loadTle;
loadTle = async function () {
  await _loadTle();
  refreshSatrec();
  ensureIssEntity();
  ensureOrbitEntity();
  invalidateOrbitCache();
};
loadTle();

// ---------------------------------------------------------------------------
// Task 11: Search controls + windows-list rendering + click-to-jump
// ---------------------------------------------------------------------------

state.horizonDays = 7;
state.multiplier = 4000;
state.windows = [];
state.activeWindowIdx = -1;
state.searchEndMs = null;

const horizonSelect = document.getElementById("horizon-select");
const speedSelect = document.getElementById("speed-select");
const findBtn = document.getElementById("find-passes");
const findMoreBtn = document.getElementById("find-more");
const windowsListEl = document.getElementById("windows-list");

horizonSelect.addEventListener("change", () => {
  state.horizonDays = Number(horizonSelect.value);
});
speedSelect.addEventListener("change", () => {
  state.multiplier = Number(speedSelect.value);
  viewer.clock.multiplier = state.multiplier;
});

function runSearch(startMs, endMs) {
  if (!satrec) { alert("No TLE loaded."); return; }
  if (!state.observers.length) { alert("Add at least one observer first."); return; }
  windowsListEl.textContent = "searching…";
  // Defer to next tick to let the UI paint.
  setTimeout(() => {
    const wins = findVisibilityWindows(
      state.observers, satrec, isVisibleAtAll, sat,
      startMs, endMs, 60_000
    );
    state.windows = state.windows.concat(wins);
    state.searchEndMs = endMs;
    renderWindowsList();
    setupClockForSearch(startMs, endMs);
  }, 0);
}

function setupClockForSearch(startMs, endMs) {
  viewer.clock.startTime = Cesium.JulianDate.fromDate(new Date(startMs));
  viewer.clock.stopTime = Cesium.JulianDate.fromDate(new Date(endMs));
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(startMs));
  viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
  viewer.clock.multiplier = state.multiplier;
  viewer.clock.shouldAnimate = false;
}

function renderWindowsList() {
  windowsListEl.replaceChildren();
  if (!state.windows.length) {
    windowsListEl.textContent = "no simultaneous passes found";
    return;
  }
  state.windows.forEach((w, i) => {
    const row = document.createElement("div");
    row.className = "window-row";
    if (i === state.activeWindowIdx) row.classList.add("active");
    const time = document.createElement("span");
    time.className = "time";
    const d = new Date(w.startMs);
    time.textContent = d.toISOString().slice(5, 16).replace("T", " ");
    row.appendChild(time);
    const dur = document.createElement("span");
    dur.className = "dur";
    const durSec = Math.round((w.endMs - w.startMs) / 1000);
    const mm = Math.floor(durSec / 60), ss = durSec % 60;
    dur.textContent = `${mm}m${ss < 10 ? "0" : ""}${ss}s`;
    row.appendChild(dur);
    const alt = document.createElement("span");
    alt.className = "alt";
    // Peak alt: evaluate at midpoint as a quick estimate.
    const midMs = (w.startMs + w.endMs) / 2;
    const issEcef = issEcefAt(new Date(midMs));
    let peakDeg = 0;
    if (issEcef) {
      for (const obs of state.observers) {
        const obsEcef = geodeticToEcef(obs.latDeg, obs.lonDeg, 0);
        const lat = obs.latDeg * Math.PI / 180, lon = obs.lonDeg * Math.PI / 180;
        const dx = issEcef[0] - obsEcef[0];
        const dy = issEcef[1] - obsEcef[1];
        const dz = issEcef[2] - obsEcef[2];
        const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
        const sinLon = Math.sin(lon), cosLon = Math.cos(lon);
        const e = -sinLon*dx + cosLon*dy;
        const n = -sinLat*cosLon*dx - sinLat*sinLon*dy + cosLat*dz;
        const u = cosLat*cosLon*dx + cosLat*sinLon*dy + sinLat*dz;
        const a = Math.atan2(u, Math.hypot(e, n)) * 180 / Math.PI;
        if (peakDeg === 0 || a < peakDeg) peakDeg = a;
      }
    }
    alt.textContent = `${peakDeg.toFixed(0)}°`;
    alt.classList.add(peakDeg >= 50 ? "good" : peakDeg >= 20 ? "ok" : "poor");
    row.appendChild(alt);
    row.addEventListener("click", () => jumpToWindow(i));
    windowsListEl.appendChild(row);
  });
}

// Best moment in a window = where the MINIMUM altitude across all observers is
// MAXIMIZED. That's the instant when every observer simultaneously sees the
// ISS as high as it gets given the geometry.
function bestMomentMs(w) {
  const stepMs = 5000;
  let bestMs = w.startMs;
  let bestMinAlt = -Infinity;
  for (let t = w.startMs; t <= w.endMs; t += stepMs) {
    const issEcef = issEcefAt(new Date(t));
    if (!issEcef) continue;
    let minAlt = Infinity;
    for (const obs of state.observers) {
      const a = issAltitudeDeg(obs, issEcef);
      if (a < minAlt) minAlt = a;
    }
    if (minAlt > bestMinAlt) {
      bestMinAlt = minAlt;
      bestMs = t;
    }
  }
  return bestMs;
}

function jumpToWindow(i) {
  state.activeWindowIdx = i;
  const w = state.windows[i];
  const peakMs = bestMomentMs(w);
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(peakMs));
  viewer.clock.shouldAnimate = false;
  invalidateOrbitCache(); // force orbit refresh at the jumped time
  renderWindowsList();
}

findBtn.addEventListener("click", () => {
  state.windows = [];
  state.activeWindowIdx = -1;
  const startMs = Date.now();
  const endMs = startMs + state.horizonDays * 86_400_000;
  runSearch(startMs, endMs);
});

findMoreBtn.addEventListener("click", () => {
  if (!state.searchEndMs) {
    findBtn.click();
    return;
  }
  const startMs = state.searchEndMs;
  const endMs = startMs + state.horizonDays * 86_400_000;
  runSearch(startMs, endMs);
});

// ---------------------------------------------------------------------------
// Task 12: Playback controls + camera presets
// ---------------------------------------------------------------------------

const playBtn = document.getElementById("play-btn");
const pauseBtn = document.getElementById("pause-btn");
const resetBtn = document.getElementById("reset-btn");

playBtn.addEventListener("click", () => {
  viewer.clock.shouldAnimate = true;
});
pauseBtn.addEventListener("click", () => {
  viewer.clock.shouldAnimate = false;
});
resetBtn.addEventListener("click", () => {
  viewer.clock.currentTime = viewer.clock.startTime;
  viewer.clock.shouldAnimate = false;
  state.activeWindowIdx = -1;
  renderWindowsList();
});

// Camera presets
document.getElementById("camera-controls").addEventListener("click", (ev) => {
  const cam = ev.target?.dataset?.cam;
  if (!cam) return;
  if (cam === "frame") frameAll();
  else if (cam === "top") topDown();
  else if (cam === "rotate") toggleAutoRotate(ev.target);
});

function frameAll() {
  const positions = state.observers.map(o =>
    Cesium.Cartesian3.fromDegrees(o.lonDeg, o.latDeg, 0));
  if (positions.length === 0) {
    viewer.camera.flyHome(1.2);
    return;
  }
  if (positions.length === 1) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        state.observers[0].lonDeg, state.observers[0].latDeg, 5_000_000
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
  if (state.observers.length === 0) {
    viewer.camera.flyHome(1.2);
    return;
  }
  const avgLat = state.observers.reduce((s, o) => s + o.latDeg, 0) / state.observers.length;
  const avgLon = state.observers.reduce((s, o) => s + o.lonDeg, 0) / state.observers.length;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(avgLon, avgLat, 8_000_000),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    duration: 1.2,
  });
}

let rotateAnim = null;
function toggleAutoRotate(btn) {
  if (rotateAnim) {
    cancelAnimationFrame(rotateAnim);
    rotateAnim = null;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    btn.classList.remove("active");
    return;
  }
  btn.classList.add("active");
  // Rotate around the average observer if observers exist, else Earth center.
  let center = Cesium.Cartesian3.fromDegrees(0, 0, 0);
  if (state.observers.length) {
    const avgLat = state.observers.reduce((s, o) => s + o.latDeg, 0) / state.observers.length;
    const avgLon = state.observers.reduce((s, o) => s + o.lonDeg, 0) / state.observers.length;
    center = Cesium.Cartesian3.fromDegrees(avgLon, avgLat, 0);
  }
  viewer.camera.lookAtTransform(Cesium.Transforms.eastNorthUpToFixedFrame(center));
  function step() {
    viewer.camera.rotateRight(0.004);
    rotateAnim = requestAnimationFrame(step);
  }
  step();
}
