# Dynamic per-pass OG images — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every shared pass link (`/?s=<blob>`) render its actual polar sky chart in the OG/Twitter preview, served by a Node route that reuses the app's own chart painters — and unify the static `og.png` build onto the same pure-JS pipeline.

**Architecture:** A shared `lib/og/` module set decodes the share blob → picks the first station + pass time (explicit `t` or the next visible pass) → runs the real modal painters under a jsdom-backed DOM to produce the cropped circular chart SVG → composes the centered card → rasterizes to PNG with `@resvg/resvg-js` + bundled Arimo/Exo 2 fonts. `app/api/og/route.ts` (Node runtime) serves it with CDN caching; `app/page.tsx` `generateMetadata` points `og:image` at it. `scripts/build-og-image.mjs` calls the same modules to write `public/og.png`, replacing the Python/`rsvg`/`fonttools` build.

**Tech Stack:** Next.js 15 (App Router), Node runtime route handler, `satellite.js`, `jsdom`, `@resvg/resvg-js`, the existing `lib/pass-finder/*` painters, `node:test`.

**Spike already done (facts this plan relies on):** resvg-js renders the painters' class-based `<style>` CSS correctly (no flattening needed) and loads `fontBuffers` by family (Exo 2 renders as Exo 2, not a serif fallback). Verified locally before writing this plan.

**Amendment (during execution):** Tasks 10 and 11 extract their core into testable `lib/og/` helpers, because `node --test` cannot import the `@/`-aliased TypeScript/JSX framework entrypoints (`app/api/og/route.ts`, `app/page.tsx`). The route's request→Response logic lives in `lib/og/og-response.mjs` (`ogResponse(req)`); the metadata logic lives in `lib/og/og-metadata.mjs` (`ogImageMetadata(s)`). `route.ts` and `page.tsx` become thin adapters that delegate to these — unit-tested via `node:test` (Web `Request`/`Response` are Node globals), framework wiring verified via `npm run typecheck` + `npm run build`.

---

## File Structure

```
lib/og/
  dom.mjs              # jsdom-backed global DOM for the painters
  tle.mjs              # getIssTle() (TTL cache) + issEcefAtFactory(tle)
  pass-select.mjs      # decoded blob -> {observer, win, peakMs, sunAltAtPeak}
  render-pass-chart.mjs# {observer, win, peakMs, issEcefAt, sunAlt} -> cropped chart SVG
  build-card.mjs       # chartSVG -> 1200x630 card SVG (wordmark via font-family)
  rasterize.mjs        # cardSVG -> PNG Buffer (resvg-js + bundled fonts)
  render-og.mjs        # orchestrator: {decoded, getTle?} -> PNG Buffer
  fonts/
    Arimo-Regular.ttf  Arimo-Bold.ttf  Exo2-Regular.ttf  Exo2-SemiBold.ttf
    OFL.txt (Exo 2)    LICENSE-Apache-2.0.txt (Arimo)
app/api/og/route.ts    # GET ?s= -> image/png (or 302 -> /og.png)
app/page.tsx           # + generateMetadata({ searchParams })
scripts/build-og-image.mjs  # static entry -> public/og.png
test/og/
  tle.test.mjs  pass-select.test.mjs  render-pass-chart.test.mjs
  build-card.test.mjs  rasterize.test.mjs  render-og.test.mjs
  route.test.mjs  metadata.test.mjs
  fixtures/iss-tle.mjs        # frozen TLE for deterministic tests
```

**Removed at the end:** `scripts/build-og-image.py`, `scripts/render-real-chart.mjs`. The `/tmp/fontvenv` venv, `rsvg-convert`, and `fonttools` are no longer used by any build path.

**Conventions:** `lib/` is ESM `.mjs`/`.js` (no `"type":"module"` in package.json — the repo runs `.mjs` directly via `node`). Route + page are TypeScript. Tests are `node:test`.

---

## Task 1: Dependencies and font assets

**Files:**
- Modify: `package.json` (deps)
- Create: `lib/og/fonts/Arimo-Regular.ttf`, `lib/og/fonts/Arimo-Bold.ttf`, `lib/og/fonts/Exo2-Regular.ttf`, `lib/og/fonts/Exo2-SemiBold.ttf`, `lib/og/fonts/OFL.txt`, `lib/og/fonts/LICENSE-Apache-2.0.txt`
- Create: `lib/og/fonts/README.md`

- [ ] **Step 1: Install runtime deps**

Run:
```bash
npm install --save @resvg/resvg-js jsdom
```
(`jsdom` moves from devDependencies to dependencies — it is now used at runtime by the route.)
Expected: `package.json` `dependencies` gains `@resvg/resvg-js` and `jsdom`; remove the `jsdom` line from `devDependencies` if `npm` left it there.

- [ ] **Step 2: Generate the Exo 2 subset TTFs** (one-time, uses the existing fonttools venv)

