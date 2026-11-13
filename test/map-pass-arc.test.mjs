import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passArc } from '../lib/map/pass-arc.mjs';
import { geodeticToEcef } from '../lib/coords.js';

// A satellite 400 km up running north along 5 degrees east, crossing the
// equator at T; the observer is on the equator at 0 degrees.
const T = 1_800_000_000_000;
const DEG_PER_MIN = 3.8;
const ecefAt = (d) => {
  const lat = ((d.getTime() - T) / 60_000) * DEG_PER_MIN;
  if (Math.abs(lat) > 80) return null;
  const v = geodeticToEcef(lat, 5, 400_000);
  return Array.isArray(v) ? v : [v.x, v.y, v.z];
};
const observer = { latDeg: 0, lonDeg: 0, elevM: 0 };
const MIN = 60_000;

test('a visual pass cut short by shadow is drawn rise to set, paused at its closest', () => {
  // Seen only from 4 to 1 minutes before the crossing (then into shadow).
  const pass = { startMs: T - 4 * MIN, endMs: T - 1 * MIN, peakMs: T - 1 * MIN };
  const arc = passArc(ecefAt, observer, pass, 0);
  assert.ok(Math.abs(arc.closestMs - T) <= 1000, `closest ${arc.closestMs - T} ms from the crossing`);
  assert.ok(arc.riseMs < pass.startMs, 'rises before it is seen');
  assert.ok(arc.setMs > T + 3 * MIN, 'sets well after the crossing');
  // Symmetric about the crossing, to a few seconds.
  assert.ok(Math.abs((T - arc.riseMs) - (arc.setMs - T)) <= 3000);
});

test('the lowest pass setting shortens the arc', () => {
  const pass = { startMs: T - MIN, endMs: T + MIN, peakMs: T };
  const low = passArc(ecefAt, observer, pass, 0);
  const high = passArc(ecefAt, observer, pass, 20);
  assert.ok(high.riseMs > low.riseMs && high.setMs < low.setMs);
});

test('a very long pass is drawn as given', () => {
  const pass = { startMs: T, endMs: T + 5 * 3600_000, peakMs: T + 3600_000 };
  assert.deepEqual(passArc(ecefAt, observer, pass, 0), { riseMs: pass.startMs, setMs: pass.endMs, closestMs: pass.peakMs });
});

test('splitBySun breaks the line where the light changes, sharing the point', async () => {
  const { splitBySun } = await import('../lib/map/pass-arc.mjs');
  // Lit before T, dark after: fake the sun check through positions far apart.
  const line = { coordinates: [[[0, 0], [1, 1], [2, 2], [3, 3]]], times: [[T - 2 * MIN, T - MIN, T + MIN, T + 2 * MIN]] };
  // A satellite on the sunward side then behind the Earth (antisolar, low).
  const { sunPositionEcef } = await import('../lib/pass-finder/sun.js');
  const sunAt = (d) => sunPositionEcef(d);
  const ecef = (d) => {
    const s = sunAt(d);
    const k = d.getTime() < T ? 1 : -1;
    return [k * s[0] * 6800, k * s[1] * 6800, k * s[2] * 6800];
  };
  const { sunlit, shadow } = splitBySun(line, ecef);
  assert.deepEqual(sunlit.coordinates, [[[0, 0], [1, 1], [2, 2]]]);
  assert.deepEqual(shadow.coordinates, [[[2, 2], [3, 3]]]);
});

test('geometricElevFor undoes refraction: 0 apparent is about half a degree below', async () => {
  const { geometricElevFor } = await import('../lib/map/pass-arc.mjs');
  const { apparentAltDeg } = await import('../lib/refraction.js');
  const e = geometricElevFor(0);
  assert.ok(e < -0.4 && e > -0.7, `${e}`);
  assert.ok(Math.abs(apparentAltDeg(e)) < 0.01);
  assert.ok(Math.abs(apparentAltDeg(geometricElevFor(20)) - 20) < 0.01);
});
