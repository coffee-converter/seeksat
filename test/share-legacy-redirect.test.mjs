import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyRedirect, satRedirect } from '../lib/share/legacy-redirect.mjs';
import { makeShareBlob } from '../lib/share/share-link.mjs';
import { encodeStateBlob } from '../lib/pass-finder/state-blob.js';

const obs = [{ name: 'Home', latDeg: 40.1, lonDeg: -105.2 }];
const old = encodeStateBlob({ observers: obs, mode: 'visual' });
const withId = encodeStateBlob({ observers: obs, mode: 'visual', noradId: 20580 });
const q = (s) => new URLSearchParams(s === undefined ? '' : { s });

test('/ with good s', () => {
  assert.equal(legacyRedirect('/', q(old)), `/sat/25544/share/${old}`);
  assert.equal(legacyRedirect('/', q(withId)), `/sat/20580/share/${withId}`);
});
test('/ with empty or bad s', () => {
  for (const s of ['', '!!!', 'e30', 'e30=', old + '$']) {
    assert.equal(legacyRedirect('/', q(s)), '/sat/25544', s);
  }
});
test('/ without s', () => assert.equal(legacyRedirect('/', q()), null));
test('/classic with good s', () => {
  assert.equal(legacyRedirect('/classic', q(old)), `/sat/25544/share/${old}`);
  assert.equal(legacyRedirect('/classic/x/y', q(withId)), `/sat/20580/share/${withId}`);
});
test('/classic with empty or bad s', () => {
  for (const s of ['', 'zzz!', 'e30']) {
    assert.equal(legacyRedirect('/classic', q(s)), '/sat/25544');
    assert.equal(legacyRedirect('/classic/a', q(s)), '/sat/25544');
  }
});
test('/classic without s', () => {
  assert.equal(legacyRedirect('/classic', q()), '/');
  assert.equal(legacyRedirect('/classic/a', q()), '/');
});
test('other paths', () => assert.equal(legacyRedirect('/sat/1', q(old)), null));

test('satRedirect sends non-canonical and bad share URLs to one canonical path', () => {
  const blob = makeShareBlob({ noradId: 25544, observers: [{ name: 'EN52ve', latDeg: 42.19, lonDeg: -88.21 }], mode: 'radio', minElevDeg: 10 });
  assert.equal(satRedirect('/sat/25544'), null);
  assert.equal(satRedirect('/sat/025544'), '/sat/25544');
  assert.equal(satRedirect('/sat/25544-iss-zarya'), '/sat/25544');
  assert.equal(satRedirect('/sat/abc'), null);
  assert.equal(satRedirect(`/sat/25544/share/${blob}`), null);
  assert.equal(satRedirect(`/sat/25544-iss/share/${blob}`), `/sat/25544/share/${blob}`);
  assert.equal(satRedirect('/sat/25544/share/garbage!!'), '/sat/25544');
  assert.equal(satRedirect('/sat/25544/share/garbage'), '/sat/25544');
  assert.equal(satRedirect('/sat/abc/share/garbage'), null);
  assert.equal(satRedirect('/'), null);
});
