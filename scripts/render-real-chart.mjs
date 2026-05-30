// scripts/render-real-chart.mjs — render a REAL polar sky chart using
// the app's OWN painters (no re-implementation), for the OG card.
//
// This drives the exact same module pipeline as the live fullscreen
// modal (lib/pass-finder-scene.js → renderPolarModalInto): the same
// paintPolarModalStatic / arc / events / constellations / stars /
// sun-moon / legend functions, on a viewBox="-24 -68 248 278" SVG with
// MODAL_GEOM {cx:100, cy:100, R:90}. The only scene-coupled input —
// "where is the ISS at time t?" — is supplied here from a live TLE via
// satellite.js, identical to the scene's issEcefAt (ECEF metres).
//
// A jsdom document provides createElementNS/classList/dataset/style so
// the DOM-based painters run unchanged in Node. We serialize the painted
// SVG and print it to stdout (the OG builder nests it into the card).
//
// We pick a real *visible night* pass (dark sky + sunlit ISS) with the
// highest peak in the next 8 days — that's the chart that actually shows
// stars, constellations, a solid magnitude-graded arc and the Moon.
//
// Usage: node scripts/render-real-chart.mjs > /tmp/chart.svg
//   env OBS_NAME / OBS_LAT / OBS_LON / OBS_TZ override the observer.
import { JSDOM } from "jsdom";
import * as sat from "satellite.js";

// --- jsdom DOM globals the painters expect -----------------------------
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.document = dom.window.document;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.location = dom.window.location;        // legend reads location.search
globalThis.URLSearchParams = dom.window.URLSearchParams;
const SVG_NS = "http://www.w3.org/2000/svg";

// --- App painters (the real renderer) ----------------------------------
const { paintPolarModalStatic } = await import("../lib/pass-finder/polar-modal-frame.js");
const { computeArcSamples, renderArcSegments } = await import("../lib/pass-finder/polar-arc.js");
const { paintPolarModalEvents, passPeakMs } = await import("../lib/pass-finder/polar-events.js");
const { paintPolarModalConstellations } = await import("../lib/pass-finder/constellations.js");
const { paintPolarModalStars } = await import("../lib/pass-finder/polar-stars.js");
const { paintPolarModalSunMoon, paintPolarModalLegend } = await import("../lib/pass-finder/polar-bodies.js");
const { sunAltitudeDeg, issAltAzDeg, issIlluminated } = await import("../lib/pass-finder/visibility.js");
const { sunPositionEcef } = await import("../lib/pass-finder/sun.js");
const { naturalSkyLimMag, chartPalette, skyShadeForSunAlt } = await import("../lib/pass-finder/sky-helpers.js");
const { passWindowAtMsForObserver } = await import("../lib/pass-finder/observer-pass.js");

const MODAL_GEOM = { cx: 100, cy: 100, R: 90 };
const POLAR_ARC_COLOR = "#aab8d4";

const OBS = {
  id: "og",
  name: process.env.OBS_NAME || "Chicago",
  latDeg: process.env.OBS_LAT ? parseFloat(process.env.OBS_LAT) : 41.8781,
  lonDeg: process.env.OBS_LON ? parseFloat(process.env.OBS_LON) : -87.6298,
  tz: process.env.OBS_TZ || "America/Chicago",
  elevationM: 180,
};

// --- TLE (same sources as lib/pass-finder/tle.js) ----------------------
async function fetchTle() {
  const sources = [
    { url: "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE",
      parse: async (r) => { const L = (await r.text()).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (L.length < 3) throw 0; return { name: L[0], line1: L[1], line2: L[2] }; } },
    { url: "https://tle.ivanstanojevic.me/api/tle/25544",
      parse: async (r) => { const j = await r.json(); if (!j.line1) throw 0;
        return { name: j.name || "ISS (ZARYA)", line1: j.line1, line2: j.line2 }; } },
  ];
  for (const s of sources) {
    try {
      const resp = await fetch(s.url, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) return { ...(await s.parse(resp)), source: s.url };
    } catch { /* next */ }
  }
  throw new Error("all TLE sources failed");
}

let satrec = null;
// Mirror the scene's issEcefAt exactly: ECI → ECF, scaled to metres.
function issEcefAt(jsDate) {
  if (!satrec) return null;
  const pv = sat.propagate(satrec, jsDate);
  if (!pv || !pv.position) return null;
  const ecf = sat.eciToEcf(pv.position, sat.gstime(jsDate));
  return [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000];
}

// Find the best *visible night* pass: scan coarse, keep above-horizon
// arcs, score each by peak elevation but require dark sky + sunlit ISS
// at the peak so the chart shows a real naked-eye sighting. Fall back to
// the highest pass overall if (rarely) none are visible in the window.
// ISS visibility runs in multi-week cycles; a city can sit in a
// daytime-pass-only stretch for a week+. Scan far enough out to catch
// the next real dark-sky sighting (the OG image isn't time-sensitive).
const SCAN_DAYS = process.env.SCAN_DAYS ? parseFloat(process.env.SCAN_DAYS) : 45;

