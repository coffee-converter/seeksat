# ISS Triangulation Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, single-page CesiumJS webapp that triangulates a target's 3D position from N ≥ 2 ground observations (RA/Dec or Alt/Az) and visualizes the rays converging above a photoreal Earth, pre-filled with the Coffee + SEA FOAM ISS observation from 2026-05-11.

**Architecture:** Vanilla HTML + ES modules, no build step. Pure-math modules (`triangulate.js`, `coords.js`) with Node tests. Cesium handles 3D Earth/imagery/camera; `app.js` wires UI to math and Cesium entities using safe DOM construction (no `innerHTML` with user data). Optional `truth.js` uses satellite.js SGP4 for TLE overlay.

**Tech Stack:** CesiumJS (CDN), satellite.js (CDN), Node `node:test` built-in test runner, no npm deps.

**Reference spec:** `docs/superpowers/specs/2026-05-13-iss-triangulation-design.md`

---

## File Structure

```
iss-triangulation/
├── index.html
├── style.css
├── app.js              entry: bootstraps Cesium, wires panels and math
├── coords.js           DMS/RA parsing, direction vectors, WGS84, GMST, rotations
├── triangulate.js      N-ray least-squares closest point (pure math)
├── truth.js            satellite.js wrapper: TLE -> ECEF at timestamp
├── data/
│   └── monday.json
├── test/
│   ├── coords.test.mjs
│   └── triangulate.test.mjs
├── package.json        {"type":"module"} + test script (no deps)
├── .gitignore
└── README.md
```

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `.gitignore`, `README.md`, `index.html`, `style.css`, `app.js`, `data/.gitkeep`, `test/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "iss-triangulation",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
.DS_Store
node_modules/
*.log
```

- [ ] **Step 3: Create `README.md`**

```markdown
# ISS Triangulation

3D web viz that triangulates a satellite's position from two or more ground
observations and renders the sightlines on a CesiumJS Earth.

Pre-filled with the Coffee + SEA FOAM ISS observation from
2026-05-11 10:32:29 CDT.

## Run
Serve the folder (e.g. `python3 -m http.server 8000`) and open the URL.
No build step.

## Test
`npm test` runs the math/coords unit tests via Node's built-in test runner.
```

- [ ] **Step 4: Create `index.html` shell**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ISS Triangulation</title>
  <link rel="stylesheet" href="https://cesium.com/downloads/cesiumjs/releases/1.119/Build/Cesium/Widgets/widgets.css" />
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <div id="cesium-container"></div>

  <section id="panel-observations" class="panel panel-left">
    <header><h2>Observations</h2></header>
    <div class="timestamp-row">
      <label>UTC <input id="ts-utc" type="text" value="2026-05-11T15:32:29Z" /></label>
      <span id="ts-local" class="hint"></span>
    </div>
    <table id="obs-table">
      <thead>
        <tr><th>Name</th><th>Lat</th><th>Lon</th><th>Elev (m)</th><th>Mode</th><th>v1</th><th>v2</th><th></th></tr>
      </thead>
      <tbody></tbody>
    </table>
    <button id="add-obs" type="button">+ Add observation</button>
  </section>

  <section id="panel-result" class="panel panel-right">
    <header><h2>Result</h2></header>
    <div id="result-triangulated" class="result-block"></div>
    <div id="result-residuals" class="result-block"></div>
    <details id="tle-details">
      <summary>Compare to TLE truth</summary>
      <textarea id="tle-line1" placeholder="ISS (ZARYA)"></textarea>
      <textarea id="tle-line2" placeholder="1 25544U ..."></textarea>
      <textarea id="tle-line3" placeholder="2 25544 ..."></textarea>
      <div id="result-truth" class="result-block"></div>
    </details>
  </section>

  <nav id="camera-controls">
    <button data-cam="frame">Frame all</button>
    <button data-cam="coffee">From Coffee</button>
    <button data-cam="seafoam">From SeaFoam</button>
    <button data-cam="top">Top down</button>
  </nav>

  <footer id="credit">
    ISS triangulation · Coffee + SEA FOAM · 2026-05-11 10:32:29 CDT
  </footer>

  <script src="https://cesium.com/downloads/cesiumjs/releases/1.119/Build/Cesium/Cesium.js"></script>
  <script src="https://unpkg.com/satellite.js@5.0.0/dist/satellite.min.js"></script>
  <script type="module" src="./app.js"></script>
