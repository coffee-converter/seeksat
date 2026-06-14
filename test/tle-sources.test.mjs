import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tleSourcesFor } from '../lib/pass-finder/tle.js';

test('builds per-source URLs for the ISS', () => {
  const urls = tleSourcesFor(25544).map(s => s.url);
  assert.ok(urls.some(u => u === 'https://api.wheretheiss.at/v1/satellites/25544/tles'));
  assert.ok(urls.some(u => u === 'https://tle.ivanstanojevic.me/api/tle/25544'));
  assert.ok(urls.some(u => u.includes('CATNR=25544')));
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
