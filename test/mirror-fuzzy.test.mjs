import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogReader } from '../lib/mirror/reader.mjs';
import { createMemorySnapshotStore } from '../lib/mirror/snapshot-store.mjs';
import { normalizeName, editDistance, matchTier, prepareEntry } from '../lib/mirror/fuzzy.mjs';

const T0 = Date.parse('2026-03-02T00:00:00Z');
const quiet = { warn() {}, error() {} };

function rec(noradId, name, groups = ['active']) {
  return { noradId, name, omm: {}, epochMs: T0, source: 'celestrak-gp', fetchedAtMs: T0, groups };
}
function snap(list) {
  const objects = {};
  for (const r of list) objects[String(r.noradId)] = r;
  return { version: 1, generatedAtMs: T0, objects };
}
function readerFor(list) {
  return createCatalogReader({
    store: createMemorySnapshotStore(snap(list)),
    onDemand: { async get() { return undefined; } },
    now: () => T0, log: quiet,
  });
}

const FIX = [
  rec(25544, 'ISS (ZARYA)', ['active', 'visual']),
  rec(26700, 'ISS (DESTINY)', ['active']),
  rec(49044, 'ISS (NAUKA)', ['active']),
  rec(69796, 'ISS OBJECT YM', ['last-30-days']),
  rec(68454, 'AISSAT 4', ['active']),
  rec(20580, 'HST', ['active', 'visual']),
  rec(57166, 'METEOR-M2 3', ['weather']),
  rec(59051, 'METEOR-M2 4', ['weather']),
  rec(33591, 'NOAA 19', ['weather']),
  rec(28654, 'NOAA 18', ['weather']),
  rec(48274, 'CSS (TIANHE)', ['active', 'visual']),
  rec(41866, 'GOES 16', ['weather']),
  rec(36411, 'GOES 15', ['weather']),
  rec(90001, 'COSMOS 1408 DEB', ['cosmos-1408-debris']),
  rec(90002, 'FENGYUN 1C DEB', ['fengyun-1c-debris']),
  rec(90003, 'DELTA 1 R/B', ['last-30-days']),
  rec(90004, 'ISS DEB', ['last-30-days']),
];
const ids = (r) => r.map((x) => x.noradId);

test('normalizeName', () => {
  assert.deepEqual(normalizeName('NOAA-19'), { tokens: ['noaa', '19'], compact: 'noaa19' });
  assert.equal(normalizeName('noaa19').compact, 'noaa19');
  assert.deepEqual(normalizeName('Café (X)').tokens, ['cafe', 'x']);
});

test('editDistance: transposition costs 1, bounded', () => {
  assert.equal(editDistance('zayra', 'zarya', 2), 1);
  assert.equal(editDistance('abc', 'abc', 2), 0);
  assert.equal(editDistance('abc', 'abd', 2), 1);
  assert.equal(editDistance('abcdef', 'uvwxyz', 2), 3);
  assert.equal(editDistance('a', 'abcdef', 2), 3);
});

test('matchTier tiers', () => {
  const e = prepareEntry({ noradId: 25544, name: 'ISS (ZARYA)', aliases: ['iss'] });
  assert.equal(matchTier('25544', e).tier, 0);
  assert.equal(matchTier('iss', e).tier, 1);
  assert.equal(matchTier('issz', e).tier, 2);
  assert.equal(matchTier('zarya iss', e).tier, 3);
  assert.equal(matchTier('2554', e).tier, 4);
  assert.equal(matchTier('arya', e).tier, 5);
  assert.equal(matchTier('zayra', e).tier, 6);
  assert.equal(matchTier('xqzv', e), null);
});

test('typos', async () => {
  const r = readerFor(FIX);
  assert.equal((await r.search('zayra'))[0].noradId, 25544);
  assert.equal((await r.search('hubbel'))[0].noradId, 20580);
  assert.equal((await r.search('metor m2 3'))[0].noradId, 57166);
  assert.equal((await r.search('tiangnog'))[0].noradId, 48274);
});

test('spacing and digits', async () => {
  const r = readerFor(FIX);
  assert.equal((await r.search('noaa19'))[0].noradId, 33591);
  assert.equal((await r.search('noaa-19'))[0].noradId, 33591);
  assert.deepEqual(ids(await r.search('25544')), [25544]);
  const two = await r.search('2554');
  assert.deepEqual(ids(two), [25544]);
});

test('digit prefix comes after name hits', async () => {
  const r = readerFor([rec(1, 'FOO 2554 BAR'), rec(25541, 'OTHER')]);
  assert.deepEqual(ids(await r.search('2554')), [1, 25541]);
});

test('ordering', async () => {
  const r = readerFor(FIX);
  const iss = ids(await r.search('iss'));
  assert.equal(iss[0], 25544);
  assert.ok(iss.indexOf(26700) < iss.indexOf(69796));
  assert.ok(iss.indexOf(49044) < iss.indexOf(69796));
  assert.ok(iss.indexOf(69796) < iss.indexOf(68454));
  assert.ok(iss.indexOf(26700) < iss.indexOf(90004));
  const g = ids(await r.search('goes 16'));
  assert.equal(g[0], 41866);
  assert.ok(g.indexOf(36411) === -1 || g.indexOf(41866) < g.indexOf(36411));
});

test('no match', async () => {
  assert.deepEqual(await readerFor(FIX).search('xqzv'), []);
});

test('speed over 17,000 entries', async () => {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const list = [];
  let s = 12345;
  const rnd = (n) => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % n; };
  for (let i = 0; i < 17000; i++) {
    let w = '';
    for (let k = 0; k < 4 + rnd(6); k++) w += letters[rnd(26)];
    list.push(rec(100 + i, `${w.toUpperCase()} ${rnd(99)} ${i % 3 ? 'DEB' : 'X' + rnd(50)}`));
  }
  list.push(rec(25544, 'ISS (ZARYA)'));
  const r = readerFor(list);
  await r.search('warmup'); // builds the index
  const t0 = performance.now();
  const out = await r.search('zayra');
  const ms = performance.now() - t0;
  console.log(`search over 17001 entries: ${ms.toFixed(1)} ms`);
  assert.equal(out[0].noradId, 25544);
  assert.ok(ms < 100, `took ${ms} ms`);
});