</body>
</html>
```

- [ ] **Step 5: Create `style.css`**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #0a0e1a; color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px; line-height: 1.5; }
#cesium-container { width: 100vw; height: 100vh; }

.panel {
  position: absolute; top: 16px;
  background: rgba(10, 14, 26, 0.92);
  border: 1px solid rgba(100, 140, 255, 0.3);
  border-radius: 12px;
  padding: 14px 16px;
  backdrop-filter: blur(12px);
  max-width: 460px;
  max-height: calc(100vh - 32px);
  overflow: auto;
  z-index: 1000;
}
.panel-left { left: 16px; }
.panel-right { right: 16px; max-width: 340px; }
.panel h2 { font-size: 14px; color: #7eb8ff; margin-bottom: 10px;
  text-transform: uppercase; letter-spacing: 0.08em; }
.panel input[type=text], .panel textarea, .panel select {
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  color: #e0e0e0; padding: 4px 6px; border-radius: 4px;
  font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px;
}
.panel textarea { width: 100%; min-height: 26px; resize: vertical; margin-top: 4px; }
.panel button {
  background: rgba(126, 184, 255, 0.12); border: 1px solid rgba(126, 184, 255, 0.4);
  color: #cfe0ff; padding: 6px 10px; border-radius: 6px; cursor: pointer;
  font-size: 12px; margin-top: 8px;
}
.panel button:hover { background: rgba(126, 184, 255, 0.22); }

.timestamp-row { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.timestamp-row input { width: 200px; }
.hint { color: #8899bb; font-size: 11px; }

#obs-table { width: 100%; border-collapse: collapse; font-size: 12px; }
#obs-table th { text-align: left; color: #8899bb; font-weight: 500;
  padding: 4px 4px; border-bottom: 1px solid rgba(255,255,255,0.08); }
#obs-table td { padding: 3px 2px; vertical-align: top; }
#obs-table input { width: 100%; min-width: 70px; }
#obs-table input[data-field=name] { min-width: 60px; }
#obs-table input[data-field=v1], #obs-table input[data-field=v2] { min-width: 110px; }
.color-swatch { width: 14px; height: 14px; border-radius: 3px; display: inline-block;
  vertical-align: middle; margin-right: 4px; border: 1px solid rgba(255,255,255,0.15); }

.result-block { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px;
  background: rgba(255,255,255,0.04); padding: 8px 10px; border-radius: 6px;
  margin-bottom: 8px; white-space: pre-wrap; }
.result-block .label { color: #7eb8ff; font-weight: 600; }

#camera-controls { position: absolute; bottom: 16px; right: 16px;
  display: flex; gap: 6px; z-index: 1000; }
#camera-controls button {
  background: rgba(10, 14, 26, 0.92); border: 1px solid rgba(100, 140, 255, 0.3);
  color: #cfe0ff; padding: 6px 10px; border-radius: 6px; cursor: pointer;
  backdrop-filter: blur(12px); font-size: 12px;
}
#camera-controls button:hover { background: rgba(126, 184, 255, 0.18); }

#credit {
  position: absolute; bottom: 16px; left: 16px;
  color: #8899bb; font-size: 11px; letter-spacing: 0.04em;
  background: rgba(10,14,26,0.6); padding: 6px 10px; border-radius: 6px;
  backdrop-filter: blur(8px); z-index: 1000;
}
```

- [ ] **Step 6: Create empty `app.js` placeholder**

```js
// app.js -- wired in later tasks.
console.log("ISS Triangulation: app.js loaded");
```

- [ ] **Step 7: Create empty data + test dirs**

Run:
```bash
mkdir -p data test
touch data/.gitkeep test/.gitkeep
```

- [ ] **Step 8: Commit scaffolding**

```bash
git add -A
git commit -m "feat: scaffold iss-triangulation static site"
```

- [ ] **Step 9: Smoke test in a browser**

Run:
```bash
python3 -m http.server 8765
```
Open `http://localhost:8765/` and confirm: dark page renders, a Cesium globe appears in the background, both panels are visible, the `+ Add observation` button is clickable. (No data binding yet — empty table OK.)

---

## Task 2: coords.js — parsers (TDD)

**Files:**
- Create: `coords.js`, `test/coords.test.mjs`

- [ ] **Step 1: Write failing tests in `test/coords.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDmsToDecimal,
  parseRaToHours,
  parseDecToDegrees,
} from '../coords.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('parseDmsToDecimal: pure decimal passes through', () => {
  assert.ok(close(parseDmsToDecimal('42.1544'), 42.1544));
  assert.ok(close(parseDmsToDecimal('-88.2'), -88.2));
});

test('parseDmsToDecimal: coffee lat with N hemisphere', () => {
  // 42°09'15.9"N = 42 + 9/60 + 15.9/3600
  const v = parseDmsToDecimal(`42°09'15.9"N`);
  assert.ok(close(v, 42.154417, 1e-5), `got ${v}`);
});

test('parseDmsToDecimal: coffee lon with W hemisphere is negative', () => {
  const v = parseDmsToDecimal(`88°11'59.9"W`);
  assert.ok(close(v, -88.199972, 1e-5), `got ${v}`);
});

test('parseDmsToDecimal: smart quotes work', () => {
  const v = parseDmsToDecimal(`43°05′33.6″N`);
  assert.ok(close(v, 43.092667, 1e-5), `got ${v}`);
});

test('parseRaToHours: HMS string', () => {
  // 5h 30m 52.4110s = 5 + 30/60 + 52.411/3600 = 5.51455861...
  const v = parseRaToHours('5h 30m 52.4110s');
  assert.ok(close(v, 5.5145586, 1e-6), `got ${v}`);
});

test('parseRaToHours: space-separated', () => {
  const v = parseRaToHours('5 48 47.7690');
  assert.ok(close(v, 5.8132692, 1e-6), `got ${v}`);
});

test('parseDecToDegrees: degrees minutes seconds', () => {
  // 41° 51' 10.0489" = 41 + 51/60 + 10.0489/3600
  const v = parseDecToDegrees(`41° 51' 10.0489"`);
  assert.ok(close(v, 41.852791, 1e-5), `got ${v}`);
});

