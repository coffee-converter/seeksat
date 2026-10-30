import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tleSourcesFor } from '../lib/pass-finder/tle.js';

test('builds per-source URLs for the ISS', () => {
  const urls = tleSourcesFor(25544).map(s => s.url);
  assert.ok(urls.some(u => u === 'https://api.wheretheiss.at/v1/satellites/25544/tles'));
  assert.ok(urls.some(u => u === 'https://tle.ivanstanojevic.me/api/tle/25544'));
  assert.equal(urls[0], '/api/sats?ids=25544', 'our mirror is tried first');
  assert.ok(!urls.some(u => u.includes('celestrak')), 'browsers never call CelesTrak');
});

test('the mirror source reads line1/line2 from /api/sats', async () => {
  const [mirror] = tleSourcesFor(25544);
  const resp = new Response(JSON.stringify({ objects: [{ name: 'ISS (ZARYA)', line1: 'L1', line2: 'L2' }], missing: [] }));
  assert.deepEqual(await mirror.parse(resp), { name: 'ISS (ZARYA)', line1: 'L1', line2: 'L2' });
  const miss = new Response(JSON.stringify({ objects: [], missing: [25544] }));
  await assert.rejects(mirror.parse(miss), /not in the mirror/);
});

test('parameterizes by NORAD id for other satellites', () => {
  const urls = tleSourcesFor(33591).map(s => s.url);
  assert.ok(urls.every(u => u.includes('33591')));
  assert.ok(!urls.some(u => u.includes('25544')));
});

test('each source exposes a name and parse fn', () => {
  for (const s of tleSourcesFor(20580)) {
    assert.equal(typeof s.name, 'string');
    assert.equal(typeof s.parse, 'function');
  }
});
