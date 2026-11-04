import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { nextUp, cardHeadline, countdown, NEXT_UP_HOURS } from '../lib/home/next-up.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { GOES16_LINE1, GOES16_LINE2, EN52VE, recordFrom } from './fixtures/orbits.mjs';

const T0 = Date.parse('2026-03-01T12:00:00Z');
const GOES_NOW = Date.parse('2026-10-31T15:00:00Z');
const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
const goes = makeTrack(recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'));
const observer = { name: EN52VE.name, latDeg: EN52VE.latDeg, lonDeg: EN52VE.lonDeg };
const base = { missing: [], observer, mode: 'radio', minElevDeg: 10 };

test('NEXT_UP_HOURS is 48', () => assert.equal(NEXT_UP_HOURS, 48));

test('ISS at T0 gives an upcoming pass card', () => {
  const cards = nextUp({ ...base, tracks: new Map([[iss.noradId, iss]]), nowMs: T0 });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].kind, 'pass');
  assert.match(cardHeadline(cards[0], T0), /^ISS in (\d+ min|\d+ h \d+ min), max \d+°$/);
});

test('GOES-16 is stationary and visible with a fixed-position headline', () => {
  const cards = nextUp({ ...base, tracks: new Map([[goes.noradId, goes]]), nowMs: GOES_NOW });
  assert.equal(cards[0].kind, 'stationary');
  assert.match(cardHeadline(cards[0], GOES_NOW), /^GOES 16 fixed at azimuth 20[34]°, 3[89]° up$/);
});

test('a missing id renders its line', () => {
  const cards = nextUp({ ...base, tracks: new Map(), missing: [99999], nowMs: T0 });
  assert.deepEqual(cards, [{ kind: 'missing', noradId: 99999, name: '99999' }]);
  assert.equal(cardHeadline(cards[0], T0), "Satellite 99999 isn't in the catalog right now");
});

test('a dead track gives an unavailable card', () => {
  const dead = { ...iss, ecefAt: () => null };
  const cards = nextUp({ ...base, tracks: new Map([[dead.noradId, dead]]), nowMs: T0 });
  assert.equal(cards[0].kind, 'unavailable');
  assert.equal(cardHeadline(cards[0], T0), "ISS: these elements can't be used to compute passes");
});

test('an in-progress pass sorts first, then stationary, then missing', () => {
  const tracks = new Map([[goes.noradId, goes], [iss.noradId, iss]]);
  const nowMs = Date.parse('2026-03-01T13:18:00Z');
  const cards = nextUp({ ...base, tracks, missing: [99999], nowMs });
  assert.deepEqual(cards.map((c) => c.kind), ['pass', 'stationary', 'missing']);
  assert.equal(cards[0].pass.inProgress, true);
  assert.match(cardHeadline(cards[0], nowMs), /^ISS now, max \d+°$/);
});

test('an upcoming pass sorts ahead of stationary cards', () => {
  const tracks = new Map([[goes.noradId, goes], [iss.noradId, iss]]);
  const cards = nextUp({ ...base, tracks, nowMs: T0 });
  assert.deepEqual(cards.map((c) => c.kind), ['pass', 'stationary']);
});

test('fixed headlines for the other kinds', () => {
  assert.equal(cardHeadline({ kind: 'stationary', name: 'X', visible: false }, 0), 'X never rises here');
  assert.equal(cardHeadline({ kind: 'none', name: 'X' }, 0), 'X: no passes in the next 2 days');
});

test('countdown', () => {
  assert.equal(countdown(0), 'under a minute');
  assert.equal(countdown(42 * 60_000), '42 min');
  assert.equal(countdown((2 * 60 + 5) * 60_000), '2 h 5 min');
  assert.equal(countdown(27 * 3_600_000), '1 day 3 h');
  assert.equal(countdown(51 * 3_600_000), '2 days 3 h');
  assert.equal(countdown(2 * 3_600_000), '2 h');
  assert.equal(countdown(24 * 3_600_000), '1 day');
  assert.equal(countdown(48 * 3_600_000), '2 days');
  assert.equal(countdown(42.9 * 60_000), '42 min');
  assert.equal(countdown(-5_000), 'under a minute');
});

test('one card per id: ids in tracks and missing, or repeated in missing, appear once', () => {
  const tracks = new Map([[iss.noradId, iss]]);
  const cards = nextUp({ ...base, tracks, missing: [iss.noradId, 99999, 99999], nowMs: T0 });
  assert.deepEqual(cards.map((c) => [c.kind, c.noradId]), [['pass', iss.noradId], ['missing', 99999]]);
});

test('upcoming passes sort by start time regardless of input order', () => {
  // Same orbit seen 20 minutes ahead, so its pass starts 20 minutes sooner.
  const earlier = { ...iss, noradId: 1, shortName: 'EARLIER', ecefAt: (d) => iss.ecefAt(new Date(new Date(d).getTime() + 20 * 60_000)) };
  const cards = nextUp({ ...base, tracks: new Map([[iss.noradId, iss], [1, earlier]]), nowMs: T0 });
  assert.deepEqual(cards.map((c) => c.name), ['EARLIER', 'ISS']);
  assert.ok(cards[0].pass.startMs < cards[1].pass.startMs);
});

test('a none card names the mode it was searched in', () => {
  const tracks = new Map([[iss.noradId, iss]]);
  const radio = nextUp({ ...base, tracks, minElevDeg: 89.9, nowMs: T0 });
  assert.deepEqual([radio[0].kind, radio[0].mode], ['none', 'radio']);
  assert.equal(cardHeadline(radio[0], T0), 'ISS: no passes in the next 2 days');
  const visual = nextUp({ ...base, tracks, mode: 'visual', minElevDeg: 89.9, nowMs: T0 });
  assert.deepEqual([visual[0].kind, visual[0].mode], ['none', 'visual']);
  assert.equal(cardHeadline(visual[0], T0), 'ISS: no visible passes in the next 2 days');
});

test('nextUp keeps the passes within 24 h on each card', () => {
  const cards = nextUp({ ...base, tracks: new Map([[iss.noradId, iss]]), nowMs: T0 });
  const card = cards[0];
  assert.ok(card.passes.length >= 1);
  assert.ok(card.passes.every((p) => p.startMs < T0 + 24 * 3_600_000));
  assert.equal(card.pass, card.passes[0]);
});
