import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, resolveSatellite, defaultDownlink, displayName } from '../lib/catalog.mjs';

test('catalog has the 5 starter satellites plus Meteor-M2 3, Meteor-M2 4, SO-50, RS-44 and AO-123', () => {
  assert.equal(CATALOG.length, 10);
  const ids = CATALOG.map(s => s.noradId).sort((a, b) => a - b);
  assert.deepEqual(ids, [20580, 25544, 27607, 33591, 44909, 48274, 53807, 57166, 59051, 61781]);
});

test('Meteor-M2 3, Meteor-M2 4 and SO-50 resolve by alias and carry downlinks', () => {
  assert.equal(resolveSatellite('meteor-m2 3').noradId, 57166);
  assert.equal(resolveSatellite('meteor m2-4').noradId, 59051);
  assert.equal(resolveSatellite('so50').noradId, 27607);
  assert.equal(defaultDownlink(resolveSatellite(57166)).hz, 137_900_000);
  assert.equal(defaultDownlink(resolveSatellite(59051)).hz, 137_900_000);
  assert.equal(defaultDownlink(resolveSatellite(27607)).hz, 436_795_000);
  assert.equal(resolveSatellite(57166).downlinks.length, 2);
  assert.equal(resolveSatellite(27607).downlinks.length, 1);
});

test('RS-44 and AO-123 resolve by alias with their verified downlinks', () => {
  assert.equal(resolveSatellite('rs-44').noradId, 44909);
  assert.equal(resolveSatellite('dosaaf-85').noradId, 44909);
  assert.equal(resolveSatellite('ao-123').noradId, 61781);
  assert.equal(resolveSatellite('asrtu-1').noradId, 61781);
  assert.equal(resolveSatellite('rs44').noradId, 44909);
  assert.equal(resolveSatellite('ao123').noradId, 61781);
  assert.equal(resolveSatellite('asrtu 1').noradId, 61781);
  assert.equal(defaultDownlink(resolveSatellite(44909)).hz, 435_605_000);
  assert.equal(defaultDownlink(resolveSatellite(44909)).mode, 'cw');
  assert.equal(resolveSatellite(44909).downlinks[1].hz, 435_640_000);
  assert.equal(defaultDownlink(resolveSatellite(61781)).hz, 435_400_000);
});

test('every entry has the enriched, valid shape', () => {
  for (const s of CATALOG) {
    assert.equal(typeof s.noradId, 'number');
    assert.equal(typeof s.name, 'string');
    assert.ok(typeof s.shortName === 'string' && s.shortName.length > 0, `${s.name} shortName`);
    assert.ok(Array.isArray(s.aliases));
    assert.ok(['free', 'premium'].includes(s.tier), `${s.name} tier`);
    assert.equal(typeof s.inclinationDeg, 'number');
    assert.ok(s.viewingHint === null || typeof s.viewingHint === 'string');
    assert.ok(['visual', 'radio'].includes(s.defaultMode), `${s.name} mode`);
  }
});

test('all starter satellites are free for now', () => {
  assert.ok(CATALOG.every(s => s.tier === 'free'));
});

// REPLACES the old "NOAA-19 defaults to radio; ISS to visual" test.
// NOAA-19 was decommissioned 2025-08-13 (battery 1A cell failure); NOAA-15
// and -18 went with it and POES operations ended 2025-08-19. It is still in
// orbit and still tracked, so it stays in the catalog as a visual target -
// it is simply silent. Removing it would break share links carrying
// selectedNoradId 33591.
test('NOAA-19 is a visual target: decommissioned, no downlinks', () => {
  const noaa = resolveSatellite(33591);
  assert.equal(noaa.defaultMode, 'visual');
  assert.deepEqual(noaa.downlinks, []);
  assert.match(noaa.viewingHint, /decommission/i);
});

test('ISS defaults to visual and carries verified downlinks', () => {
  const iss = resolveSatellite(25544);
  assert.equal(iss.defaultMode, 'visual');
  const hz = iss.downlinks.map((d) => d.hz);
  assert.deepEqual(hz, [437_800_000, 437_550_000, 145_800_000]);
});

test('every catalog entry has a well-formed downlinks array', () => {
  for (const s of CATALOG) {
    assert.ok(Array.isArray(s.downlinks), `${s.name} downlinks`);
    let defaults = 0;
    for (const d of s.downlinks) {
      assert.equal(typeof d.hz, 'number', `${s.name} hz`);
      assert.ok(d.hz > 1e6 && d.hz < 1e10, `${s.name} hz range`);
      assert.equal(typeof d.label, 'string');
      assert.ok(['fm', 'apt', 'lrpt', 'cw', 'ssb'].includes(d.mode), `${s.name} mode`);
      assert.ok(
        ['continuous', 'scheduled', 'packet', 'on-demand', 'occasional'].includes(d.duty),
        `${s.name} duty`,
      );
      if (d.default) defaults++;
    }
    assert.ok(defaults <= 1, `${s.name} has more than one default downlink`);
  }
});

test('defaultDownlink picks the flagged entry, else the first, else null', () => {
  assert.equal(defaultDownlink(resolveSatellite(25544)).hz, 437_800_000);
  assert.equal(defaultDownlink(resolveSatellite(33591)), null);
  assert.equal(defaultDownlink(null), null);
});

test('resolveSatellite handles new aliases and ids', () => {
  assert.equal(resolveSatellite('bluewalker').noradId, 53807);
  assert.equal(resolveSatellite('noaa-19').noradId, 33591);
  assert.equal(resolveSatellite(20580).name, 'Hubble Space Telescope');
  assert.equal(resolveSatellite('nope'), null);
});

test('resolveSatellite synthesizes entries for any positive integer id', () => {
  const e = resolveSatellite(25485);
  assert.equal(e.noradId, 25485);
  assert.equal(e.defaultMode, 'radio');
  assert.equal(e.tier, 'free');
  assert.equal(resolveSatellite('25485').noradId, 25485);
  assert.equal(resolveSatellite('molniya'), null);
  assert.equal(resolveSatellite(0), null);
  assert.equal(resolveSatellite(-5), null);
  assert.equal(resolveSatellite(1.5), null);
  assert.equal(resolveSatellite(25544).name, 'ISS (ZARYA)');
});

test('resolveSatellite caps numeric ids at 999999999', () => {
  assert.equal(resolveSatellite(999999999).noradId, 999999999);
  assert.equal(resolveSatellite('999999999').noradId, 999999999);
  assert.equal(resolveSatellite(1000000000), null);
  assert.equal(resolveSatellite('12345678901234567890'), null);
  assert.equal(resolveSatellite(Number.MAX_SAFE_INTEGER), null);
});

test('displayName: curated name for catalog entries, record name for synthesized ones', () => {
  const iss = resolveSatellite(25544);
  assert.equal(displayName(iss, { name: 'ISS (ZARYA) CELESTRAK' }), 'ISS (ZARYA)');
  assert.equal(displayName(iss, null), 'ISS (ZARYA)');
  const syn = resolveSatellite(25485);
  assert.equal(displayName(syn, { name: 'SOME SAT' }), 'SOME SAT');
  assert.equal(displayName(syn, null), 'NORAD 25485');
  assert.equal(displayName(syn, { name: '' }), 'NORAD 25485');
});
