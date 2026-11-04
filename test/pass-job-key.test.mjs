import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passJobKey, cardJobKey } from '../lib/passes/job-key.mjs';

const home = { id: 'home', name: 'Home', latDeg: 40.1, lonDeg: -88.2, tz: 'UTC' };
const sydney = { id: 'obs-1', name: 'Sydney', latDeg: -33.9, lonDeg: 151.2 };
const base = { observers: [home], mode: 'radio', minElevDeg: 10, recordId: 25544 };

test('passJobKey is stable for the same inputs, whatever the object identity', () => {
  assert.equal(passJobKey(base), passJobKey({ ...base, observers: [{ ...home }] }));
});

test('passJobKey changes with each input that changes the passes', () => {
  const k = passJobKey(base);
  assert.notEqual(passJobKey({ ...base, observers: [home, sydney] }), k);
  assert.notEqual(passJobKey({ ...base, observers: [{ ...home, latDeg: 41 }] }), k);
  assert.notEqual(passJobKey({ ...base, observers: [{ ...home, lonDeg: -87 }] }), k);
  assert.notEqual(passJobKey({ ...base, mode: 'visual' }), k);
  assert.notEqual(passJobKey({ ...base, minElevDeg: 20 }), k);
  assert.notEqual(passJobKey({ ...base, recordId: 25545 }), k);
});

test('passJobKey ignores a place rename and the time zone', () => {
  assert.equal(passJobKey({ ...base, observers: [{ ...home, name: 'Elsewhere', tz: 'Asia/Tokyo' }] }), passJobKey(base));
});

const card = { following: [25544, 33591], custom: [], observer: home, mode: 'radio', minElevDeg: 10 };

test('cardJobKey changes with followed ids, custom elements, observer, mode and minimum elevation', () => {
  const k = cardJobKey(card);
  assert.equal(cardJobKey({ ...card, observer: { ...home } }), k);
  assert.notEqual(cardJobKey({ ...card, following: [25544] }), k);
  assert.notEqual(cardJobKey({ ...card, custom: [{ noradId: 99999, line1: '1 a', line2: '2 b' }] }), k);
  assert.notEqual(cardJobKey({ ...card, observer: { ...home, latDeg: 0 } }), k);
  assert.notEqual(cardJobKey({ ...card, mode: 'visual' }), k);
  assert.notEqual(cardJobKey({ ...card, minElevDeg: 0 }), k);
  assert.notEqual(cardJobKey({ ...card, observer: null }), k);
});