test('parseDecToDegrees: negative declination', () => {
  const v = parseDecToDegrees(`-12 30 45`);
  assert.ok(close(v, -12.5125, 1e-5), `got ${v}`);
});
```

- [ ] **Step 2: Run test, confirm failure**

Run: `npm test`
Expected: tests fail with "Cannot find module '../coords.js'" or "is not exported".

- [ ] **Step 3: Implement parsers in `coords.js`**

```js
// coords.js -- pure JS coord helpers. No Cesium dependency.

const DEG = Math.PI / 180;
const HOUR = Math.PI / 12;

// "42°09'15.9\"N" | "42.1544" | "-88.2" -> decimal degrees. N/E positive, S/W negative.
export function parseDmsToDecimal(str) {
  if (str == null) throw new Error('parseDmsToDecimal: null input');
  const s = String(str).trim().replace(/′/g, "'").replace(/″/g, '"');
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = s.match(
    /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['m]?\s*(?:(\d+(?:\.\d+)?)\s*["s]?)?)?\s*([NSEWnsew])?\s*$/
  );
  if (!m) throw new Error(`parseDmsToDecimal: cannot parse "${str}"`);
  const deg = parseFloat(m[1]);
  const min = m[2] ? parseFloat(m[2]) : 0;
  const sec = m[3] ? parseFloat(m[3]) : 0;
  const hemi = m[4] && m[4].toUpperCase();
  const baseSign = deg < 0 ? -1 : 1;
  const hemiSign = (hemi === 'S' || hemi === 'W') ? -1 : 1;
  return baseSign * hemiSign * (Math.abs(deg) + min / 60 + sec / 3600);
}

// "5h 30m 52.4110s" | "5 30 52.411" | "5.5145586" -> hours.
export function parseRaToHours(str) {
  const s = String(str).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = s.match(
    /^\s*(\d+(?:\.\d+)?)\s*[h:\s]\s*(\d+(?:\.\d+)?)\s*[m':\s]\s*(\d+(?:\.\d+)?)\s*[s"]?\s*$/
  );
  if (!m) throw new Error(`parseRaToHours: cannot parse "${str}"`);
  return parseFloat(m[1]) + parseFloat(m[2]) / 60 + parseFloat(m[3]) / 3600;
}

// "41° 51' 10.0489\"" | "-12 30 45" | decimal -> decimal degrees.
export function parseDecToDegrees(str) {
  return parseDmsToDecimal(str);
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add coords.js test/coords.test.mjs
git commit -m "feat: coord parsers (DMS, RA hours, Dec degrees)"
```

---

## Task 3: coords.js — direction vectors and geodetic/ECI rotations (TDD)

**Files:**
- Modify: `coords.js`, `test/coords.test.mjs`

- [ ] **Step 1: Append failing tests to `test/coords.test.mjs`**

```js
import {
  raDecToEciDir,
  altAzToEnuDir,
  geodeticToEcef,
  gmstFromDate,
  eciToEcefRotate,
  enuToEcefRotate,
} from '../coords.js';

test('raDecToEciDir: RA=0 Dec=0 points at +X', () => {
  const v = raDecToEciDir(0, 0);
  assert.ok(close(v[0], 1) && close(v[1], 0) && close(v[2], 0));
});

test('raDecToEciDir: Dec=90 points at +Z', () => {
  const v = raDecToEciDir(12, 90);
  assert.ok(close(v[2], 1, 1e-9) && close(v[0], 0, 1e-9) && close(v[1], 0, 1e-9));
});

test('raDecToEciDir: RA=6h Dec=0 points at +Y', () => {
  const v = raDecToEciDir(6, 0);
  assert.ok(close(v[1], 1) && close(v[0], 0, 1e-9) && close(v[2], 0));
});

test('altAzToEnuDir: alt=90 points straight up', () => {
  const v = altAzToEnuDir(90, 0);
  assert.ok(close(v[2], 1) && close(v[0], 0, 1e-9) && close(v[1], 0, 1e-9));
});

test('altAzToEnuDir: alt=0 az=90 points east', () => {
  const v = altAzToEnuDir(0, 90);
  assert.ok(close(v[0], 1) && close(v[1], 0, 1e-9) && close(v[2], 0, 1e-9));
});

test('altAzToEnuDir: alt=0 az=0 points north', () => {
  const v = altAzToEnuDir(0, 0);
  assert.ok(close(v[1], 1) && close(v[0], 0, 1e-9) && close(v[2], 0, 1e-9));
});

test('geodeticToEcef: equator prime meridian sea level ~= (a, 0, 0)', () => {
  const [x, y, z] = geodeticToEcef(0, 0, 0);
  assert.ok(close(x, 6378137, 1), `x=${x}`);
  assert.ok(close(y, 0, 1) && close(z, 0, 1));
});

test('geodeticToEcef: north pole ~= (0, 0, b)', () => {
  const [x, y, z] = geodeticToEcef(90, 0, 0);
  // Polar radius b = a(1-f) = 6356752.3142
  assert.ok(close(x, 0, 1) && close(y, 0, 1));
  assert.ok(close(z, 6356752.3142, 1), `z=${z}`);
});

test('enuToEcefRotate: up at (0,0) points along +X', () => {
  const v = enuToEcefRotate([0, 0, 1], 0, 0);
  assert.ok(close(v[0], 1) && close(v[1], 0, 1e-9) && close(v[2], 0, 1e-9));
});

test('enuToEcefRotate: up at north pole points +Z', () => {
  const v = enuToEcefRotate([0, 0, 1], 90, 0);
  assert.ok(close(v[2], 1) && close(v[0], 0, 1e-9) && close(v[1], 0, 1e-9));
});

test('enuToEcefRotate: east at (0,0) points +Y', () => {
  const v = enuToEcefRotate([1, 0, 0], 0, 0);
  assert.ok(close(v[1], 1) && close(v[0], 0, 1e-9) && close(v[2], 0, 1e-9));
});

test('gmstFromDate: J2000 epoch GMST ~= 18.697374558 hours', () => {
  // 2000-01-01 12:00 UTC
  const g = gmstFromDate(new Date(Date.UTC(2000, 0, 1, 12, 0, 0)));
  const hours = (g / (2 * Math.PI)) * 24;
  assert.ok(close(hours, 18.697374558, 1e-3), `got ${hours} hours`);
});

test('eciToEcefRotate: zero GMST is identity', () => {
  const v = eciToEcefRotate([1, 2, 3], 0);
  assert.ok(close(v[0], 1) && close(v[1], 2) && close(v[2], 3));
});

test('eciToEcefRotate: GMST=pi/2 rotates +X to -Y', () => {
  const v = eciToEcefRotate([1, 0, 0], Math.PI / 2);
  assert.ok(close(v[0], 0, 1e-9));
  assert.ok(close(v[1], -1, 1e-9), `y=${v[1]}`);
});
```

- [ ] **Step 2: Run test, confirm new tests fail**

Run: `npm test`
Expected: new tests fail with import errors.

- [ ] **Step 3: Append implementations to `coords.js`**

```js
export function raDecToEciDir(raHours, decDeg) {
  const ra = raHours * HOUR;
  const dec = decDeg * DEG;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}

export function altAzToEnuDir(altDeg, azDeg) {
  const alt = altDeg * DEG;
  const az = azDeg * DEG;
  const ca = Math.cos(alt);
  return [Math.sin(az) * ca, Math.cos(az) * ca, Math.sin(alt)];
}

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export function geodeticToEcef(latDeg, lonDeg, elevM = 0) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return [
    (N + elevM) * cosLat * Math.cos(lon),
    (N + elevM) * cosLat * Math.sin(lon),
    (N * (1 - WGS84_E2) + elevM) * sinLat,
  ];
}

// GMST in radians via IAU 1982 model. Accurate to a few arc-seconds
// for ISS-altitude work -- well below amateur eyeball angular noise.
export function gmstFromDate(jsDate) {
  const jd = jsDate.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525.0;
  let gmstSec = 67310.54841
    + (876600 * 3600 + 8640184.812866) * T
    + 0.093104 * T * T
    - 6.2e-6 * T * T * T;
  gmstSec = ((gmstSec % 86400) + 86400) % 86400;
  return (gmstSec / 86400) * 2 * Math.PI;
}

// Rotate an ECI vector to ECEF via R_z(-GMST).
export function eciToEcefRotate(v, gmst) {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  return [c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2]];
}

// Rotate a local ENU vector at (lat, lon) into ECEF.
export function enuToEcefRotate(v, latDeg, lonDeg) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  const [e, n, u] = v;
  return [
    -sinLon * e - sinLat * cosLon * n + cosLat * cosLon * u,
     cosLon * e - sinLat * sinLon * n + cosLat * sinLon * u,
                  cosLat * n          + sinLat * u,
  ];
}
```

- [ ] **Step 4: Run tests, confirm all pass**

Run: `npm test`
Expected: all coords tests pass (parsing + vectors + rotations).

- [ ] **Step 5: Commit**

```bash
git add coords.js test/coords.test.mjs
git commit -m "feat: direction vectors, WGS84, GMST, ENU/ECI rotations"
```

---

## Task 4: triangulate.js — N-ray least-squares closest point (TDD)

**Files:**
- Create: `triangulate.js`, `test/triangulate.test.mjs`

- [ ] **Step 1: Write failing tests in `test/triangulate.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triangulateRays } from '../triangulate.js';

