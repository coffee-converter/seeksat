import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackAt, splitTrack, minuteTicks, labelSpot } from '../lib/live/dome.mjs';

const s = (tMs, azDeg, elDeg) => ({ tMs, azDeg, elDeg });
// A pass from 0 to 180 s: rises at az 100, peaks at 40° at 90 s, sets at az 260.
const pass = [s(0, 100, 0), s(60_000, 140, 30), s(90_000, 180, 40), s(120_000, 220, 30), s(180_000, 260, 0)];

test('trackAt interpolates and is null outside the pass', () => {
  assert.deepEqual(trackAt(pass, 30_000), { azDeg: 120, elDeg: 15 });
  assert.equal(trackAt(pass, -1), null);
  assert.equal(trackAt(pass, 180_001), null);
  // Across north, the short way.
  const t = trackAt([s(0, 350, 10), s(1000, 10, 10)], 500);
  assert.ok(t.azDeg < 1e-9 || Math.abs(t.azDeg - 360) < 1e-9);
});

test('splitTrack meets at now', () => {
  const { flown, ahead } = splitTrack(pass, 30_000);
  assert.equal(flown.length, 2);
  assert.deepEqual(flown.at(-1), { azDeg: 120, elDeg: 15 });
  assert.deepEqual(ahead[0], { azDeg: 120, elDeg: 15 });
  assert.equal(ahead.length, 5);
});

test('splitTrack: all ahead before rise, all flown after set', () => {
  assert.equal(splitTrack(pass, -5000).flown.length, 0);
  assert.equal(splitTrack(pass, -5000).ahead.length, 5);
  assert.equal(splitTrack(pass, 200_000).ahead.length, 0);
  assert.equal(splitTrack(pass, 200_000).flown.length, 5);
});

test('splitTrack leaves out samples below the horizon', () => {
  const { flown, ahead } = splitTrack([s(0, 0, -2), ...pass.map((p) => ({ ...p, tMs: p.tMs + 1000 }))], 500_000);
  assert.equal(flown.length + ahead.length, 5);
});

test('minuteTicks: one per whole minute, with points either side', () => {
  const ticks = minuteTicks(pass.map((p) => ({ ...p, tMs: p.tMs + 15_000 })));
  assert.deepEqual(ticks.map((t) => t.tMs), [60_000, 120_000, 180_000]);
  const mid = ticks[1];
  assert.ok(mid.before.azDeg < mid.azDeg && mid.after.azDeg > mid.azDeg);
});

test('minuteTicks: a tick at the last sample uses itself as the point after', () => {
  const ticks = minuteTicks(pass);
  const last = ticks.at(-1);
  assert.equal(last.tMs, 180_000);
  assert.deepEqual(last.after, { azDeg: last.azDeg, elDeg: last.elDeg });
});

test('labelSpot keeps labels inside the horizon ring', () => {
  const R = 100;
  // On the rim at east: pulled in, text runs left.
  const e = labelSpot(100, 0, R);
  assert.equal(e.x, 86);
  assert.equal(e.anchor, 'end');
  // On the rim at west: text runs right.
  assert.equal(labelSpot(-100, 0, R).anchor, 'start');
  // At north: centred under the point.
  const n = labelSpot(0, -100, R);
  assert.equal(n.anchor, 'middle');
  assert.equal(n.y, -86);
  // Near the centre: pushed out, text runs outward.
  const c = labelSpot(20, 0, R);
  assert.equal(c.x, 34);
  assert.equal(c.anchor, 'start');
  for (const [x, y] of [[100, 0], [70, 70], [0, 100], [-30, 10], [20, 0]]) {
    const p = labelSpot(x, y, R);
    assert.ok(Math.hypot(p.x, p.y) < R, `${x},${y}`);
  }
});
