import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { nextUp } from '../lib/home/next-up.mjs';
import { runPassJob } from '../lib/passes/pass-jobs.mjs';
import { createPassRunner } from '../lib/passes/pass-client.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { GOES16_LINE1, GOES16_LINE2, EN52VE, recordFrom } from './fixtures/orbits.mjs';

const ISS_T0 = Date.parse('2026-03-01T12:00:00Z');
const GOES_NOW = Date.parse('2026-10-31T15:00:00Z');
const issRec = recordFrom(ISS_LINE1, ISS_LINE2, 'ISS');
const goesRec = recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16');
const observer = { name: EN52VE.name, latDeg: EN52VE.latDeg, lonDeg: EN52VE.lonDeg };
const nextUpJob = {
  kind: 'next-up', records: [issRec], custom: [], following: [issRec.noradId], missing: [],
  observer, mode: 'radio', minElevDeg: 10, nowMs: ISS_T0,
};

test('next-up job equals calling nextUp directly', () => {
  const track = makeTrack(issRec);
  const direct = nextUp({
    tracks: new Map([[track.noradId, track]]), missing: [], observer, mode: 'radio', minElevDeg: 10, nowMs: ISS_T0,
  });
  const viaJob = runPassJob(nextUpJob);
  assert.deepEqual(JSON.parse(JSON.stringify(viaJob)), JSON.parse(JSON.stringify(direct)));
  assert.equal(viaJob[0].kind, 'pass');
});

test('passes job for GOES 16 is stationary', () => {
  const r = runPassJob({
    kind: 'passes', record: goesRec, observers: [{ id: 'home', ...observer }],
    mode: 'radio', minElevDeg: 10, startMs: GOES_NOW,
  });
  assert.equal(r.kind, 'stationary');
});

test('a broken record gives unavailable, not a throw', () => {
  const r = runPassJob({
    kind: 'passes', record: { noradId: 1, name: 'bad', line1: 'x', line2: 'y' },
    observers: [{ id: 'home', ...observer }], mode: 'radio', minElevDeg: 10, startMs: ISS_T0,
  });
  assert.deepEqual(r, { kind: 'unavailable', reason: 'elements' });
});

function fakeWorker({ fail = false } = {}) {
  return {
    posted: [],
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(m) {
      this.posted.push(m);
      if (fail) {
        setTimeout(() => this.onerror?.({ message: 'boom', preventDefault() {} }));
        return;
      }
      setTimeout(() => this.onmessage({ data: { id: m.id, ok: true, result: runPassJob(m.job) } }));
    },
    terminate() { this.terminated = true; },
  };
}

test('runner with a fake worker resolves through postMessage', async () => {
  const w = fakeWorker();
  const runner = createPassRunner({ makeWorker: () => w });
  const cards = await runner.run(nextUpJob);
  assert.equal(w.posted.length, 1);
  assert.equal(cards[0].kind, 'pass');
  runner.dispose();
  assert.equal(w.terminated, true);
});

test('an ok:false reply rejects only that job', async () => {
  const w = fakeWorker();
  w.postMessage = function (m) {
    setTimeout(() => this.onmessage({ data: { id: m.id, ok: false, error: 'nope' } }));
  };
  const runner = createPassRunner({ makeWorker: () => w });
  await assert.rejects(runner.run(nextUpJob), /nope/);
});

test('runner falls back inline after a worker error, including the job in flight', async () => {
  const w = fakeWorker({ fail: true });
  const runner = createPassRunner({ makeWorker: () => w });
  const first = await runner.run(nextUpJob);
  assert.equal(first[0].kind, 'pass');
  const second = await runner.run(nextUpJob);
  assert.equal(second[0].kind, 'pass');
  assert.equal(w.posted.length, 1, 'later jobs do not touch the dead worker');
});

test('runner with no Worker runs inline', async () => {
  const runner = createPassRunner({ makeWorker: () => null });
  const cards = await runner.run(nextUpJob);
  assert.equal(cards[0].kind, 'pass');
});