function rayFromTo(p, target) {
  const d = [target[0]-p[0], target[1]-p[1], target[2]-p[2]];
  const L = Math.hypot(...d);
  return { origin: p, dir: [d[0]/L, d[1]/L, d[2]/L] };
}

test('two perfect rays at known point', () => {
  const target = [10, 20, 30];
  const rays = [
    rayFromTo([0, 0, 0], target),
    rayFromTo([5, 0, 0], target),
  ];
  const { point, residuals } = triangulateRays(rays);
  assert.ok(point !== null);
  const err = Math.hypot(point[0]-10, point[1]-20, point[2]-30);
  assert.ok(err < 1e-6, `point error ${err}`);
  assert.ok(residuals.every(r => r < 1e-6));
});

test('three rays from non-coplanar origins', () => {
  const target = [100, -50, 200];
  const rays = [
    rayFromTo([0, 0, 0], target),
    rayFromTo([50, 0, 0], target),
    rayFromTo([0, 50, 10], target),
  ];
  const { point } = triangulateRays(rays);
  const err = Math.hypot(point[0]-100, point[1]+50, point[2]-200);
  assert.ok(err < 1e-6, `point error ${err}`);
});

test('parallel rays produce null (singular system)', () => {
  const rays = [
    { origin: [0, 0, 0], dir: [1, 0, 0] },
    { origin: [0, 1, 0], dir: [1, 0, 0] },
  ];
  const { point } = triangulateRays(rays);
  assert.equal(point, null);
});

