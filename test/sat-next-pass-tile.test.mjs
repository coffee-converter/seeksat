import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPassTile } from '../lib/sat/next-pass-tile.mjs';

const M = 60_000;
const NOW = Date.parse('2026-11-01T18:00:00Z');
const pass = { startMs: NOW + 42 * M, endMs: NOW + 50 * M, peakMs: NOW + 46 * M, maxElevDeg: 63.4 };
const radio = { nowMs: NOW, located: true, hydrated: true, mode: 'radio', minElevDeg: 10 };
const visual = { ...radio, mode: 'visual' };

test('upcoming pass: countdown, max and what was searched', () => {
  assert.deepEqual(nextPassTile({ kind: 'pass', pass }, radio),
    { value: 'in 42 min', note: 'max 63° up, passes above 10°' });
  assert.deepEqual(nextPassTile({ kind: 'pass', pass }, visual),
    { value: 'in 42 min', note: 'max 63° up, visible passes only' });
});

test('pass in progress: time left', () => {
  assert.deepEqual(nextPassTile({ kind: 'pass', pass }, { ...radio, nowMs: NOW + 44 * M }),
    { value: 'up now, 6 min left', note: 'max 63° up, passes above 10°' });
});

test('ended pass: searching again', () => {
  assert.deepEqual(nextPassTile({ kind: 'pass', pass }, { ...radio, nowMs: NOW + 51 * M }),
    { value: 'Finding passes...' });
});

test('no passes: says what was searched', () => {
  assert.deepEqual(nextPassTile({ kind: 'none' }, radio),
    { value: 'none in the next 10 days', note: 'radio passes above 10°' });
  assert.deepEqual(nextPassTile({ kind: 'none' }, visual),
    { value: 'none in the next 10 days', note: 'visible passes only' });
});

test('stationary: fixed in the sky, or never rises', () => {
  assert.equal(nextPassTile({ kind: 'stationary', visible: true }, radio).value, 'Fixed in your sky');
  assert.equal(nextPassTile({ kind: 'stationary', visible: false }, radio).value, 'Never rises here');
});

test('failed search and unusable elements', () => {
  assert.equal(nextPassTile({ kind: 'failed' }, radio).value, 'Search failed');
  assert.equal(nextPassTile({ kind: 'unavailable' }, radio).value, "No passes: elements can't be used");
});

test('searching', () => {
  assert.deepEqual(nextPassTile(undefined, radio), { value: 'Finding passes...' });
});

test('no location: asks for one once prefs are loaded', () => {
  const o = { ...radio, located: false };
  assert.deepEqual(nextPassTile(undefined, o), { value: 'Set your location', note: 'to list passes below' });
  assert.deepEqual(nextPassTile(undefined, { ...o, hydrated: false }), { value: 'Finding passes...' });
});