function findBestPass() {
  const t0 = Date.now();
  const t1 = t0 + SCAN_DAYS * 24 * 3600 * 1000;
  const STEP = 30 * 1000;
  let inPass = false, cur = null;
  const passes = [];
  for (let t = t0; t <= t1; t += STEP) {
    const e = issEcefAt(new Date(t));
    if (!e) continue;
    const { alt } = issAltAzDeg(OBS, e);
    if (alt > 0) {
      if (!inPass) { inPass = true; cur = { peakMs: t, peakAlt: alt }; }
      else if (alt > cur.peakAlt) { cur.peakAlt = alt; cur.peakMs = t; }
    } else if (inPass) { inPass = false; passes.push(cur); cur = null; }
  }
  if (inPass && cur) passes.push(cur);
  const scored = passes.map((p) => {
    const d = new Date(p.peakMs);
    const sunAlt = sunAltitudeDeg(OBS, d);
    const lit = issIlluminated(issEcefAt(d), sunPositionEcef(d));
    const visible = sunAlt <= -6 && lit;
    return { ...p, sunAlt, visible };
  });
  const visible = scored.filter((p) => p.visible);
  const pool = visible.length ? visible : scored;
  pool.sort((a, b) => b.peakAlt - a.peakAlt);
  return pool[0];
}

async function main() {
  const tle = await fetchTle();
  satrec = sat.twoline2satrec(tle.line1, tle.line2);

  const best = findBestPass();
  if (!best) throw new Error("no pass found");
  const peakMsTop = best.peakMs;

  // The observer's actual visible window (same call the modal makes).
  let obsWin = passWindowAtMsForObserver(OBS, peakMsTop, "visual", 10, issEcefAt);
  if (!obsWin) {
    // Horizon-to-horizon fallback (rare: peak not "visible" by the gate).
    let s = peakMsTop, e = peakMsTop;
    const ST = 1000, CAP = 12 * 60 * 1000;
    for (let t = peakMsTop; t >= peakMsTop - CAP; t -= ST) {
      const p = issEcefAt(new Date(t)); if (!p || issAltAzDeg(OBS, p).alt <= 0) break; s = t;
    }
    for (let t = peakMsTop; t <= peakMsTop + CAP; t += ST) {
      const p = issEcefAt(new Date(t)); if (!p || issAltAzDeg(OBS, p).alt <= 0) break; e = t;
    }
    obsWin = { startMs: s, endMs: e };
  }

  // --- Build the SVG root the modal uses ------------------------------
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "-24 -68 248 278");

  // --- Run the EXACT modal painter sequence (renderPolarModalInto) ----
  const sunAltAtPeak = sunAltitudeDeg(OBS, new Date(peakMsTop));
  const limMag = naturalSkyLimMag(sunAltAtPeak);
  const tzRefMs = obsWin.startMs;

  paintPolarModalStatic(svg, OBS, peakMsTop, sunAltAtPeak, { modalGeom: MODAL_GEOM, tzRefMs });
  // Arc (scene's paintPolarModalArc inlined: same color stash + sampler).
  const arc = svg.querySelector(".arc");
  const stroke = svg.dataset.arcStroke || POLAR_ARC_COLOR;
  const samples = computeArcSamples(OBS, obsWin, MODAL_GEOM.cx, MODAL_GEOM.cy, MODAL_GEOM.R, 60, issEcefAt);
  renderArcSegments(arc, samples, stroke, "1.4 1.8");

  const jsDate = new Date(peakMsTop);
  paintPolarModalEvents(svg, OBS, peakMsTop, obsWin, {
    modalGeom: MODAL_GEOM, issEcefAtFn: issEcefAt, polarArcColor: POLAR_ARC_COLOR,
  });
  paintPolarModalConstellations(svg, OBS, jsDate, sunAltAtPeak, MODAL_GEOM);
  paintPolarModalStars(svg, OBS, jsDate, limMag, MODAL_GEOM);
  paintPolarModalSunMoon(svg, OBS, jsDate, limMag, MODAL_GEOM);
  // NB: paintPolarModalLegend is intentionally NOT called — the OG card
  // wants just the circular sky chart, not the bottom-left legend box.

  // Trim to the circular sky chart for the OG card:
  //  • drop the chart's small bottom-right watermark — the card supplies
  //    its own big SeekSat wordmark + URL (also sidesteps the Exo 2
  //    @font-face that rsvg can't rasterize; the rest is system sans).
  //  • drop the opaque full-viewBox .bg rect so the card's own background
  //    shows through the chart's margins — no rectangular seam. The disc
  //    keeps its own twilight horizon fill.
  //  • drop the metadata header (title / date / coords / tz) — the card
  //    is a hero visual, not a labelled export.
  // The on-disc Start/Peak/End markers stay (they're part of the circle);
  // the event TEXT table sits above the disc (y < -8) and is cropped out
  // by the tight viewBox below.
  for (const el of svg.querySelectorAll(
    ".brand-wordmark, .brand-url, .bg, .meta-title, .meta-sub, .meta-tz"
  )) el.remove();
  // Crop the viewBox to just the disc + its cardinal/azimuth labels
  // (disc is centred at 100,100 with R=90; labels sit ~12 units out).
  svg.setAttribute("viewBox", "-8 -8 216 216");

  const xml = new XMLSerializer().serializeToString(svg);
  // Emit chart + chosen-pass metadata as a tiny JSON header line so the
  // OG builder can show a real caption, then the SVG.
  const meta = {
    observer: OBS,
    peakMs: peakMsTop,
    startMs: obsWin.startMs,
    endMs: obsWin.endMs,
    maxAlt: best.peakAlt,
    sunAltAtPeak,
    visible: !!best.visible,
    tle: { name: tle.name, source: tle.source },
  };
  process.stdout.write("<!--META " + JSON.stringify(meta) + " META-->\n" + xml);
}

main().catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