test('noisy rays return point near truth with bounded residuals', () => {
  const target = [400000, 200000, 6800000]; // roughly ISS-altitude scale
  const observer1 = [-100000, 0, 6378000];
  const observer2 = [   100000, 0, 6378000];
  const r1 = rayFromTo(observer1, target);
  const r2 = rayFromTo(observer2, target);
  // Add ~2 arc-second noise to each direction via Rodrigues rotation
  // around an arbitrary axis perpendicular to the ray.
  const noise = 2 * (Math.PI / 180) / 3600;
  const tilt = (dir, theta) => {
    const k = [-dir[1], dir[0], 0];
    const kl = Math.hypot(...k);
    if (kl < 1e-9) return dir;
    const kn = [k[0]/kl, k[1]/kl, k[2]/kl];
    const c = Math.cos(theta), s = Math.sin(theta);
    const kd = kn[0]*dir[0] + kn[1]*dir[1] + kn[2]*dir[2];
    return [
      dir[0]*c + (kn[1]*dir[2]-kn[2]*dir[1])*s + kn[0]*kd*(1-c),
      dir[1]*c + (kn[2]*dir[0]-kn[0]*dir[2])*s + kn[1]*kd*(1-c),
      dir[2]*c + (kn[0]*dir[1]-kn[1]*dir[0])*s + kn[2]*kd*(1-c),
    ];
  };
  const rays = [
    { origin: r1.origin, dir: tilt(r1.dir,  noise) },
    { origin: r2.origin, dir: tilt(r2.dir, -noise) },
  ];
  const { point, residuals } = triangulateRays(rays);
  const err = Math.hypot(point[0]-target[0], point[1]-target[1], point[2]-target[2]);
  // Small noise; expect error well under 1 km at this geometry.
  assert.ok(err < 1000, `point error ${err} m`);
  assert.ok(residuals.every(r => r < 1000));
});
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm test`
Expected: triangulate tests fail with "Cannot find module '../triangulate.js'".

- [ ] **Step 3: Implement `triangulate.js`**

```js
// triangulate.js -- pure math. N-ray least-squares closest point.
// Input rays: [{ origin: [x,y,z], dir: [x,y,z] (unit) }, ...]
// Returns { point: [x,y,z] | null, residuals: number[] }.

function solve3(A, b) {
  const [a, b2, c] = A[0];
  const [d, e, f] = A[1];
  const [g, h, i] = A[2];
  const det = a*(e*i - f*h) - b2*(d*i - f*g) + c*(d*h - e*g);
  if (Math.abs(det) < 1e-30) return null;
  const inv = 1 / det;
  return [
    inv * ( b[0]*(e*i - f*h) - b2*(b[1]*i - f*b[2]) + c*(b[1]*h - e*b[2]) ),
    inv * ( a*(b[1]*i - f*b[2]) - b[0]*(d*i - f*g) + c*(d*b[2] - b[1]*g) ),
    inv * ( a*(e*b[2] - b[1]*h) - b2*(d*b[2] - b[1]*g) + b[0]*(d*h - e*g) ),
  ];
}

