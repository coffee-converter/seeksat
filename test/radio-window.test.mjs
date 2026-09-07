import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radioChartWindows } from '../lib/pass-finder/radio-window.js';
import { radioPassSamples } from '../lib/pass-finder/radio-pass.js';
import { geodeticToEcef } from '../lib/coords.js';

// A circular polar orbit passing directly over an observer at the North
// Pole. The pole is the useful fixture here: it is stationary in ECEF, so
// the observer has no velocity of its own to contaminate the range rate,
// and a satellite on this arc genuinely rises and sets rather than
// asymptoting toward the horizon the way a straight-line target does.
const GM = 3.986004418e14;
const A_ORB = 6791e3;                 // ~413 km above the pole
const N = Math.sqrt(GM / A_ORB ** 3); // mean motion, rad/s
const T0 = Date.UTC(2026, 8, 7, 12, 0, 0);
const OBS = { latDeg: 90, lonDeg: 0 };
const OBS_ECEF = geodeticToEcef(90, 0, 0);

const satAt = (t) => [A_ORB * Math.sin(N * t), 0, A_ORB * Math.cos(N * t)];
const issEcefAt = (d) => satAt((d.getTime() - T0) / 1000);

// Same orbit with velocity, for the sampler.
const satStateAt = (d) => {
  const t = (d.getTime() - T0) / 1000;
  const p = satAt(t);
  const v = [A_ORB * N * Math.cos(N * t), 0, -A_ORB * N * Math.sin(N * t)];
  return { rTeme: [...p], vTeme: v, rEcef: [...p], gmst: 0 };
};

const sampleSwing = (win) => {
  const { summary } = radioPassSamples(
    OBS, win,
    { satStateAt, obsEcef: OBS_ECEF, upEcef: [0, 0, 1] },
    { freqHz: 437.8e6, stepMs: 2000 },
  );
  return summary.dopplerPeakToPeakHz;
};

// ---- window selection ---------------------------------------------------

test('the full window reaches the horizon, well past a 10 degree cutoff', () => {
  const { full, workable } = radioChartWindows(OBS, T0, 'radio', 10, issEcefAt);
  const fullSec = (full.endMs - full.startMs) / 1000;
  const workSec = (workable.endMs - workable.startMs) / 1000;
  // Horizon crossing for this geometry is at cos(Nt) = b/a, about 319 s
  // either side, so the full pass runs ~10.6 min against ~6.7 min at 10 deg.
  assert.ok(fullSec > 600 && fullSec < 680, `full pass ${fullSec.toFixed(0)}s`);
  assert.ok(workSec > 380 && workSec < 430, `10 deg pass ${workSec.toFixed(0)}s`);
});

test('the workable window sits strictly inside the full one', () => {
  const { full, workable } = radioChartWindows(OBS, T0, 'radio', 10, issEcefAt);
  assert.ok(workable.startMs > full.startMs, 'workable must start later');
  assert.ok(workable.endMs < full.endMs, 'workable must end earlier');
});

test('no workable window when the threshold is zero - nothing to mark', () => {
  const { full, workable } = radioChartWindows(OBS, T0, 'radio', 0, issEcefAt);
  assert.ok(full);
  assert.equal(workable, null);
});

test('null when the satellite is not up at the anchor moment', () => {
  // Half an orbit later it is on the far side of the Earth.
  const belowMs = T0 + (Math.PI / N) * 1000;
  assert.equal(radioChartWindows(OBS, belowMs, 'radio', 10, issEcefAt), null);
});

test('a higher threshold never widens the full window', () => {
  // The full window is the physics; only the band inside it may move.
  const a = radioChartWindows(OBS, T0, 'radio', 5, issEcefAt).full;
  const b = radioChartWindows(OBS, T0, 'radio', 40, issEcefAt).full;
  assert.equal(a.startMs, b.startMs);
  assert.equal(a.endMs, b.endMs);
});

// ---- the invariant this module exists for -------------------------------

test('the reported Doppler swing does not move with the search filter', () => {
  // THE regression guard. Before this split, the chart spanned the gated
  // window, so nudging a filter control changed a physical measurement.
  const swings = [0, 5, 10, 25, 40].map(
    (deg) => sampleSwing(radioChartWindows(OBS, T0, 'radio', deg, issEcefAt).full),
  );
  for (const s of swings) {
    assert.ok(Math.abs(s - swings[0]) < 1e-6,
      `swing moved with the filter: ${swings.join(', ')}`);
  }
});

test('and the old behaviour understated it by a small but real margin', () => {
  // Documents the size of what the invariant protects. Sampling the gated
  // window loses ~1.5% of the swing for a zenith pass, because the range
  // rate is still climbing toward the horizon when a 10 deg cutoff stops it.
  //
  // Worth pinning the magnitude, because it is easy to overstate: the
  // often-quoted "92% at 10 deg vs 98% at 0 deg" figures are fractions of
  // the RELATIVE SPEED, not of each other. The window-to-window ratio is
  // 92.2/98.4, i.e. ~98.5% - a percent and a half, not six.
  const { full, workable } = radioChartWindows(OBS, T0, 'radio', 10, issEcefAt);
  const ratio = sampleSwing(workable) / sampleSwing(full);
  assert.ok(ratio < 0.99,
    `a 10 deg cutoff should understate the swing, got ${(ratio * 100).toFixed(1)}%`);
  assert.ok(ratio > 0.97,
    `but only by ~1.5%, got ${(ratio * 100).toFixed(1)}%`);
});

// ---- the walk cap -------------------------------------------------------

test('a never-setting target is clamped, not walked forever', () => {
  // passWindowAtMsForObserver caps its 1-second walk at 15 minutes per side.
  // Lowering the threshold to 0 lengthened every window, so confirm the cap
  // still bounds the degenerate case rather than hanging.
  const overhead = () => [0, 0, A_ORB];           // parked above the pole
  const { full } = radioChartWindows(OBS, T0, 'radio', 10, overhead);
  const sec = (full.endMs - full.startMs) / 1000;
  assert.ok(sec <= 30 * 60, `walk must be capped, got ${sec}s`);
  assert.ok(sec >= 30 * 60 - 2, `expected the full cap, got ${sec}s`);
});