Run:
```bash
/tmp/fontvenv/bin/python - <<'PY'
import base64, io, re
from pathlib import Path
from fontTools.ttLib import TTFont
js = Path("lib/pass-finder/exo2-embed.js").read_text()
blobs = re.findall(r"data:font/woff2;base64,([A-Za-z0-9+/=]+)", js)
Path("lib/og/fonts").mkdir(parents=True, exist_ok=True)
for b, style, wt in zip(blobs, ["Regular", "SemiBold"], [400, 600]):
    f = TTFont(io.BytesIO(base64.b64decode(b)))
    for nid, val in ((1, "Exo 2"), (2, style), (4, f"Exo 2 {style}")):
        f["name"].setName(val, nid, 3, 1, 0x409); f["name"].setName(val, nid, 1, 0, 0)
    f["OS/2"].usWeightClass = wt; f.flavor = None
    f.save(f"lib/og/fonts/Exo2-{style}.ttf")
print("wrote Exo2 TTFs")
PY
```
Expected: `lib/og/fonts/Exo2-Regular.ttf` and `Exo2-SemiBold.ttf` exist.

- [ ] **Step 3: Fetch Arimo Regular/Bold TTFs** (one-time)

Google's raw GitHub paths for Arimo are unreliable (404/HTML). Pull the
woff2 from the Fontsource CDN (stable) and convert to TTF with fonttools
(the same venv used in Step 2). Verified working at plan time.
```bash
for w in 400 700; do
  curl -fsSL "https://cdn.jsdelivr.net/npm/@fontsource/arimo@5/files/arimo-latin-$w-normal.woff2" -o "/tmp/arimo-$w.woff2"
done
/tmp/fontvenv/bin/python - <<'PY'
from fontTools.ttLib import TTFont
for w, style in [("400", "Regular"), ("700", "Bold")]:
    f = TTFont(f"/tmp/arimo-{w}.woff2"); f.flavor = None
    f.save(f"lib/og/fonts/Arimo-{style}.ttf")
print("wrote Arimo TTFs")
PY
file lib/og/fonts/Arimo-Regular.ttf lib/og/fonts/Arimo-Bold.ttf
```
Expected: both report `TrueType Font data`, family `Arimo`.

- [ ] **Step 4: Add license files** (from the Fontsource packages — verified working)

Run:
```bash
curl -fsSL "https://cdn.jsdelivr.net/npm/@fontsource/exo-2@5/LICENSE" -o lib/og/fonts/OFL.txt
curl -fsSL "https://cdn.jsdelivr.net/npm/@fontsource/arimo@5/LICENSE" -o lib/og/fonts/LICENSE-Apache-2.0.txt
```
Expected: `OFL.txt` starts with "Copyright 2013 The Exo 2 Project Authors"; `LICENSE-Apache-2.0.txt` contains the Apache License.

- [ ] **Step 5: Write the fonts README**

Create `lib/og/fonts/README.md`:
```markdown
# Bundled OG fonts

Rasterizing OG images on the server has no system fonts, so these are
loaded explicitly by `lib/og/rasterize.mjs`.

- **Arimo** (Apache-2.0) — chart labels + tagline. Metric-compatible with
  Arial/Helvetica, matching the app's `-apple-system` fallback look.
  Regenerate: see Task 1 of docs/superpowers/plans/2026-05-30-dynamic-og-images.md.
- **Exo 2** (OFL) Regular/SemiBold, subset to the wordmark glyphs — the
  same faces embedded in `lib/pass-finder/exo2-embed.js`.
```

- [ ] **Step 6: Verify and commit**

Run: `ls -la lib/og/fonts/ && file lib/og/fonts/*.ttf`
Expected: four `TrueType Font` files + two licenses + README.
```bash
git add package.json package-lock.json lib/og/fonts/
git commit -m "build: bundle Arimo + Exo 2 fonts and add resvg-js/jsdom for OG rendering"
```

---

## Task 2: DOM module

**Files:**
- Create: `lib/og/dom.mjs`
- Test: `test/og/dom.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/og/dom.test.mjs`:
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { SVG_NS, newSvgRoot, serialize } from "../../lib/og/dom.mjs";

test("newSvgRoot returns an svg element with the given viewBox", () => {
  const svg = newSvgRoot("-8 -8 216 216");
  assert.equal(svg.getAttribute("viewBox"), "-8 -8 216 216");
  assert.equal(svg.namespaceURI, SVG_NS);
});