export function triangulateRays(rays) {
  const A = [[0,0,0],[0,0,0],[0,0,0]];
  const b = [0, 0, 0];
  for (const { origin: p, dir: d } of rays) {
    // Accumulate (I - d dT).
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        A[i][j] += (i === j ? 1 : 0) - d[i]*d[j];
      }
    }
    // Accumulate (I - d dT) p = p - (d . p) d.
    const dp = d[0]*p[0] + d[1]*p[1] + d[2]*p[2];
    b[0] += p[0] - d[0]*dp;
    b[1] += p[1] - d[1]*dp;
    b[2] += p[2] - d[2]*dp;
  }
  const x = solve3(A, b);
  if (!x) return { point: null, residuals: rays.map(() => Infinity) };
  const residuals = rays.map(({ origin: p, dir: d }) => {
    const vx = x[0]-p[0], vy = x[1]-p[1], vz = x[2]-p[2];
    const along = vx*d[0] + vy*d[1] + vz*d[2];
    const px = vx - d[0]*along, py = vy - d[1]*along, pz = vz - d[2]*along;
    return Math.hypot(px, py, pz);
  });
  return { point: x, residuals };
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test`
Expected: all triangulate tests pass, plus coords tests still green.

- [ ] **Step 5: Commit**

```bash
git add triangulate.js test/triangulate.test.mjs
git commit -m "feat: N-ray least-squares triangulation"
```

---

## Task 5: Pre-filled Monday observation data

**Files:**
- Create: `data/monday.json`

- [ ] **Step 1: Create `data/monday.json`**

```json
{
  "timestampUTC": "2026-05-11T15:32:29Z",
  "observations": [
    {
      "id": "coffee",
      "name": "Coffee",
      "color": "#ff9b54",
      "latDeg": 42.154417,
      "lonDeg": -88.199972,
      "elevM": 0,
      "dir": { "mode": "radec", "raHours": 5.5145586, "decDeg": 41.852791 },
      "rawLat": "42°09'15.9\"N",
      "rawLon": "88°11'59.9\"W",
      "rawV1": "5h 30m 52.4110s",
      "rawV2": "41° 51' 10.0489\""
    },
    {
      "id": "seafoam",
      "name": "SEA FOAM",
      "color": "#7fe5d1",
      "latDeg": 43.092667,
      "lonDeg": -88.021694,
      "elevM": 0,
      "dir": { "mode": "radec", "raHours": 5.8132692, "decDeg": 39.428422 },
      "rawLat": "43°05'33.6\"N",
      "rawLon": "88°01'18.1\"W",
      "rawV1": "5h 48m 47.7690s",
      "rawV2": "39° 25' 42.3185\""
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add data/monday.json
git commit -m "feat: add pre-filled Monday ISS observation data"
```

---

## Task 6: Cesium viewer initialization

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace `app.js` with viewer bootstrap**

```js
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
```

- [ ] **Step 2: Smoke test**

Run: `python3 -m http.server 8765`
Open `http://localhost:8765/`.
Expected: photoreal Earth fills the screen with stars and atmosphere; no Cesium toolbar; dark panels visible in front.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: bootstrap Cesium viewer with stars and lighting"
```

---

## Task 7: Render observers, rays, and triangulated point from Monday data

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Append the rendering pipeline to `app.js`**

After the viewer bootstrap, append:

```js
import {
  raDecToEciDir,
  altAzToEnuDir,
  geodeticToEcef,
  gmstFromDate,
  eciToEcefRotate,
  enuToEcefRotate,
} from "./coords.js";
import { triangulateRays } from "./triangulate.js";

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
```

- [ ] **Step 2: Smoke test**

Reload `http://localhost:8765/`.
Expected: Earth renders; two colored observer dots above IL/WI; two glowing rays extending up and meeting at a white triangulated point near 400 km altitude; camera auto-frames the geometry.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: render observers, rays, and triangulated point from Monday data"
```

---

## Task 8: Editable observations panel (safe DOM, no innerHTML)

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add parser imports, palette, and DOM-construction helpers**

Append to `app.js` (after the rendering pipeline, before the final `recompute()` call — move that final call to the very end of the file in a later step):

```js
import {
  parseDmsToDecimal,
  parseRaToHours,
  parseDecToDegrees,
} from "./coords.js";

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
```

- [ ] **Step 2: Add reactive parsing + event wiring**

Continue appending to `app.js`:

```js
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
      elevM: Number(get("elev") || 0),
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
```

(The final `recompute()` call from Task 7 stays at the end of the file.)

- [ ] **Step 3: Smoke test**

Reload `http://localhost:8765/`.
Expected: Both observation rows pre-filled with raw DMS/HMS strings. Edit Coffee's RA — the scene re-renders. Click ✕ on Coffee — only one observation remains and the scene stops updating (system needs ≥ 2). Adding rows works. Editing the UTC timestamp updates the local-time hint.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: editable observations panel with reactive recompute"
```

---

## Task 9: Result panel — triangulated lat/lon/alt + residuals (safe DOM)

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Append result-panel renderer to `app.js`**

```js
const elTri = document.getElementById("result-triangulated");
const elRes = document.getElementById("result-residuals");

function setBlock(el, headerText, lines) {
  el.replaceChildren();
  const hdr = document.createElement("span");
  hdr.className = "label";
  hdr.textContent = headerText;
  el.appendChild(hdr);
  for (const line of lines) {
    el.appendChild(document.createTextNode("\n" + line));
  }
}

function renderResultPanel() {
  if (!state.triangulated) {
    elTri.textContent = "Need >= 2 valid observations.";
    elRes.textContent = "";
    return;
  }
  const cart = Cesium.Cartographic.fromCartesian(
    Cesium.Cartesian3.fromElements(...state.triangulated)
  );
  const latDeg = Cesium.Math.toDegrees(cart.latitude);
  const lonDeg = Cesium.Math.toDegrees(cart.longitude);
  const altKm  = cart.height / 1000;
  setBlock(elTri, "Triangulated", [
    `lat  ${latDeg.toFixed(5)}°`,
    `lon  ${lonDeg.toFixed(5)}°`,
    `alt  ${altKm.toFixed(2)} km`,
  ]);

  const lines = state.residuals.map((r, i) => {
    const name = state.observations[i]?.name ?? `Obs ${i}`;
    return `${name.padEnd(10)} ${(r / 1000).toFixed(3)} km`;
  });
  setBlock(elRes, "Per-ray residuals", lines);
}

// Compose renderResultPanel onto recompute.
const _recompute1 = recompute;
recompute = function () {
  _recompute1();
  renderResultPanel();
};

// Re-render once now so the initial frame populates the panel.
renderResultPanel();
```

- [ ] **Step 2: Smoke test**

Reload `http://localhost:8765/`.
Expected: Right panel shows lat/lon/alt around (42.5° N, −88.1° W, ~400 km). Residuals should be small — single-digit km or less for a clean Monday observation. Edit Coffee's RA by +0.1h — triangulated point shifts north, residual numbers jump.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: result panel with triangulated lat/lon/alt and residuals"
```

---

## Task 10: TLE truth overlay

**Files:**
- Create: `truth.js`
- Modify: `app.js`

- [ ] **Step 1: Create `truth.js`**

```js
// truth.js -- SGP4 propagation via global `satellite` (satellite.js CDN).
// Returns ECEF position in meters at a JS Date, given a 2-line element set.

const sat = window.satellite;

export function tlePositionEcef(line1, line2, jsDate) {
  if (!sat) throw new Error("satellite.js not loaded");
  const satrec = sat.twoline2satrec(line1.trim(), line2.trim());
  const pv = sat.propagate(satrec, jsDate);
  if (!pv || !pv.position) return null;
  // satellite.js returns ECI (TEME) km. Convert to ECEF and to meters.
  const gmst = sat.gstime(jsDate);
  const ecf = sat.eciToEcf(pv.position, gmst);
  return [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000];
}
```

- [ ] **Step 2: Wire TLE inputs and truth entity in `app.js`**

Append to `app.js`:

```js
import { tlePositionEcef } from "./truth.js";

const tleL1 = document.getElementById("tle-line1");
const tleL2 = document.getElementById("tle-line2");
const tleL3 = document.getElementById("tle-line3");
const elTruth = document.getElementById("result-truth");

const truthLayer = { entity: null, miss: null };

function clearTruthLayer() {
  if (truthLayer.entity) viewer.entities.remove(truthLayer.entity);
  if (truthLayer.miss) viewer.entities.remove(truthLayer.miss);
  truthLayer.entity = null;
  truthLayer.miss = null;
}

function pickTleLines() {
  // Accept "ISS\n1 ...\n2 ..." or just the two TLE lines.
  const l1 = tleL1.value.trim();
  const l2 = tleL2.value.trim();
  const l3 = tleL3.value.trim();
  if (l1.startsWith("1 ") && l2.startsWith("2 ")) return [l1, l2];
  if (l2.startsWith("1 ") && l3.startsWith("2 ")) return [l2, l3];
  return null;
}

function renderTruth() {
  clearTruthLayer();
  elTruth.textContent = "";
  const lines = pickTleLines();
  if (!lines) return;
  const [line1, line2] = lines;

  let pos;
  try {
    pos = tlePositionEcef(line1, line2, new Date(state.timestampUTC));
  } catch (e) {
    elTruth.textContent = `TLE error: ${e.message}`;
    return;
  }
  if (!pos) {
    elTruth.textContent = "TLE propagation returned no position.";
    return;
  }

  truthLayer.entity = viewer.entities.add({
    position: Cesium.Cartesian3.fromElements(...pos),
    point: {
      pixelSize: 12,
      color: Cesium.Color.fromCssColorString("#7eb8ff").withAlpha(0.6),
      outlineColor: Cesium.Color.fromCssColorString("#7eb8ff"),
      outlineWidth: 2,
    },
    label: {
      text: "Truth (TLE)",
      font: "12px sans-serif",
      pixelOffset: new Cesium.Cartesian2(14, 10),
      fillColor: Cesium.Color.fromCssColorString("#7eb8ff"),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("rgba(10,14,26,0.7)"),
      backgroundPadding: new Cesium.Cartesian2(6, 4),
    },
  });

  if (state.triangulated) {
    const miss = Math.hypot(
      pos[0] - state.triangulated[0],
      pos[1] - state.triangulated[1],
      pos[2] - state.triangulated[2],
    );
    truthLayer.miss = viewer.entities.add({
      polyline: {
        positions: [
          Cesium.Cartesian3.fromElements(...state.triangulated),
          Cesium.Cartesian3.fromElements(...pos),
        ],
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString("#cfe0ff"),
          dashLength: 12,
        }),
        arcType: Cesium.ArcType.NONE,
      },
    });
    const cart = Cesium.Cartographic.fromCartesian(
      Cesium.Cartesian3.fromElements(...pos)
    );
    setBlock(elTruth, "Truth (TLE)", [
      `lat  ${Cesium.Math.toDegrees(cart.latitude).toFixed(5)}°`,
      `lon  ${Cesium.Math.toDegrees(cart.longitude).toFixed(5)}°`,
      `alt  ${(cart.height / 1000).toFixed(2)} km`,
      `Δ    ${(miss / 1000).toFixed(2)} km`,
    ]);
  }
}

[tleL1, tleL2, tleL3].forEach(el => el.addEventListener("input", renderTruth));

// Compose renderTruth onto recompute.
const _recompute2 = recompute;
recompute = function () {
  _recompute2();
  renderTruth();
};
```

- [ ] **Step 3: Smoke test**

Reload `http://localhost:8765/`. Open the "Compare to TLE truth" details and paste a TLE that covers 2026-05-11 (e.g. an archived ISS TLE from <https://celestrak.org/NORAD/archives/>). Format:

```
ISS (ZARYA)
1 25544U ...
2 25544 ...
```

Expected: a cyan "Truth (TLE)" ghost appears near (typically within tens of km of) the white triangulated marker, a dashed line links them, and the Δ km value populates in the truth panel.

- [ ] **Step 4: Commit**

```bash
git add truth.js app.js
git commit -m "feat: TLE truth overlay with SGP4 and miss distance"
```

---

## Task 11: Camera preset buttons

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Wire the four camera buttons**

Append to `app.js`:

```js
document.getElementById("camera-controls").addEventListener("click", (ev) => {
  const cam = ev.target?.dataset?.cam;
  if (!cam) return;
  switch (cam) {
    case "frame":   return frameAll();
    case "coffee":  return viewFromObserver(0);
    case "seafoam": return viewFromObserver(1);
    case "top":     return topDown();
  }
});

function viewFromObserver(idx) {
  const obs = state.observations[idx];
  if (!obs || !state.triangulated) return;
  const origin = geodeticToEcef(obs.latDeg, obs.lonDeg, obs.elevM || 0);
  const target = state.triangulated;
  const dir = [target[0]-origin[0], target[1]-origin[1], target[2]-origin[2]];
  const L = Math.hypot(...dir);
  const dirUnit = [dir[0]/L, dir[1]/L, dir[2]/L];
  // Stand back ~50 m behind the observer along the sightline.
  const camPos = [
    origin[0] - dirUnit[0]*50,
    origin[1] - dirUnit[1]*50,
    origin[2] - dirUnit[2]*50,
  ];
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromElements(...camPos),
    orientation: {
      direction: Cesium.Cartesian3.fromElements(...dirUnit),
      up: Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.fromElements(...origin), new Cesium.Cartesian3()),
    },
    duration: 1.2,
  });
}

function topDown() {
  if (!state.triangulated) return frameAll();
  const cart = Cesium.Cartographic.fromCartesian(
    Cesium.Cartesian3.fromElements(...state.triangulated)
  );
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      Cesium.Math.toDegrees(cart.longitude),
      Cesium.Math.toDegrees(cart.latitude),
      2_000_000
    ),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    duration: 1.2,
  });
}
```

- [ ] **Step 2: Smoke test**

Reload. Click each camera button: `Frame all` returns to the auto-framed shot; `From Coffee` puts the camera at Coffee's location looking toward the triangulated point (SeaFoam's ray should converge from the side); `From SeaFoam` mirrors that; `Top down` looks straight down from 2000 km altitude.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: camera preset buttons (frame, observer, top down)"
```

---

## Task 12: Final polish + smoke test + tag

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md` with usage + math notes**

