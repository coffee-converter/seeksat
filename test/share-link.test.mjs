import test from 'node:test';
import assert from 'node:assert/strict';
import { sharePath, makeShareBlob, shareUrl } from '../lib/share/share-link.mjs';
import { decodeStateBlob } from '../lib/pass-finder/state-blob.js';

const OBS = { name: 'Chicago', latDeg: 41.8781, lonDeg: -87.6298 };

test('sharePath and shareUrl', () => {
  const url = shareUrl('https://seeksat.com', { noradId: 25544, observers: [OBS], passMs: 1, mode: 'radio', freqHz: 437800000, minElevDeg: 10 });
  assert.match(url, /^https:\/\/seeksat\.com\/sat\/25544\/share\/[A-Za-z0-9_-]+$/);
  const d = decodeStateBlob(url.split('/').at(-1));
  assert.deepEqual([d.noradId, d.passTimeMs, d.mode, d.downlinkHz], [25544, 1, 'radio', 437800000]);
  assert.equal(sharePath(25544, 'abc'), '/sat/25544/share/abc');
  assert.equal(decodeStateBlob(makeShareBlob({ noradId: 1, observers: [OBS], mode: 'visual' })).passTimeMs, null);
});
