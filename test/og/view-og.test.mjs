import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildViewCardSvg, viewTracks } from '../../lib/og/view-og.mjs';
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
