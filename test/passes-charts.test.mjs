import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { findPasses } from '../lib/passes/engine.mjs';
import { radioSeries, radioCsvText, chartStepMs, csvStepMs, passFileName, paintPassCard } from '../lib/passes/charts.js';
import { SVG_NS, newSvgRoot } from '../lib/og/dom.mjs';
import { chartPalette } from '../lib/pass-finder/sky-helpers.js';
import { sunAltitudeDeg } from '../lib/pass-finder/visibility.js';
import { apparentAltDeg } from '../lib/refraction.js';
import { CATALOG } from '../lib/catalog.mjs';
import { ISS_LINE1, ISS_LINE2, ISS_OMM } from './fixtures/omm-iss.mjs';
import { MOLNIYA_LINE1, MOLNIYA_LINE2, EN52VE, recordFrom } from './fixtures/orbits.mjs';

const ISS = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
const T0 = Date.parse('2026-03-01T12:00:00Z');
const DAY = 86_400_000;
const MOLNIYA = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M'));
const ISS_WITH_ENTRY = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'), CATALOG.find((c) => c.noradId === 25544));
const firstIssPass = findPasses({ track: ISS, observers: [EN52VE], startMs: T0, endMs: T0 + DAY }).passes[0];
const firstIssPeakMs = firstIssPass.peakMs;

test('radio series for an ISS pass keeps today\'s 2 s chart step and is not clamped', () => {
  const b = radioSeries({ track: ISS, obs: EN52VE, anchorMs: firstIssPeakMs, minElevDeg: 10, freqHz: 437_800_000 });
  assert.equal(b.clamped, false);
  const s = b.series.samples;
  assert.equal(s[1].tMs - s[0].tMs, 2000);
});
test('a Molniya radio series is the whole pass at a coarser step', () => {
  const b = radioSeries({ track: MOLNIYA, obs: EN52VE, anchorMs: Date.parse('2023-06-27T07:00:00Z'), minElevDeg: 10, freqHz: 1_000_000_000 });
  assert.equal(b.clamped, false);
  assert.ok(b.series.samples.length <= 1801);
});
test('csv step is 1 s for LEO passes', () => {
  assert.equal(csvStepMs(10 * 60_000), 1000);
  assert.equal(chartStepMs(10 * 60_000), 2000);
  assert.equal(chartStepMs(9 * 3_600_000), 18_000);
});
test('file names are unchanged for the ISS and generic for others', () => {
  const obs = { ...EN52VE, name: 'Home', tz: 'America/Chicago' };
  assert.match(passFileName(ISS_WITH_ENTRY, obs, firstIssPeakMs, 'sky'), /^iss-pass-home-/);
  assert.match(passFileName(ISS_WITH_ENTRY, obs, firstIssPeakMs, 'radio', 'csv'), /^radio-iss-home-.*\.csv$/);
  assert.match(passFileName(MOLNIYA, obs, firstIssPeakMs, 'sky'), /^m-pass-home-/);
});
test('CSV omits TLE lines for an OMM-only track', () => {
  const omm = makeTrack({ noradId: 25544, name: 'ISS', omm: ISS_OMM });
  const b = radioSeries({ track: omm, obs: EN52VE, anchorMs: firstIssPeakMs, minElevDeg: 10, freqHz: 437_800_000, purpose: 'csv' });
  const csv = radioCsvText(b, { track: omm, obs: EN52VE, generatedAtMs: T0, clockSkewMs: 0 });
  assert.ok(!csv.includes('undefined'));
});

// The pass card's skeleton, with the same classes PolarPlotSvg renders.
function cardSkeleton() {
  const svg = newSvgRoot('0 0 100 100');
  const horizon = document.createElementNS(SVG_NS, 'circle');
  horizon.setAttribute('class', 'horizon');
  svg.appendChild(horizon);
  for (const cls of ['bodies', 'arc', 'events']) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', cls);
    svg.appendChild(g);
  }
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('class', 'iss-dot');
  svg.appendChild(dot);
  return svg;
}

test('paintPassCard fills the arc, markers and horizon, and hides the dot outside the pass', () => {
  const svg = cardSkeleton();
  paintPassCard(svg, { track: ISS, obs: EN52VE, win: firstIssPass, nowMs: firstIssPass.startMs - 3_600_000 });
  // renderArcSegments draws the arc as line and polyline segments, in the
  // sky-adapted stroke for the sun at the pass peak (the engine's peak).
  const segs = [...svg.querySelector('.arc').querySelectorAll('line, polyline')];
  assert.ok(segs.length > 0);
  const stroke = chartPalette(apparentAltDeg(sunAltitudeDeg(EN52VE, new Date(firstIssPeakMs)))).arc;
  for (const seg of segs) assert.equal(seg.getAttribute('stroke'), stroke);
  // This daylight pass is not naked-eye visible, so it draws dashed.
  const dashed = segs.filter((seg) => seg.tagName.toLowerCase() === 'polyline');
  assert.ok(dashed.length > 0);
  for (const seg of dashed) assert.equal(seg.getAttribute('stroke-dasharray'), '4 6');
  // Markers are diamonds: the first vertex sits markerR above the centre,
  // the second markerR to its right.
  const markers = [...svg.querySelector('.events').children];
  assert.equal(markers.length, 3);
  for (const m of markers) {
    const [[x0, y0], [x1, y1]] = m.getAttribute('d').match(/-?[\d.]+,-?[\d.]+/g)
      .map((pt) => pt.split(',').map(Number));
    assert.ok(Math.abs(x1 - x0 - 2.8) < 0.02 && Math.abs(y1 - y0 - 2.8) < 0.02);
  }
  assert.ok(svg.querySelector('.horizon').style.fill);
  assert.ok(svg.querySelector('.bodies').children.length > 0);
  assert.equal(svg.querySelector('.iss-dot').style.display, 'none');
});
test('paintPassCard shows the dot while the satellite is up', () => {
  const svg = cardSkeleton();
  paintPassCard(svg, { track: ISS, obs: EN52VE, win: firstIssPass, nowMs: firstIssPeakMs });
  const dot = svg.querySelector('.iss-dot');
  assert.equal(dot.style.display, '');
  assert.ok(Number.isFinite(Number(dot.getAttribute('cx'))));
});