Replace the body of `README.md` with:

```markdown
# ISS Triangulation

3D web viz that triangulates a satellite's position from two or more ground
observations and renders the sightlines on a CesiumJS Earth.

Pre-filled with the Coffee + SEA FOAM ISS observation from
**2026-05-11 10:32:29 CDT** (15:32:29 UTC).

## Run

    python3 -m http.server 8000

Then open <http://localhost:8000/>. No build step.

## Inputs

Each observation row: name, lat, lon, elevation (m), direction mode (RA/Dec
or Alt/Az), and two direction values. Lat/lon accept DMS strings
(`42°09'15.9"N`) or decimal. RA accepts `HH MM SS`, `HHh MMm SSs`, or
decimal hours. Dec accepts DMS or decimal.

## Math

- Each observation is converted to a ray in ECEF (Earth-Centered, Earth-Fixed).
- RA/Dec ray directions go ECI → ECEF via GMST rotation.
- Alt/Az ray directions go ENU → ECEF via the observer's local frame.
- Closest point to all rays is the least-squares minimizer of
  `Σ ‖(I − dᵢ dᵢᵀ)(x − pᵢ)‖²`, solved via a direct 3×3 inverse.

## TLE truth (optional)

Paste a two-line element set in the "Compare to TLE truth" panel. The
triangulated point and SGP4-propagated truth are shown together with the
miss distance in km.

