import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notStarted, startIsRise, underWay } from '../lib/passes/under-way.mjs';

const pass = { startMs: 1000, endMs: 2000 };

test('underWay runs from the start up to, not including, the end', () => {
  assert.equal(underWay(pass, 999), false);
  assert.equal(underWay(pass, 1000), true);
  assert.equal(underWay(pass, 1999), true);
  assert.equal(underWay(pass, 2000), false);
});

test('notStarted is true only before the start, so an ended pass is not "not started"', () => {
  assert.equal(notStarted(pass, 999), true);
  assert.equal(notStarted(pass, 1000), false);
  assert.equal(notStarted(pass, 5000), false);
});

test("startIsRise is false only for a pass the engine found already up", () => {
  assert.equal(startIsRise(pass), true);
  assert.equal(startIsRise({ ...pass, inProgress: false }), true);
  assert.equal(startIsRise({ ...pass, inProgress: true }), false);
});
