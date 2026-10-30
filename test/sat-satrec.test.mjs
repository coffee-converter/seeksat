import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sat from 'satellite.js';
import { satrecFromRecord } from '../lib/sat/satrec.mjs';
import { ISS_OMM, ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';

test('OMM and TLE records propagate to the same position', () => {
  const t = new Date(Date.UTC(2026, 2, 1, 13, 30));
  const a = sat.propagate(satrecFromRecord({ omm: ISS_OMM }), t).position;
  const b = sat.propagate(satrecFromRecord({ line1: ISS_LINE1, line2: ISS_LINE2 }), t).position;
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6);
});
test('OMM wins when a record has both', () => {
  const rec = { omm: { ...ISS_OMM, INCLINATION: 97 }, line1: ISS_LINE1, line2: ISS_LINE2 };
  assert.ok(Math.abs(satrecFromRecord(rec).inclo * 180 / Math.PI - 97) < 1e-9);
});
test('a record with neither form throws', () => {
  assert.throws(() => satrecFromRecord({}), /neither OMM nor TLE/);
});
