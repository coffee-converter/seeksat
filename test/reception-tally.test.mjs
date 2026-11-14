// test/reception-tally.test.mjs - the per-transmitter SatNOGS reception tally.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyTally, addObservations, pruneTally, indexTally, receptionFor, RECENCY, MIN_FAILED_FOR_SILENT, KEEP_DAYS,
} from '../lib/reception/tally.mjs';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const H = 3_600_000;
const D = 24 * H;
const ISS = 25544;
const obs = (endMs, over = {}) => ({ uuid: 'A', noradId: ISS, endMs, lowHz: 437_550_000, highHz: 437_550_000, ...over });

function tallyWith(good = [], bad = []) {
  const t = emptyTally();
  addObservations(t, good, 'good');
  addObservations(t, bad, 'bad');
  return t;
}

test('heard counts by window', () => {
  const t = tallyWith([obs(NOW - H), obs(NOW - 30 * H), obs(NOW - 5 * D), obs(NOW - 20 * D)]);
  const r = receptionFor(indexTally(t), ISS, { hz: 437_550_000 }, NOW);
  assert.equal(r.state, 'heard');
  assert.equal(r.recency, RECENCY.H48);
  assert.equal(r.heardLast48h, 2);
  assert.equal(r.heardLast7d, 3);
  assert.equal(r.heardLast30d, 4);
  assert.equal(r.failedLast30d, 0);
  assert.equal(r.lastHeard, new Date(Math.floor((NOW - H) / 60_000) * 60_000).toISOString());
});

test('recency falls back to 7 and 30 days', () => {
  const week = receptionFor(indexTally(tallyWith([obs(NOW - 4 * D)])), ISS, { hz: 437_550_000 }, NOW);
  assert.equal(week.recency, RECENCY.D7);
  const month = receptionFor(indexTally(tallyWith([obs(NOW - 15 * D)])), ISS, { hz: 437_550_000 }, NOW);
  assert.equal(month.recency, RECENCY.D30);
});

test('only failures, three or more, is silent', () => {
  assert.equal(MIN_FAILED_FOR_SILENT, 3);
  const three = receptionFor(indexTally(tallyWith([], [obs(NOW - H), obs(NOW - 2 * H), obs(NOW - 3 * H)])), ISS, { hz: 437_550_000 }, NOW);
  assert.equal(three.state, 'silent');
  assert.equal(three.recency, RECENCY.SILENT);
  assert.equal(three.failedLast30d, 3);
  const two = receptionFor(indexTally(tallyWith([], [obs(NOW - H), obs(NOW - 2 * H)])), ISS, { hz: 437_550_000 }, NOW);
  assert.equal(two.state, 'unknown');
  assert.equal(two.recency, RECENCY.UNKNOWN);
  // One good one among the failures: heard.
  const mixed = receptionFor(indexTally(tallyWith([obs(NOW - 10 * D)], [obs(NOW - H), obs(NOW - 2 * H), obs(NOW - 3 * H)])), ISS, { hz: 437_550_000 }, NOW);
  assert.equal(mixed.state, 'heard');
});

test('unmatched downlink is unknown', () => {
  const r = receptionFor(indexTally(tallyWith([obs(NOW - H)])), ISS, { hz: 145_800_000 }, NOW);
  assert.deepEqual(r, { state: 'unknown', recency: RECENCY.UNKNOWN, heardLast48h: 0, heardLast7d: 0, heardLast30d: 0, failedLast30d: 0, lastHeard: null });
  const other = receptionFor(indexTally(tallyWith([obs(NOW - H)])), 99999, { hz: 437_550_000 }, NOW);
  assert.equal(other.state, 'unknown');
});

test('passband centre matches the span', () => {
  const t = tallyWith([obs(NOW - H, { uuid: 'T', lowHz: 435_000_000, highHz: 435_100_000 })]);
  assert.equal(receptionFor(indexTally(t), ISS, { hz: 435_050_000 }, NOW).heardLast48h, 1);
  // Within 5 kHz of an edge still matches; 10 kHz past does not.
  assert.equal(receptionFor(indexTally(t), ISS, { hz: 435_104_000 }, NOW).heardLast48h, 1);
  assert.equal(receptionFor(indexTally(t), ISS, { hz: 435_110_000 }, NOW).heardLast48h, 0);
});

test('a uuid and every transmitter at its frequency count together', () => {
  // A and B share 437.550 (SatNOGS lists twins; the catalog keeps one uuid).
  // C is the downlink's own uuid, listed at a slightly different frequency.
  const t = tallyWith([
    obs(NOW - H, { uuid: 'A' }), obs(NOW - 2 * H, { uuid: 'B' }), obs(NOW - 3 * H, { uuid: 'B' }),
    obs(NOW - 4 * H, { uuid: 'C', lowHz: 437_600_000, highHz: 437_600_000 }),
  ]);
  const ix = indexTally(t);
  assert.equal(receptionFor(ix, ISS, { hz: 437_550_000, uuid: 'B' }, NOW).heardLast48h, 3);
  assert.equal(receptionFor(ix, ISS, { hz: 437_550_000 }, NOW).heardLast48h, 3);
  assert.equal(receptionFor(ix, ISS, { hz: 437_550_000, uuid: 'C' }, NOW).heardLast48h, 4);
  assert.equal(receptionFor(ix, ISS, { hz: 437_550_000, uuid: 'Z' }, NOW).heardLast48h, 3);
});

test('a twin heard on the same frequency keeps a satellite from reading silent', () => {
  const t = tallyWith([obs(NOW - H, { uuid: 'HEARD' })], [obs(NOW - H, { uuid: 'KEPT' }), obs(NOW - 2 * H, { uuid: 'KEPT' }), obs(NOW - 3 * H, { uuid: 'KEPT' })]);
  assert.equal(receptionFor(indexTally(t), ISS, { hz: 437_550_000, uuid: 'KEPT' }, NOW).state, 'heard');
});

test('prune drops old times, empty transmitters and old swept days', () => {
  const t = tallyWith([obs(NOW - H), obs(NOW - (KEEP_DAYS + 1) * D, { uuid: 'OLD' })]);
  t.swept['2026-11-13:good'] = { pages: 1, count: 1, truncated: false };
  t.swept['2026-10-01:good'] = { pages: 1, count: 1, truncated: false };
  pruneTally(t, NOW);
  assert.deepEqual(Object.keys(t.tx), ['A']);
  assert.deepEqual(Object.keys(t.swept), ['2026-11-13:good']);
});

test('a reading of no tally is unknown', () => {
  assert.equal(receptionFor(null, ISS, { hz: 437_550_000 }, NOW).state, 'unknown');
});
