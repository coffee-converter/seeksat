import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSvgRoot } from '../lib/og/dom.mjs';
import { paintRadioChart } from '../lib/pass-finder/radio-chart.js';
import { radioPassSamples } from '../lib/pass-finder/radio-pass.js';
import { geodeticToEcef } from '../lib/coords.js';

// Paints the real chart into a server-side DOM (the same one the OG card
// route uses) and checks nothing runs off the right edge.
//
// This exists because every header line used to be a single unwrapped
// <text>. Content past the viewBox is silently clipped in both the modal
// image and the saved PNG, and the readouts line reached 322 of 320 units
// in the shipped default configuration - ISS on its longest catalog label,
// a 10 deg threshold, two observers - the moment one more caption clause
// was added. Nothing failed; the tail just disappeared.

const VIEWBOX_W = 320;
// Conservative average advance as a fraction of font size. Arimo measures
// nearer 0.45 for this copy; 0.6 leaves headroom for a wide fallback face
// (a Linux sans-serif resolving to DejaVu runs ~8-10% wider than Arial).
const ADVANCE = 0.6;
const FONT_PX = {
  'rc-head': 4.4, 'rc-label': 3.2, 'rc-meth': 2.9,
  'rc-panel': 3.0, 'rc-tick': 2.7, 'rc-axis': 2.7,
};

const E = geodeticToEcef(90, 0, 0);
const T0 = Date.UTC(2026, 8, 7, 9, 25, 0);
const stateAt = (d) => {
  const t = (d.getTime() - T0) / 1000;
  const p = [7500 * t, 0, E[2] + 739800];
  return { rTeme: [...p], vTeme: [7500, 0, 0], rEcef: [...p], gmst: 0 };
};
const series = (freqHz) => radioPassSamples(
  { latDeg: 90, lonDeg: 0 }, { startMs: T0 - 182000, endMs: T0 + 182000 },
  { satStateAt: stateAt, obsEcef: E, upEcef: [0, 0, 1] }, { freqHz, stepMs: 2000 });

function overflows(meta, freqHz = 437.8e6) {
  const svg = newSvgRoot('0 0 320 250');
  paintRadioChart(svg, series(freqHz), meta);
  const bad = [];
  for (const t of svg.querySelectorAll('text')) {
    const cls = t.getAttribute('class');
    const px = FONT_PX[cls];
    if (!px) continue;
    const anchor = t.getAttribute('text-anchor');
    if (anchor === 'end' || anchor === 'middle') continue; // measured from x
    const right = Number(t.getAttribute('x')) +
      (t.textContent ?? '').length * px * ADVANCE;
    if (right > VIEWBOX_W) bad.push(`${right.toFixed(1)}: ${t.textContent}`);
  }
  return bad;
}

const BASE = {
  satelliteName: 'ISS', observerName: 'My location',
  downlinkLabel: 'FM cross-band repeater', duty: 'on-demand',
  tz: 'America/Chicago', elevM: 244, elevSource: 'lookup', minElevDeg: 10,
  workableStartMs: T0 - 120000, workableEndMs: T0 + 120000,
};

test('no text runs past the viewBox in the shipped default configuration', () => {
  // ISS carries the longest label in the catalog and minElevDeg defaults to
  // 10, so this is what most users see.
  const bad = overflows({ ...BASE, freqHz: 437.8e6 });
  assert.deepEqual(bad, [], `overflowing lines:\n${bad.join('\n')}`);
});

test('nor with two observers, which adds a second band caption', () => {
  const bad = overflows({
    ...BASE, freqHz: 437.8e6,
    jointStartMs: T0 - 60000, jointEndMs: T0 + 45000,
  });
  assert.deepEqual(bad, [], `overflowing lines:\n${bad.join('\n')}`);
});

test('nor with the longest plausible satellite and observer names', () => {
  const bad = overflows({
    ...BASE, freqHz: 437.8e6,
    satelliteName: 'Meteor-M No.2-4',
    observerName: 'Kennedy Space Center Visitor Complex',
    jointStartMs: T0 - 60000, jointEndMs: T0 + 45000,
  });
  assert.deepEqual(bad, [], `overflowing lines:\n${bad.join('\n')}`);
});

test('nor on the no-frequency degrade path', () => {
  const bad = overflows({ ...BASE, freqHz: null, downlinkLabel: undefined,
    duty: undefined }, null);
  assert.deepEqual(bad, [], `overflowing lines:\n${bad.join('\n')}`);
});

test('the guard actually catches an overflow', () => {
  // Without this the four tests above could pass by measuring nothing.
  const bad = overflows({
    ...BASE, freqHz: 437.8e6,
    observerName: 'x'.repeat(400),
  });
  assert.ok(bad.length > 0, 'a 400-character observer name must overflow');
});