## Test

    npm test

Runs pure-math unit tests via Node's built-in test runner (no npm deps).
```

- [ ] **Step 2: Full smoke test**

Reload `http://localhost:8765/`. Confirm:

- Pre-filled Monday data triangulates to ~400 km above the IL/WI border.
- Both rays glow in their callsign colors (orange / seafoam) and visibly converge.
- The triangulated marker gently pulses.
- Editing any input re-renders within ~one frame; bad input is silently ignored (warning in console).
- Removing an observation row that drops total below 2 stops updates without crash.
- Pasting an ISS TLE adds the cyan ghost + dashed Δ line.
- All four camera buttons work.
- Browser console is clean (no errors).

- [ ] **Step 3: Commit and tag**

```bash
git add README.md
git commit -m "docs: README usage and math notes"
git tag v0.1.0
```

---

## Self-Review Notes

- **Spec coverage check:** Every section of the design spec (goal, non-goals, architecture, UI, data model, math, visual design, pre-filled Monday data, testing, open items) is implemented or explicitly deferred to "open items." ✓
- **Placeholder scan:** No TBDs, no "appropriate error handling," every code step has actual code. The Monday TLE is a runtime user input, not a plan placeholder. ✓
- **Safe DOM:** No `innerHTML` is used anywhere with user-supplied content. Rows are built with `createElement` + `textContent`/`.value`; result/truth blocks use a `setBlock` helper that appends text nodes. The only XSS surface (observation names, lat/lon strings) flows through `textContent` and `input.value`. ✓
- **Type consistency:** `state.triangulated` is `[x,y,z] | null` throughout. `state.residuals` is `number[]`. Ray shape `{ origin, dir }` is consistent across `coords.js`, `triangulate.js`, and `app.js`. ECEF is meters everywhere; ECI direction is dimensionless unit. `geodeticToEcef` takes `(latDeg, lonDeg, elevM)` and returns meters in every call site. `tlePositionEcef` returns meters (km×1000) to match. ✓
- **Function naming:** `recompute`, `clearLayer`, `buildRay`, `frameAll`, `renderResultPanel`, `renderTruth`, `clearTruthLayer`, `viewFromObserver`, `topDown`, `setBlock`, `buildObsRow`, `renderObsRows`, `reparseObsFromDom` — all referenced consistently. ✓

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-13-iss-triangulation.md`.
