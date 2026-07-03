// scripts/build-icons.mjs — generate the site icons from the app's OWN
// renderers (no recreation), both showing the SAME real ISS pass:
//
//   app/icon.svg       — the chunky Cesium globe-label plot icon: horizon
//                        disc + single altitude ring + north marker + a fat
//                        (stroke-width 8) pass arc, painted by the real
//                        computeArcSamples/renderArcSegments.
//   app/apple-icon.png — the full polar sky chart (renderPassChartSVG, the
//                        same output the OG card + get_pass_chart MCP tool
//                        produce), rasterized 180×180.
//
// Pass selection (pickPass, below) scans real passes and prefers a HIGH,
// CURVED overhead pass whose peak falls in medium twilight (sun ≈ -6°), so
// the horizon shades a contrasty blue and the arc has real curvature —
// rather than selectPass's first-visible pick, which tends to be a low,
// straight, deep-night graze. Rendering is still 100% the app's code.
//
// Rerun to refresh against the current TLE. OBS_* env overrides observer.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getIssTle, issEcefAtFactory } from "../lib/og/tle.mjs";
import { firstObserver } from "../lib/og/pass-select.mjs";
import { renderPassChartSVG } from "../lib/og/render-pass-chart.mjs";
import { rasterizeSvg } from "../lib/og/rasterize.mjs";
import { newSvgRoot, serialize } from "../lib/og/dom.mjs";
import { computeArcSamples, renderArcSegments } from "../lib/pass-finder/polar-arc.js";
import { issAltAzDeg, issIlluminated, sunAltitudeDeg } from "../lib/pass-finder/visibility.js";
import { sunPositionEcef } from "../lib/pass-finder/sun.js";
import { passWindowAtMsForObserver } from "../lib/pass-finder/observer-pass.js";
import { passPeakMs } from "../lib/pass-finder/polar-events.js";
import { skyShadeForSunAlt, chartPalette, SVG_NS } from "../lib/pass-finder/sky-helpers.js";

// Above-horizon crossings around a peak — the same fallback selectPass uses
// when passWindowAtMsForObserver returns null (horizonWindow isn't exported).
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

// Scan real passes and pick the best HIGH + TWILIGHT one. Same pass-walk as
// pass-select's findNextVisiblePass; different scoring.
function pickPass(obs, issEcefAt, nowMs, scanDays) {
  const t1 = nowMs + scanDays * 86400_000, STEP = 30_000;
  let inPass = false, cur = null; const passes = [];
  for (let t = nowMs; t <= t1; t += STEP) {
    const e = issEcefAt(new Date(t)); if (!e) continue;
    const { alt } = issAltAzDeg(obs, e);
    if (alt > 0) {
      if (!inPass) { inPass = true; cur = { peakMs: t, peakAlt: alt }; }
      else if (alt > cur.peakAlt) { cur.peakAlt = alt; cur.peakMs = t; }
    } else if (inPass) { inPass = false; passes.push(cur); cur = null; }
  }
  if (inPass && cur) passes.push(cur);

  const scored = passes.map((p) => {
    const d = new Date(p.peakMs);
    return { ...p, sunAlt: sunAltitudeDeg(obs, d),
             lit: issIlluminated(issEcefAt(d), sunPositionEcef(d)) };
  });
  // Want a SOLID, curved arc on a still-blue sky. Solid needs the ISS
  // naked-eye visible (sun below ~-6 → the renderer stops dashing);
  // "medium twilight" keeps the sky blue by staying above astronomical
  // dark (sun down to ~-11). Within that band, take the HIGHEST pass —
  // higher peak = the arc curves harder around the zenith.
  const band = (lo, hi) => scored.filter((p) =>
    p.lit && p.sunAlt <= hi && p.sunAlt >= lo);
  const pool = band(-11, -6).length ? band(-11, -6)   // ideal: solid + blue
    : band(-14, -4).length ? band(-14, -4)            // widen if none
    : scored.filter((p) => p.lit);                    // last resort: any lit
  if (!pool.length) return null;
  return pool.sort((a, b) => b.peakAlt - a.peakAlt)[0];
}

