import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockFollowStep } from '../lib/live/dock-follow.mjs';

test('dockFollowStep: nothing docked, nothing to undo', () => {
  assert.deepEqual(
    dockFollowStep(null, { dockId: null, shownId: 5, publishedId: 5, following: true }),
    { state: null, follow: null },
  );
});

test('dockFollowStep: locks on once the map shows the docked satellite', () => {
  // The map still shows the page's selection: wait.
  let r = dockFollowStep(null, { dockId: 25544, shownId: null, publishedId: 25544, following: false });
  assert.deepEqual(r, { state: { id: 25544, prev: false, on: false }, follow: null });
  // The map has it now: lock on.
  r = dockFollowStep(r.state, { dockId: 25544, shownId: 25544, publishedId: 25544, following: false });
  assert.deepEqual(r, { state: { id: 25544, prev: false, on: true }, follow: true });
  // Later steps (a pan turned it off) leave it alone.
  r = dockFollowStep(r.state, { dockId: 25544, shownId: 25544, publishedId: 25544, following: false });
  assert.equal(r.follow, null);
});

test('dockFollowStep: already selected (the satellite page) locks on at once', () => {
  const r = dockFollowStep(null, { dockId: 25544, shownId: 25544, publishedId: 25544, following: true });
  assert.deepEqual(r, { state: { id: 25544, prev: true, on: true }, follow: true });
});

test('dockFollowStep: closing waits for the old selection, then restores Lock on', () => {
  const docked = { id: 25544, prev: true, on: true };
  // The page has published its own focus again, the map not yet.
  let r = dockFollowStep(docked, { dockId: null, shownId: 25544, publishedId: 48274, following: true });
  assert.deepEqual(r, { state: docked, follow: null });
  // The map is back on it (and turned Lock on off): put it back.
  r = dockFollowStep(r.state, { dockId: null, shownId: 48274, publishedId: 48274, following: false });
  assert.deepEqual(r, { state: null, follow: true });
});

test('dockFollowStep: closing with no selection change restores at once', () => {
  const r = dockFollowStep({ id: 1, prev: false, on: true }, { dockId: null, shownId: 1, publishedId: 1, following: true });
  assert.deepEqual(r, { state: null, follow: false });
});

test('dockFollowStep: a second satellite keeps the first note of Lock on', () => {
  const r = dockFollowStep({ id: 1, prev: true, on: true }, { dockId: 2, shownId: 1, publishedId: 2, following: true });
  assert.deepEqual(r, { state: { id: 2, prev: true, on: false }, follow: null });
});
