import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchGroup, fetchByCatnr, groupUrl, catnrUrl, MIRROR_GROUPS, createCelestrakGuard, PAUSE_MS,
  GROUP_TIMEOUT_MS, CATNR_TIMEOUT_MS, NOT_FOUND_LIMIT,
} from '../lib/mirror/celestrak.mjs';
import { ISS_OMM } from './fixtures/omm-iss.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const text = (body, status = 200) => new Response(body, { status });
const quiet = { warn() {} };

function guarded(fetchImpl) {
  const clock = { t: 0 };
  const guard = createCelestrakGuard({ now: () => clock.t, log: quiet });
  let calls = 0;
  const counted = async (...args) => { calls++; return fetchImpl(...args); };
  return { opts: { fetchImpl: counted, guard }, guard, clock, calls: () => calls };
}

test('urls and groups', () => {
  assert.deepEqual([...MIRROR_GROUPS], ['active', 'last-30-days', 'visual', 'weather', 'gps-ops']);
  assert.equal(groupUrl('active'), 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json');
  assert.equal(catnrUrl(25544), 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json');
});

test('fetchGroup sends User-Agent, refuses redirects, returns normalized array', async () => {
  let seen;
  const { opts } = guarded(async (url, o) => { seen = { url, o }; return json([ISS_OMM]); });
  const out = await fetchGroup('active', opts);
  assert.equal(out.length, 1);
  assert.equal(out[0].NORAD_CAT_ID, 25544);
  assert.equal(seen.url, groupUrl('active'));
  assert.equal(seen.o.headers['User-Agent'], 'seeksat/1.0 (https://seeksat.com)');
  assert.equal(seen.o.redirect, 'manual');
});

test('fetchGroup drops malformed elements', async () => {
  const { opts } = guarded(async () => json([ISS_OMM, { bogus: true }]));
  assert.equal((await fetchGroup('active', opts)).length, 1);
});

test('fetchGroup rejects on HTTP 403 and on HTML', async () => {
  await assert.rejects(fetchGroup('active', guarded(async () => text('no', 403)).opts), /403/);
  await assert.rejects(fetchGroup('active', guarded(async () => text('<html></html>')).opts), /HTML/);
});

test('fetchByCatnr returns null when absent without pausing', async () => {
  const g = guarded(async () => text('No GP data found'));
  assert.equal(await fetchByCatnr(1, g.opts), null);
  assert.equal(g.guard.isPaused(), false);
  assert.equal(await fetchByCatnr(1, guarded(async () => json([])).opts), null);
});

test('fetchByCatnr returns the record, rejects on HTTP 500', async () => {
  const r = await fetchByCatnr(25544, guarded(async () => json([ISS_OMM])).opts);
  assert.equal(r.NORAD_CAT_ID, 25544);
  await assert.rejects(fetchByCatnr(1, guarded(async () => text('x', 500)).opts), /500/);
});

for (const [label, impl] of [
  ['HTTP 403', async () => text('GP data has not updated', 403)],
  ['HTTP 429', async () => text('slow down', 429)],
  ['a 301 redirect', async () => new Response(null, { status: 301, headers: { location: 'https://x' } })],
  ['an HTML page with 200', async () => text('<!DOCTYPE html><p>blocked</p>')],
  ['a network error', async () => { throw new TypeError('fetch failed'); }],
]) {
  test(`${label} pauses every CelesTrak call for 2 hours`, async () => {
    const g = guarded(impl);
    await assert.rejects(fetchByCatnr(1, g.opts));
    assert.equal(g.calls(), 1);
    await assert.rejects(fetchGroup('active', g.opts), /paused/);
    await assert.rejects(fetchByCatnr(2, g.opts), /paused/);
    assert.equal(g.calls(), 1, 'no request leaves while paused');
    g.clock.t += PAUSE_MS - 1;
    await assert.rejects(fetchByCatnr(3, g.opts), /paused/);
    assert.equal(g.calls(), 1);
    g.clock.t += 1;
    await assert.rejects(fetchByCatnr(4, g.opts));
    assert.equal(g.calls(), 2, 'requests resume after the pause');
  });
}

for (const [label, impl] of [
  ['a plain-text 200', async () => text('Invalid query')],
  ['an empty 200', async () => text('')],
  ['a JSON object body', async () => json({ error: 'bad' })],
]) {
  test(`${label} trips the pause for both fetchers`, async () => {
    for (const run of [(o) => fetchGroup('active', o), (o) => fetchByCatnr(1, o)]) {
      const g = guarded(impl);
      await assert.rejects(run(g.opts), /celestrak/);
      assert.equal(g.calls(), 1);
      await assert.rejects(fetchByCatnr(2, g.opts), /paused/);
      assert.equal(g.calls(), 1, 'no request leaves while paused');
    }
  });
}

test('No GP data found and an empty array do not pause', async () => {
  const g = guarded(async () => text('No GP data found'));
  assert.equal(await fetchByCatnr(1, g.opts), null);
  assert.equal(await fetchByCatnr(2, g.opts), null);
  assert.equal(g.calls(), 2);
  const h = guarded(async () => json([]));
  assert.equal(await fetchByCatnr(1, h.opts), null);
  assert.equal(await fetchByCatnr(2, h.opts), null);
  assert.equal(h.calls(), 2);
});

test('a group download gets a minute, one satellite 15 s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hang = async (url, o) => new Promise((_, reject) => {
    o.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
  });
  const settled = (p) => { const s = { done: false }; p.catch(() => {}).finally(() => { s.done = true; }); return s; };
  const flush = () => new Promise((r) => setImmediate(r));

  const group = settled(fetchGroup('active', guarded(hang).opts));
  await flush();
  t.mock.timers.tick(CATNR_TIMEOUT_MS);
  await flush();
  assert.equal(group.done, false, 'still downloading at 15 s');
  t.mock.timers.tick(GROUP_TIMEOUT_MS - CATNR_TIMEOUT_MS);
  await flush();
  assert.equal(group.done, true, 'aborted at a minute');

  const one = settled(fetchByCatnr(25544, guarded(hang).opts));
  await flush();
  t.mock.timers.tick(CATNR_TIMEOUT_MS);
  await flush();
  assert.equal(one.done, true);
});

test('a 404 for one satellite is a miss, and only a few go by before the pause', async () => {
  const g = guarded(async () => text('No GP data found', 404));
  for (let i = 1; i < NOT_FOUND_LIMIT; i++) assert.equal(await fetchByCatnr(i, g.opts), null);
  assert.equal(g.guard.isPaused(), false);
  assert.equal(await fetchByCatnr(NOT_FOUND_LIMIT, g.opts), null, 'the last one is still an answer');
  assert.equal(g.guard.isPaused(), true, `${NOT_FOUND_LIMIT} in 2 hours pause every call`);
  assert.equal(g.calls(), NOT_FOUND_LIMIT);
});

test('404s spread over more than 2 hours never pause', async () => {
  const g = guarded(async () => text('', 404));
  for (let i = 1; i <= NOT_FOUND_LIMIT * 2; i++) {
    assert.equal(await fetchByCatnr(i, g.opts), null);
    g.clock.t += PAUSE_MS / (NOT_FOUND_LIMIT - 1);
  }
  assert.equal(g.guard.isPaused(), false);
});

test('a 404 for a group still pauses at once', async () => {
  const g = guarded(async () => text('', 404));
  await assert.rejects(fetchGroup('active', g.opts), /404/);
  assert.equal(g.guard.isPaused(), true);
});
