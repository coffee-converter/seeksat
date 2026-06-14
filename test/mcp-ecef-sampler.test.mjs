// test/mcp-ecef-sampler.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEcefSampler } from '../lib/mcp/ecef-sampler.mjs';
import { tlePositionEcef } from '../lib/truth.js';

const LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const LINE2 = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';

test('sampler matches tlePositionEcef at the same instant', () => {
  const sampler = makeEcefSampler(LINE1, LINE2);
  const d = new Date('2024-01-01T13:00:00Z');
  const [x, y, z] = sampler(d);
  const [tx, ty, tz] = tlePositionEcef(LINE1, LINE2, d);
  assert.ok(Math.abs(x - tx) < 1, 'x within 1 m');
  assert.ok(Math.abs(y - ty) < 1, 'y within 1 m');
  assert.ok(Math.abs(z - tz) < 1, 'z within 1 m');
});

test('sampler returns a 3-vector with plausible LEO magnitude', () => {
  const sampler = makeEcefSampler(LINE1, LINE2);
  const v = sampler(new Date('2024-01-01T13:00:00Z'));
  const r = Math.hypot(...v);
  assert.ok(r > 6.6e6 && r < 7.1e6, `radius ${r} in LEO band`);
});