const decoded = {
  observers: [{
    name: process.env.OBS_NAME || "Chicago",
    latDeg: process.env.OBS_LAT ? +process.env.OBS_LAT : 41.8781,
    lonDeg: process.env.OBS_LON ? +process.env.OBS_LON : -87.6298,
  }],
};

const issEcefAt = issEcefAtFactory(await getIssTle());
const observer = firstObserver(decoded);
const best = pickPass(observer, issEcefAt, Date.now(), 45);
if (!best) throw new Error("no suitable high/twilight pass found");
const win = passWindowAtMsForObserver(observer, best.peakMs, "visual", 10, issEcefAt)
          ?? horizonWindow(observer, issEcefAt, best.peakMs);
const peakMs = passPeakMs(win, observer, issEcefAt);
const sel = { observer, win, peakMs, maxAlt: best.peakAlt };
console.log(`Pass: peak ${best.peakAlt.toFixed(0)}° alt, sun ${best.sunAlt.toFixed(1)}° ` +
            `at ${new Date(peakMs).toISOString()}`);

const addNs = (s) => s.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');

// Render the full chart FIRST — it stamps the exact sky shade + arc color
// it used onto the root (data-sky-shade / data-arc-stroke). We reuse those
// for the favicon so the two icons share one palette by construction,
// rather than recomputing (which risked a hue mismatch).
const chart = addNs(renderPassChartSVG({ ...sel, issEcefAt, satName: "ISS", full: false }));
const pick = (re, fb) => (chart.match(re)?.[1]) ?? fb;
const shade = pick(/data-sky-shade="([^"]+)"/, skyShadeForSunAlt(sunAltitudeDeg(observer, new Date(peakMs))));
const arcStroke = pick(/data-arc-stroke="([^"]+)"/, chartPalette(sunAltitudeDeg(observer, new Date(peakMs))).arc);

// ---- Favicon: the chunky globe-label plot icon -------------------------
// Geometry + styling copied 1:1 from lib/pass-finder-scene.js
// buildObserverLabel + the .observer-label-icon rules in pass-finder.css.
const R = 42, cx = 50, cy = 50;

const label = newSvgRoot("0 0 100 100");
const style = document.createElementNS(SVG_NS, "style");
style.textContent =
  `.horizon{fill:${shade};stroke:rgba(126,184,255,0.55);stroke-width:1.6}` +
  `.grid{fill:none;stroke:rgba(126,184,255,0.18);stroke-width:0.8}` +
  `.arc line,.arc polyline{fill:none;stroke-width:8;stroke-linecap:round;stroke-linejoin:round}`;
label.appendChild(style);
const mk = (tag, attrs) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
label.appendChild(mk("circle", { class: "horizon", cx, cy, r: R }));
label.appendChild(mk("circle", { class: "grid", cx, cy, r: ((90 - 60) / 90) * R }));
label.appendChild(mk("path", { d: "M 50 2 L 57 11 L 43 11 Z", fill: "rgba(126,184,255,0.85)" }));
const arc = mk("g", { class: "arc" });
label.appendChild(arc);
const samples = computeArcSamples(observer, win, cx, cy, R, 30, issEcefAt);
renderArcSegments(arc, samples, arcStroke, "6 11");

const iconSvg = addNs(serialize(label));
writeFileSync(fileURLToPath(new URL("../app/icon.svg", import.meta.url)), iconSvg + "\n");
console.log(`Wrote app/icon.svg (${iconSvg.length} bytes)`);

// ---- Apple touch icon: the full real chart (rendered above) ------------
const pngSvg = chart.replace(/(<svg\b[^>]*>)/,
  '$1<rect x="-8" y="-8" width="216" height="216" fill="#0a0e1a"/>');
const png = await rasterizeSvg(pngSvg, { width: 180 });
writeFileSync(fileURLToPath(new URL("../app/apple-icon.png", import.meta.url)), png);
console.log(`Wrote app/apple-icon.png (${png.length} bytes)`);
