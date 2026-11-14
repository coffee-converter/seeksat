import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestCentre, buildViewCardSvg, commonName, viewTracks } from '../../lib/og/view-og.mjs';
import { onCard, globeCentre } from '../../lib/og/globe-card.mjs';
import { periodMinOf } from '../../lib/og/tle.mjs';
import { parseView } from '../../lib/share/view-link.mjs';
import { ISS_TLE } from './fixtures/iss-tle.mjs';

const NOW = Date.parse('2026-03-01T00:00:00Z');
const reader = (ids) => ({ getSnapshotRecord: async (id) => (ids.includes(id) ? { noradId: id, name: `SAT ${id}`, ...ISS_TLE } : null) });

test('a shared map draws each shared satellite in the map colours, leaving out hidden and unknown ones', async () => {
  const view = parseView('?map=globe&sats=25544,48274,99999&hide=48274&c=41.88,-87.63&z=3');
  const tracks = await viewTracks(view, { reader: reader([25544, 48274]), nowMs: NOW });
  assert.deepEqual(tracks.map((t) => t.noradId), [25544]);
  assert.equal(tracks[0].color, '#ff9b54');
  assert.ok(tracks[0].ground.length > 100 && tracks[0].sat);
  const svg = buildViewCardSvg(view, tracks);
  assert.ok(svg.includes('ISS') && svg.includes('Shared live map'));
});

test('several satellites: a count for the title and their names underneath', async () => {
  const view = parseView('?map=flat&sats=25544,48274');
  const tracks = await viewTracks(view, { reader: reader([25544, 48274]), nowMs: NOW });
  const svg = buildViewCardSvg(view, tracks);
  assert.ok(svg.includes('2 satellites'));
  assert.ok(svg.includes('ISS · Tiangong') || svg.includes('ISS · CSS'), svg.match(/<text[^>]*>[^<]*·[^<]*<\/text>/)?.[0]);
});

test('many satellites: the count is all of them, the names give way to "and N more"', async () => {
  const { namesLine } = await import('../../lib/og/view-og.mjs');
  assert.equal(namesLine(['ISS', 'Tiangong'], 2), 'ISS · Tiangong');
  const line = namesLine(['ISS', 'Tiangong', 'Hubble', 'SO-50', 'NOAA 19', 'NOAA 18', 'NOAA 15', 'Meteor-M2 3'], 20);
  assert.match(line, /^ISS · Tiangong · .* and \d+ more$/);
  assert.ok(line.length <= 44, line);
  const ids = Array.from({ length: 20 }, (_, i) => 25544 + i);
  const view = parseView(`?map=globe&sats=${ids.join(',')}`);
  const tracks = await viewTracks(view, { reader: reader(ids), nowMs: NOW });
  assert.equal(tracks.length, 10, 'at most one track per palette colour');
  const svg = buildViewCardSvg(view, tracks);
  assert.ok(svg.includes('20 satellites') && svg.includes('and 1'));
});

test('a catalog name gives way to the common name in its brackets', () => {
  assert.equal(commonName('GSAT0201 (GALILEO 5)'), 'GALILEO 5');
  assert.equal(commonName('EYESAT A (AO-27)'), 'AO-27');
  assert.equal(commonName('SMILE'), 'SMILE');
  assert.equal(commonName('RS-44 & BREEZE-KM R/B'), 'RS-44 & BREEZE-KM R/B');
  assert.equal(commonName(undefined), undefined);
});

test('tracks run one orbit around now: the period comes from the elements', () => {
  // 15.5 revolutions a day.
  assert.ok(Math.abs(periodMinOf(ISS_TLE) - 1440 / 15.5) < 0.2);
});

test('without a place of its own, the card faces where the satellites are', () => {
  const tracks = [
    { sat: { lonDeg: 120, latDeg: 10 }, ground: [[100, 0], [120, 10], [140, 20]] },
    { sat: { lonDeg: 135, latDeg: 30 }, ground: [[125, 20], [135, 30], [145, 40]] },
  ];
  const at = bestCentre(tracks);
  for (const t of tracks) assert.ok(onCard(globeCentre(at[0], at[1]), t.sat.lonDeg, t.sat.latDeg));
  assert.equal(bestCentre([]), null);
});

test('one satellite: its height on the first line, and "shared live map" said once', async () => {
  const view = parseView('?map=globe&sats=25544');
  const tracks = await viewTracks(view, { reader: reader([25544]), nowMs: Date.parse('2026-03-01T12:00:00Z') });
  const svg = buildViewCardSvg(view, tracks);
  assert.match(svg, />Where it is now, [\d,]+ km up</);
  assert.equal((svg.match(/[Ss]hared live map/g) || []).length, 1);
});

test('no names drawn: no bare "and 3 more", the card falls back to its own line', async () => {
  const { namesLine } = await import('../../lib/og/view-og.mjs');
  assert.equal(namesLine([], 3), '');
  const view = parseView('?map=globe&sats=11111,22222,33333');
  const svg = buildViewCardSvg(view, await viewTracks(view, { reader: reader([]), nowMs: Date.parse('2026-03-01T12:00:00Z') }));
  assert.doesNotMatch(svg, /> and \d+ more</);
  assert.match(svg, />3 satellites</);
});
