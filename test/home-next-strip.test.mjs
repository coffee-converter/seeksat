import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPassSummary } from '../lib/home/next-strip.mjs';

const NOW = Date.parse('2026-11-01T23:00:00Z');
const MIN = 60_000;
const passCard = (noradId, name, startIn, maxElevDeg, inProgress = false) => ({
  kind: 'pass', noradId, name,
  pass: { startMs: NOW + startIn * MIN, endMs: NOW + (startIn + 10) * MIN, peakMs: NOW + (startIn + 5) * MIN, maxElevDeg, inProgress },
});

test('nextPassSummary picks the soonest pass card', () => {
  const cards = [
    passCard(33591, 'NOAA-19', 148, 17),
    { kind: 'stationary', noradId: 41866, name: 'GOES 16', visible: true, pointing: { azDeg: 200, elDeg: 38 } },
    passCard(57166, 'Meteor-M2 3', 62, 13),
    { kind: 'none', noradId: 1, name: 'X', mode: 'radio' },
  ];
  const s = nextPassSummary(cards, NOW);
  assert.equal(s.noradId, 57166);
  assert.equal(s.name, 'Meteor-M2 3');
  assert.equal(s.text, 'Meteor-M2 3 in 1 h 2 min, max 13°');
  assert.equal(s.pass, cards[2].pass);
});

test('nextPassSummary puts a pass in progress first', () => {
  const cards = [passCard(57166, 'Meteor-M2 3', 30, 13), passCard(25544, 'ISS', -3, 75, true)];
  const s = nextPassSummary(cards, NOW);
  assert.equal(s.noradId, 25544);
  assert.equal(s.text, 'ISS now, max 75°');
});

test('nextPassSummary is null with no pass cards', () => {
  assert.equal(nextPassSummary([], NOW), null);
  assert.equal(nextPassSummary([{ kind: 'missing', noradId: 5, name: 'Y' }], NOW), null);
  assert.equal(nextPassSummary(undefined, NOW), null);
});