test("painters can use global document; serialize yields a string", () => {
  const svg = newSvgRoot("0 0 10 10");
  const c = document.createElementNS(SVG_NS, "circle");
  c.classList.add("dot"); c.setAttribute("r", "3");
  svg.appendChild(c);
  const xml = serialize(svg);
  assert.match(xml, /<circle[^>]*class="dot"[^>]*\/?>/);
  assert.match(xml, /r="3"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/og/dom.test.mjs`
Expected: FAIL — cannot find module `lib/og/dom.mjs`.

- [ ] **Step 3: Implement**

Create `lib/og/dom.mjs`:
```javascript
// lib/og/dom.mjs — a jsdom-backed DOM so the pass-finder's DOM-based
// SVG painters (which call the global `document`, classList, dataset,
// style, querySelector…) run in Node, both in the build script and the
// serverless OG route. Importing this module installs the globals once;
// each render creates its own <svg> via newSvgRoot, so concurrent
// renders never share element state (document is only an element
// factory here).
import { JSDOM } from "jsdom";

export const SVG_NS = "http://www.w3.org/2000/svg";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.document = globalThis.document ?? dom.window.document;
globalThis.XMLSerializer = globalThis.XMLSerializer ?? dom.window.XMLSerializer;
globalThis.location = globalThis.location ?? dom.window.location;
globalThis.URLSearchParams = globalThis.URLSearchParams ?? dom.window.URLSearchParams;

export function newSvgRoot(viewBox) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  return svg;
}

export function serialize(svgEl) {
  return new XMLSerializer().serializeToString(svgEl);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/og/dom.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/og/dom.mjs test/og/dom.test.mjs
git commit -m "feat(og): jsdom-backed DOM module for headless painters"
```

---

## Task 3: TLE fetch + ISS sampler

**Files:**
- Create: `lib/og/tle.mjs`
- Create: `test/og/fixtures/iss-tle.mjs`
- Test: `test/og/tle.test.mjs`

- [ ] **Step 1: Create the fixture**

Create `test/og/fixtures/iss-tle.mjs`:
```javascript
// A frozen ISS TLE for deterministic tests (epoch 2026-ish). Values are
// a real historical ISS element set; tests assert geometry, not currency.
export const ISS_TLE = {
  name: "ISS (ZARYA)",
  line1: "1 25544U 98067A   26060.50000000  .00016717  00000-0  10270-3 0  9001",
  line2: "2 25544  51.6400 200.0000 0004700  30.0000 100.0000 15.50000000 10001",
};
// A fixed instant during a window where the ISS is above the horizon for
// the test observer below (precomputed to be > 0° at this epoch+obs).
export const SAMPLE_OBS = { name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 };
```

- [ ] **Step 2: Write the failing test**

Create `test/og/tle.test.mjs`:
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { issEcefAtFactory } from "../../lib/og/tle.mjs";
import { ISS_TLE } from "./fixtures/iss-tle.mjs";

test("issEcefAtFactory returns a finite ECEF metre triple", () => {
  const at = issEcefAtFactory(ISS_TLE);
  const e = at(new Date("2026-03-01T12:00:00Z"));
  assert.equal(e.length, 3);
  for (const v of e) assert.ok(Number.isFinite(v));
  // ISS orbital radius ~6.78e6 m from Earth centre.
  const r = Math.hypot(...e);
  assert.ok(r > 6.6e6 && r < 7.0e6, `radius ${r}`);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/og/tle.test.mjs`
Expected: FAIL — cannot find module `lib/og/tle.mjs`.

- [ ] **Step 4: Implement**

Create `lib/og/tle.mjs`:
```javascript
// lib/og/tle.mjs — fetch the current ISS TLE (same sources as
// lib/pass-finder/tle.js) with a short in-process TTL cache, plus a
// factory for the scene's issEcefAt sampler (ECEF metres) backed by
// satellite.js. Fluid Compute reuses instances, so the cache spares
// most requests a network round-trip.
import * as sat from "satellite.js";

const SOURCES = [
  { url: "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE",
    parse: async (r) => { const L = (await r.text()).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (L.length < 3) throw new Error("bad TLE"); return { name: L[0], line1: L[1], line2: L[2] }; } },
  { url: "https://tle.ivanstanojevic.me/api/tle/25544",
    parse: async (r) => { const j = await r.json(); if (!j.line1) throw new Error("bad JSON");
      return { name: j.name || "ISS (ZARYA)", line1: j.line1, line2: j.line2 }; } },
];

const TTL_MS = 30 * 60 * 1000;
let cache = null; // { tle, atMs }

export async function getIssTle(nowMs = Date.now()) {
  if (cache && nowMs - cache.atMs < TTL_MS) return cache.tle;
  for (const s of SOURCES) {
    try {
      const resp = await fetch(s.url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) continue;
      const tle = { ...(await s.parse(resp)), source: s.url };
      cache = { tle, atMs: nowMs };
      return tle;
    } catch { /* next source */ }
  }
  if (cache) return cache.tle; // stale beats nothing
  throw new Error("all TLE sources failed");
}

// Mirror lib/pass-finder-scene.js issEcefAt exactly: ECI -> ECF, metres.
export function issEcefAtFactory(tle) {
  const satrec = sat.twoline2satrec(tle.line1, tle.line2);
  return (jsDate) => {
    const pv = sat.propagate(satrec, jsDate);
    if (!pv || !pv.position) return null;
    const ecf = sat.eciToEcf(pv.position, sat.gstime(jsDate));
    return [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000];
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/og/tle.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/og/tle.mjs test/og/tle.test.mjs test/og/fixtures/iss-tle.mjs
git commit -m "feat(og): ISS TLE fetch with TTL cache + ECEF sampler"
```

---

## Task 4: Pass selection

**Files:**
- Create: `lib/og/pass-select.mjs`
- Test: `test/og/pass-select.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/og/pass-select.test.mjs`:
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstObserver, selectPass } from "../../lib/og/pass-select.mjs";
import { issEcefAtFactory } from "../../lib/og/tle.mjs";
import { ISS_TLE } from "./fixtures/iss-tle.mjs";

test("firstObserver clamps lat/lon and trims name", () => {
  const o = firstObserver({ observers: [
    { name: "x".repeat(80), latDeg: 200, lonDeg: -400 },
  ] });
  assert.equal(o.name.length, 40);
  assert.ok(o.latDeg <= 90 && o.latDeg >= -90);
  assert.ok(o.lonDeg <= 180 && o.lonDeg >= -180);
});

test("firstObserver returns null when no valid station", () => {
  assert.equal(firstObserver({ observers: [] }), null);
  assert.equal(firstObserver(null), null);
});

test("selectPass with no t finds a real above-horizon window", () => {
  const at = issEcefAtFactory(ISS_TLE);
  const decoded = { observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }],
                    passTimeMs: null, mode: "visual", minElevDeg: 10 };
  // Bound the scan to the fixture epoch so the test is fast + deterministic.
  const res = selectPass(decoded, at, { nowMs: Date.parse("2026-03-01T00:00:00Z"), scanDays: 3 });
  assert.ok(res, "a pass should be found");
  assert.ok(res.win.endMs > res.win.startMs);
  assert.ok(res.peakMs >= res.win.startMs && res.peakMs <= res.win.endMs);
  assert.ok(res.maxAlt > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/og/pass-select.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/og/pass-select.mjs`:
```javascript
// lib/og/pass-select.mjs — turn a decoded share blob into the concrete
// pass to chart: the first station (validated/clamped) and a window —
// the sharer's selected pass (explicit `t`) or the station's next
// visible (dark-sky) pass. Pure given an issEcefAt sampler.
import { issAltAzDeg, issIlluminated, sunAltitudeDeg } from "../pass-finder/visibility.js";
import { sunPositionEcef } from "../pass-finder/sun.js";
import { passWindowAtMsForObserver } from "../pass-finder/observer-pass.js";

export function firstObserver(decoded) {
  const o = decoded?.observers?.[0];
  if (!o || !Number.isFinite(o.latDeg) || !Number.isFinite(o.lonDeg)) return null;
  return {
    id: "og",
    name: String(o.name ?? "Observer").slice(0, 40),
    latDeg: Math.max(-90, Math.min(90, o.latDeg)),
    lonDeg: Math.max(-180, Math.min(180, o.lonDeg)),
    elevationM: 0,
  };
}

// Highest-peak visible (sun < -6°, ISS sunlit at peak) pass in the window.
function findNextVisiblePass(obs, issEcefAt, nowMs, scanDays) {
  const t1 = nowMs + scanDays * 86400_000;
  const STEP = 30_000;
  let inPass = false, cur = null;
  const passes = [];
  for (let t = nowMs; t <= t1; t += STEP) {
    const e = issEcefAt(new Date(t));
    if (!e) continue;
    const { alt } = issAltAzDeg(obs, e);
    if (alt > 0) {
      if (!inPass) { inPass = true; cur = { peakMs: t, peakAlt: alt }; }
      else if (alt > cur.peakAlt) { cur.peakAlt = alt; cur.peakMs = t; }
    } else if (inPass) { inPass = false; passes.push(cur); cur = null; }
  }
  if (inPass && cur) passes.push(cur);
  if (!passes.length) return null;
  const scored = passes.map((p) => {
    const d = new Date(p.peakMs);
    const visible = sunAltitudeDeg(obs, d) <= -6 && issIlluminated(issEcefAt(d), sunPositionEcef(d));
    return { ...p, visible };
  });
  const pool = scored.filter((p) => p.visible);
  return (pool.length ? pool : scored).sort((a, b) => b.peakAlt - a.peakAlt)[0];
}

// Walk out from a peak to the above-horizon crossings (fallback when the
// observer-pass visual window is null, e.g. a daytime/edge pass).
function horizonWindow(obs, issEcefAt, peakMs) {
  const STEP = 1000, CAP = 12 * 60 * 1000;
  let s = peakMs, e = peakMs;
  for (let t = peakMs; t >= peakMs - CAP; t -= STEP) {
    const p = issEcefAt(new Date(t)); if (!p || issAltAzDeg(obs, p).alt <= 0) break; s = t;
  }
  for (let t = peakMs; t <= peakMs + CAP; t += STEP) {
    const p = issEcefAt(new Date(t)); if (!p || issAltAzDeg(obs, p).alt <= 0) break; e = t;
  }
  return { startMs: s, endMs: e };
}

export function selectPass(decoded, issEcefAt, opts = {}) {
  const { nowMs = Date.now(), scanDays = 45 } = opts;
  const obs = firstObserver(decoded);
  if (!obs) return null;

  let peakMs;
  if (Number.isFinite(decoded.passTimeMs)) {
    peakMs = decoded.passTimeMs;
  } else {
    const best = findNextVisiblePass(obs, issEcefAt, nowMs, scanDays);
    if (!best) return null;
    peakMs = best.peakMs;
  }

  const mode = decoded.mode === "radio" ? "radio" : "visual";
  const minElev = Number.isFinite(decoded.minElevDeg) ? decoded.minElevDeg : 10;
  const win = passWindowAtMsForObserver(obs, peakMs, mode, minElev, issEcefAt)
            ?? horizonWindow(obs, issEcefAt, peakMs);

  // Peak altitude across the window (for the caller's caption/markers).
  let maxAlt = -90;
  for (let t = win.startMs; t <= win.endMs; t += 1000) {
    const e = issEcefAt(new Date(t)); if (!e) continue;
    const a = issAltAzDeg(obs, e).alt; if (a > maxAlt) maxAlt = a;
  }
  return { observer: obs, win, peakMs, maxAlt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/og/pass-select.test.mjs`
Expected: PASS (3 tests). If the no-`t` test finds no pass in 3 days for the fixture epoch, bump `scanDays` to `5` in the test.

- [ ] **Step 5: Commit**

```bash
git add lib/og/pass-select.mjs test/og/pass-select.test.mjs
git commit -m "feat(og): select first station + explicit/next-visible pass"
```

---

## Task 5: Chart painter module (the real renderer, cropped)

**Files:**
- Create: `lib/og/render-pass-chart.mjs`
- Test: `test/og/render-pass-chart.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/og/render-pass-chart.test.mjs`:
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPassChartSVG } from "../../lib/og/render-pass-chart.mjs";
import { selectPass } from "../../lib/og/pass-select.mjs";
import { issEcefAtFactory } from "../../lib/og/tle.mjs";
import { ISS_TLE } from "./fixtures/iss-tle.mjs";

test("renderPassChartSVG returns a cropped chart SVG (no header/legend/bg)", () => {
  const at = issEcefAtFactory(ISS_TLE);
  const sel = selectPass(
    { observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }],
      passTimeMs: null, mode: "visual", minElevDeg: 10 },
    at, { nowMs: Date.parse("2026-03-01T00:00:00Z"), scanDays: 5 });
  const svg = renderPassChartSVG({ ...sel, issEcefAt: at });
  assert.match(svg, /viewBox="-8 -8 216 216"/);   // cropped to the disc
  assert.match(svg, /class="arc"/);                // the pass arc group
  assert.match(svg, />N</);                         // cardinal label
  assert.doesNotMatch(svg, /meta-title/);           // header removed
  assert.doesNotMatch(svg, /legend-/);              // legend removed
  assert.doesNotMatch(svg, /class="bg"/);           // bg rect removed
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/og/render-pass-chart.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (ported from `scripts/render-real-chart.mjs`, which this replaces)

Create `lib/og/render-pass-chart.mjs`:
```javascript
// lib/og/render-pass-chart.mjs — render the REAL polar sky chart with
// the app's own modal painters (the lib/pass-finder-scene.js
// renderPolarModalInto sequence), cropped to the circular chart for the
// OG card. Importing ./dom.mjs installs the DOM the painters need.
import { newSvgRoot, serialize } from "./dom.mjs";
import { paintPolarModalStatic } from "../pass-finder/polar-modal-frame.js";
import { computeArcSamples, renderArcSegments } from "../pass-finder/polar-arc.js";
import { paintPolarModalEvents } from "../pass-finder/polar-events.js";
import { paintPolarModalConstellations } from "../pass-finder/constellations.js";
import { paintPolarModalStars } from "../pass-finder/polar-stars.js";
import { paintPolarModalSunMoon } from "../pass-finder/polar-bodies.js";
import { sunAltitudeDeg } from "../pass-finder/visibility.js";
import { naturalSkyLimMag } from "../pass-finder/sky-helpers.js";

const MODAL_GEOM = { cx: 100, cy: 100, R: 90 };
const POLAR_ARC_COLOR = "#aab8d4";

// { observer, win, peakMs, issEcefAt } -> cropped chart SVG string.
export function renderPassChartSVG({ observer, win, peakMs, issEcefAt }) {
  const svg = newSvgRoot("-24 -68 248 278"); // native modal viewBox while painting
  const sunAltAtPeak = sunAltitudeDeg(observer, new Date(peakMs));
  const limMag = naturalSkyLimMag(sunAltAtPeak);
  const jsDate = new Date(peakMs);

  paintPolarModalStatic(svg, observer, peakMs, sunAltAtPeak,
    { modalGeom: MODAL_GEOM, tzRefMs: win.startMs });

  const arc = svg.querySelector(".arc");
  const stroke = svg.dataset.arcStroke || POLAR_ARC_COLOR;
  const samples = computeArcSamples(observer, win, MODAL_GEOM.cx, MODAL_GEOM.cy, MODAL_GEOM.R, 60, issEcefAt);
  renderArcSegments(arc, samples, stroke, "1.4 1.8");

  paintPolarModalEvents(svg, observer, peakMs, win,
    { modalGeom: MODAL_GEOM, issEcefAtFn: issEcefAt, polarArcColor: POLAR_ARC_COLOR });
  paintPolarModalConstellations(svg, observer, jsDate, sunAltAtPeak, MODAL_GEOM);
  paintPolarModalStars(svg, observer, jsDate, limMag, MODAL_GEOM);
  paintPolarModalSunMoon(svg, observer, jsDate, limMag, MODAL_GEOM);
  // Legend intentionally not painted — OG wants just the circle.

  // Trim to the circular chart: drop watermark, full-bleed bg, and the
  // metadata header text. The on-disc Start/Peak/End markers stay; the
  // event TEXT table sits above the disc and is cropped by the viewBox.
  for (const el of svg.querySelectorAll(
    ".brand-wordmark, .brand-url, .bg, .meta-title, .meta-sub, .meta-tz"
  )) el.remove();
  svg.setAttribute("viewBox", "-8 -8 216 216");
  return serialize(svg);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/og/render-pass-chart.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/og/render-pass-chart.mjs test/og/render-pass-chart.test.mjs
git commit -m "feat(og): cropped real-chart renderer using the app painters"
```

---

## Task 6: Card composition

**Files:**
- Create: `lib/og/build-card.mjs`
- Test: `test/og/build-card.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/og/build-card.test.mjs`:
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCardSVG } from "../../lib/og/build-card.mjs";

test("buildCardSVG nests the chart and adds the wordmark", () => {
  const chart = `<svg viewBox="-8 -8 216 216"><circle/></svg>`;
  const card = buildCardSVG(chart);
  assert.match(card, /width="1200" height="630"/);
  assert.match(card, /Seek<\/tspan>/);
  assert.match(card, /Sat<\/tspan>/);
  assert.match(card, /font-family="Exo 2"/);
  assert.match(card, /seeksat\.com/);
  // chart nested with a placement box
  assert.match(card, /<svg x="\d+" y="\d+" width="478" height="478"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/og/build-card.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/og/build-card.mjs`:
```javascript
// lib/og/build-card.mjs — compose the 1200x630 OG card: the centered
// circular chart as the hero, the two-tone Exo 2 wordmark + tagline +
// URL beneath. Centering keeps the key content inside the middle square
// so surfaces that crop the 1.91:1 card to a square still read.
// Fonts resolve at rasterize time (resvg loads Exo 2 + Arimo buffers),
// so text uses font-family directly — no outline-path workaround.
const W = 1200, H = 630;
const SEEK = "#8aa0c8", SAT = "#7eb8ff", URL_GRAY = "#6a7a9a", TAGLINE = "#aab8d4";
const CHART_SIDE = 478;
const CHART_X = Math.round((W - CHART_SIDE) / 2);
const CHART_Y = 12;
const SANS = "Arimo, Helvetica, Arial, sans-serif";

export function buildCardSVG(chartSVG) {
  const chart = chartSVG.replace(
    /^<svg\b/,
    `<svg x="${CHART_X}" y="${CHART_Y}" width="${CHART_SIDE}" height="${CHART_SIDE}" preserveAspectRatio="xMidYMid meet"`,
  );
  const cx = W / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><radialGradient id="vign" cx="50%" cy="40%" r="75%">
    <stop offset="0%" stop-color="#0e1428"/><stop offset="100%" stop-color="#070a14"/>
  </radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#vign)"/>
  ${chart}
  <text x="${cx}" y="548" text-anchor="middle" font-family="Exo 2" font-weight="600" font-size="62" letter-spacing="1"><tspan fill="${SEEK}">Seek</tspan><tspan fill="${SAT}">Sat</tspan></text>
  <text x="${cx}" y="582" text-anchor="middle" font-family="${SANS}" font-size="22" letter-spacing="0.4" fill="${TAGLINE}">Satellite pass forecasts · visual &amp; radio · multi-station</text>
  <text x="${cx}" y="612" text-anchor="middle" font-family="Exo 2" font-weight="400" font-size="18" letter-spacing="2" fill="${URL_GRAY}">seeksat.com</text>
</svg>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/og/build-card.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/og/build-card.mjs test/og/build-card.test.mjs
git commit -m "feat(og): centered card composition (chart + wordmark)"
```

---

## Task 7: Rasterizer

**Files:**
- Create: `lib/og/rasterize.mjs`
- Test: `test/og/rasterize.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/og/rasterize.test.mjs`:
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { rasterizeCard } from "../../lib/og/rasterize.mjs";

test("rasterizeCard renders a 1200x630 PNG with Exo 2 (no system fonts)", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#0a0e1a"/>
    <text x="100" y="300" font-family="Exo 2" font-weight="600" font-size="90" fill="#7eb8ff">SeekSat</text>
    <text x="100" y="380" font-family="Arimo" font-size="30" fill="#aab8d4">N 30 60 90</text>
  </svg>`;
  const png = await rasterizeCard(svg);
  assert.ok(Buffer.isBuffer(png));
  // PNG magic number.
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  // IHDR width/height (bytes 16-23) = 1200 x 630.
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/og/rasterize.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/og/rasterize.mjs`:
```javascript
// lib/og/rasterize.mjs — SVG card -> PNG via @resvg/resvg-js. The server
// has no system fonts, so we load the bundled buffers explicitly:
// Arimo (chart labels + tagline) via defaultFontFamily, Exo 2 (wordmark)
// by name. resvg renders the chart's class-based <style> CSS natively.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const FONT_DIR = fileURLToPath(new URL("./fonts/", import.meta.url));
const FONT_BUFFERS = [
  "Arimo-Regular.ttf", "Arimo-Bold.ttf", "Exo2-Regular.ttf", "Exo2-SemiBold.ttf",
].map((f) => readFileSync(FONT_DIR + f));

export async function rasterizeCard(cardSVG) {
  const resvg = new Resvg(cardSVG, {
    fitTo: { mode: "width", value: 1200 },
    font: { loadSystemFonts: false, fontBuffers: FONT_BUFFERS, defaultFontFamily: "Arimo" },
  });
  return Buffer.from(resvg.render().asPng());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/og/rasterize.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/og/rasterize.mjs test/og/rasterize.test.mjs
git commit -m "feat(og): resvg-js rasterizer with bundled fonts"
```

---

## Task 8: Orchestrator

**Files:**
- Create: `lib/og/render-og.mjs`
- Test: `test/og/render-og.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/og/render-og.test.mjs`:
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderOgPng } from "../../lib/og/render-og.mjs";
import { ISS_TLE } from "./fixtures/iss-tle.mjs";

const decoded = {
  observers: [{ name: "Chicago", latDeg: 41.8781, lonDeg: -87.6298 }],
  passTimeMs: null, mode: "visual", minElevDeg: 10,
};

test("renderOgPng returns a 1200x630 PNG for a decoded blob", async () => {
  const png = await renderOgPng(decoded, {
    getTle: async () => ISS_TLE,
    nowMs: Date.parse("2026-03-01T00:00:00Z"), scanDays: 5,
  });
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test("renderOgPng throws when no station/pass", async () => {
  await assert.rejects(() => renderOgPng({ observers: [] }, { getTle: async () => ISS_TLE }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/og/render-og.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/og/render-og.mjs`:
```javascript
// lib/og/render-og.mjs — one call from a decoded share blob to OG PNG
// bytes. Shared by the serverless route and the static build. TLE source
// is injectable for tests.
import { getIssTle, issEcefAtFactory } from "./tle.mjs";
import { selectPass } from "./pass-select.mjs";
import { renderPassChartSVG } from "./render-pass-chart.mjs";
import { buildCardSVG } from "./build-card.mjs";
import { rasterizeCard } from "./rasterize.mjs";

export async function renderOgPng(decoded, opts = {}) {
  const { getTle = getIssTle, nowMs = Date.now(), scanDays = 45 } = opts;
  const tle = await getTle();
  const issEcefAt = issEcefAtFactory(tle);
  const sel = selectPass(decoded, issEcefAt, { nowMs, scanDays });
  if (!sel) throw new Error("no station or pass to render");
  const chart = renderPassChartSVG({ ...sel, issEcefAt });
  return rasterizeCard(buildCardSVG(chart));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/og/render-og.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/og/render-og.mjs test/og/render-og.test.mjs
git commit -m "feat(og): blob-to-PNG orchestrator"
```

---

## Task 9: Static build unification

**Files:**
- Create: `scripts/build-og-image.mjs`
- Delete: `scripts/build-og-image.py`, `scripts/render-real-chart.mjs`
- Modify: `package.json` (add `og:build` script)

- [ ] **Step 1: Implement the new static build**

Create `scripts/build-og-image.mjs`:
```javascript
// scripts/build-og-image.mjs — write public/og.png: the default static
// OG card, a real upcoming pass for a default location. Uses the same
// lib/og pipeline as the live /api/og route, so static and dynamic cards
// are identical in style. env OBS_NAME/OBS_LAT/OBS_LON override.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderOgPng } from "../lib/og/render-og.mjs";

const decoded = {
  observers: [{
    name: process.env.OBS_NAME || "Chicago",
    latDeg: process.env.OBS_LAT ? +process.env.OBS_LAT : 41.8781,
    lonDeg: process.env.OBS_LON ? +process.env.OBS_LON : -87.6298,
  }],
  passTimeMs: null, mode: "visual", minElevDeg: 10,
};

const out = fileURLToPath(new URL("../public/og.png", import.meta.url));
const png = await renderOgPng(decoded);
mkdirSync(fileURLToPath(new URL("../public/", import.meta.url)), { recursive: true });
writeFileSync(out, png);
console.log(`Wrote public/og.png (${png.length} bytes)`);
```

- [ ] **Step 2: Regenerate og.png and verify dimensions**

Run:
```bash
node scripts/build-og-image.mjs
node -e "const s=require('sharp');s('public/og.png').metadata().then(m=>console.log(m.width+'x'+m.height))"
```
Expected: `Wrote public/og.png (...)` then `1200x630`. Open `public/og.png` and confirm it looks like the committed card (real chart + Exo 2 wordmark).

- [ ] **Step 3: Remove the superseded build scripts**

Run:
```bash
git rm scripts/build-og-image.py scripts/render-real-chart.mjs
```

- [ ] **Step 4: Add an npm script**

In `package.json` `scripts`, add:
```json
"og:build": "node scripts/build-og-image.mjs"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/build-og-image.mjs package.json public/og.png
git commit -m "feat(og): unify static og.png onto the lib/og pipeline; drop python build"
```

---

## Task 10: Route handler

**Files:**
- Create: `app/api/og/route.ts`
- Test: `test/og/route.test.mjs`

- [ ] **Step 1: Write the failing test** (covers the no-network redirect paths)

Create `test/og/route.test.mjs`:
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../../app/api/og/route.ts";

test("missing ?s redirects to /og.png", async () => {
  const res = await GET(new Request("https://seeksat.com/api/og"));
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get("location"), "https://seeksat.com").pathname, "/og.png");
});

test("malformed ?s redirects to /og.png", async () => {
  const res = await GET(new Request("https://seeksat.com/api/og?s=%%%not-base64%%%"));
  assert.equal(res.status, 302);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/og/route.test.mjs`
Expected: FAIL — cannot import `route.ts` (module missing). Note: `node --test` runs `.ts` via the repo's Node which strips types (Node 22+ `--experimental-strip-types` is on by default in recent Node; if the import fails on types, see Step 4 note).

- [ ] **Step 3: Implement**

Create `app/api/og/route.ts`:
```typescript
// app/api/og/route.ts — dynamic per-pass OG image. Decodes the share
// blob (?s=), renders the first station's pass chart via the shared
// lib/og pipeline, returns a PNG. Any failure falls back to the static
// /og.png so the link always previews. Node runtime (jsdom + resvg).
import { decodeStateBlob } from "@/lib/pass-finder/state-blob.js";
import { renderOgPng } from "@/lib/og/render-og.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const s = new URL(req.url).searchParams.get("s");
  const fallback = () =>
    Response.redirect(new URL("/og.png", req.url), 302);

  const decoded = s ? decodeStateBlob(s) : null;
  if (!decoded || !decoded.observers?.length) return fallback();

  try {
    const png = await renderOgPng(decoded);
    const hasExplicit = Number.isFinite(decoded.passTimeMs);
    const cache = hasExplicit
      ? "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800"
      : "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: { "content-type": "image/png", "cache-control": cache },
    });
  } catch {
    return fallback();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/og/route.test.mjs`
Expected: PASS (2 tests).
Note: if `node --test` cannot import the `.ts` route (older Node without type-stripping), gate this test file with `// @ts`-free re-export, OR verify the route manually instead: `npm run dev` then `curl -sI "http://localhost:3000/api/og" | grep -i location` (expect `/og.png`) and `curl -s "http://localhost:3000/api/og?s=<valid-blob>" -o /tmp/og.png && file /tmp/og.png` (expect PNG 1200x630). Record which path was used.

- [ ] **Step 5: Manual happy-path check** (network)

Run dev server, build a real blob, hit the route:
```bash
node -e "import('./lib/pass-finder/state-blob.js').then(m=>console.log(m.encodeStateBlob({observers:[{name:'Chicago',latDeg:41.8781,lonDeg:-87.6298}]})))"
# copy the blob, then:
npm run dev &
sleep 6
curl -s "http://localhost:3000/api/og?s=PASTE_BLOB" -o /tmp/route-og.png
node -e "const s=require('sharp');s('/tmp/route-og.png').metadata().then(m=>console.log(m.width+'x'+m.height))"
```
Expected: `1200x630`. Open `/tmp/route-og.png` — a real Chicago pass card.

- [ ] **Step 6: Commit**

```bash
git add app/api/og/route.ts test/og/route.test.mjs
git commit -m "feat(og): /api/og dynamic per-pass image route"
```

---

## Task 11: Page metadata wiring

**Files:**
- Modify: `app/page.tsx`
- Test: `test/og/metadata.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/og/metadata.test.mjs`:
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMetadata } from "../../app/page.tsx";

test("generateMetadata points og:image at /api/og when ?s present", async () => {
  const md = await generateMetadata({ searchParams: Promise.resolve({ s: "ABC-123" }) });
  const url = md.openGraph.images[0].url;
  assert.match(url, /^\/api\/og\?s=ABC-123$/);
  assert.equal(md.twitter.images[0], url);
});

test("generateMetadata returns empty (static og.png) when no ?s", async () => {
  const md = await generateMetadata({ searchParams: Promise.resolve({}) });
  assert.deepEqual(md, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/og/metadata.test.mjs`
Expected: FAIL — `generateMetadata` is not exported.

- [ ] **Step 3: Implement**

Modify `app/page.tsx` to add the export (keep the existing default export):
```tsx
import type { Metadata } from "next";
import PassFinderApp from "@/components/PassFinderApp";
import "./pass-finder.css";

// Per-share OG image: when the URL carries a ?s= state blob, point the
// social preview at the dynamic /api/og renderer so a shared pass link
// previews that pass's actual sky chart. Without ?s=, inherit the
// static og.png from the root layout's metadata.
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<{ s?: string }> },
): Promise<Metadata> {
  const { s } = await searchParams;
  if (!s) return {};
  const img = `/api/og?s=${encodeURIComponent(s)}`;
  return {
    openGraph: { images: [{ url: img, width: 1200, height: 630 }] },
    twitter: { images: [img] },
  };
}

export default function HomePage() {
  return <PassFinderApp />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/og/metadata.test.mjs`
Expected: PASS (2 tests). (Same `.ts(x)` import caveat as Task 10 Step 4 — if the runner can't strip types, verify by building/`curl`ing the rendered `<head>` instead and note it.)

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx test/og/metadata.test.mjs
git commit -m "feat(og): per-share generateMetadata wiring og:image to /api/og"
```

---

## Task 12: Full suite, typecheck, and docs

**Files:**
- Modify: `README.md` (OG section, if one exists; else skip)
- Modify: `docs/superpowers/specs/2026-05-30-dynamic-og-images-design.md` (mark Implemented)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests pass, including the new `test/og/*`. Fix any regressions.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Resolves `app/api/og/route.ts` + `app/page.tsx` types.)

- [ ] **Step 3: Production build smoke**

Run: `npm run build`
Expected: build succeeds; `/api/og` appears as a dynamic (ƒ) route in the output.

- [ ] **Step 4: Update the spec status**

Edit the design doc header `**Status:**` to `Implemented (2026-…)`.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "docs(og): mark dynamic OG design implemented; suite + build green"
```

---

## Self-review notes (addressed)

- **Spec coverage:** behavior/trigger (Task 11 + 10), first-station (Task 4 `firstObserver`), explicit-`t` vs next-pass (Task 4 `selectPass`), real painters + crop (Task 5), card + wordmark (Task 6), resvg + Arimo/Exo 2 (Task 7 + Task 1), caching (Task 10), error→302 (Task 10), static unification + Python removal (Task 9), testing (every task). tz deliberately skipped — the cropped card removes the only text that used it (documented in Task 5).
- **resvg CSS/font risk:** retired by the pre-plan spike; no flatten task needed.
- **DOM dep:** jsdom kept (proven via the prior `render-real-chart.mjs`); the ~150-line shim remains a future optimization, not in scope — the route is CDN-cached so cold start is amortized.
- **Type-stripping caveat:** Tasks 10/11 note the `.ts(x)` import fallback for `node --test`.
- **Naming consistency:** `renderOgPng`, `renderPassChartSVG`, `buildCardSVG`, `rasterizeCard`, `selectPass`, `firstObserver`, `getIssTle`, `issEcefAtFactory` used identically across tasks.
