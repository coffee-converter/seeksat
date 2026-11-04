import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkPath, parseView, stripView, viewQuery, viewUrl } from '../lib/share/view-link.mjs';

const base = { projection: 'globe', following: [25544, 48274], hidden: [], mode: 'visual' };

test('a home view at its home camera carries no zoom or centre', () => {
  assert.equal(viewQuery({ ...base, zoom: null, center: null }), 'map=globe&sats=25544,48274&mode=visual');
});

test('a moved view carries zoom and a centre rounded to about 10 km', () => {
  const q = viewQuery({ ...base, zoom: 3.4567, center: [-93.26543, 44.97712] });
  assert.equal(q, 'map=globe&z=3.5&c=45,-93.3&sats=25544,48274&mode=visual');
});

test('locked on carries the zoom but never a centre', () => {
  const q = viewQuery({ ...base, lock: true, zoom: 5.04, center: [-93.2, 44.9] });
  assert.equal(q, 'map=globe&lock=1&z=5&sats=25544,48274&mode=visual');
});

test('no location ever goes in the link', () => {
  const q = viewQuery({ ...base, zoom: null, center: null, location: { latDeg: 44.97712, lonDeg: -93.26543 }, observers: [{ name: 'Home' }] });
  assert.doesNotMatch(q, /44\.97|93\.26|Home/);
});

test('hidden ids outside the list, bad ids and repeats are dropped', () => {
  const q = viewQuery({ ...base, following: [25544, 25544, -1, 1.5, 48274], hidden: [48274, 999] });
  assert.equal(q, 'map=globe&sats=25544,48274&hide=48274&mode=visual');
});

test('the frequency goes only with radio mode', () => {
  assert.match(viewQuery({ ...base, mode: 'radio', freqHz: 145800000.4 }), /mode=radio&f=145800000$/);
  assert.doesNotMatch(viewQuery({ ...base, mode: 'visual', freqHz: 145800000 }), /f=/);
});

test('an empty list is shared as empty', () => {
  assert.equal(viewQuery({ ...base, following: [] }), 'map=globe&sats=&mode=visual');
  assert.deepEqual(parseView('?map=flat&sats=&mode=visual').following, []);
});

test('viewUrl joins origin, path and query', () => {
  assert.equal(viewUrl('https://seeksat.com', '/sat/25544', { ...base, lock: true, zoom: 4 }),
    'https://seeksat.com/sat/25544?map=globe&lock=1&z=4&sats=25544,48274&mode=visual');
});

test('parseView round-trips a view', () => {
  const v = parseView(viewQuery({ ...base, hidden: [48274], zoom: 3.4, center: [-93.3, 45], mode: 'radio', freqHz: 436795000 }));
  assert.deepEqual(v, {
    projection: 'globe', lock: false, zoom: 3.4, center: [-93.3, 45],
    following: [25544, 48274], hidden: [48274], mode: 'radio', freqHz: 436795000,
  });
});

test('parseView: no map= means no shared view', () => {
  assert.equal(parseView(''), null);
  assert.equal(parseView('?focus=25544'), null);
  assert.equal(parseView('?map=mars&sats=1'), null);
});

test('parseView drops values that do not parse', () => {
  const v = parseView('?map=flat&z=abc&c=95,10&sats=a,25544&mode=loud&f=-3');
  assert.equal(v.zoom, null);
  assert.equal(v.center, null);
  assert.deepEqual(v.following, [25544]);
  assert.equal(v.mode, null);
  assert.equal(v.freqHz, null);
});

test('parseView: a zoom with no centre and no lock is ignored; no sats= keeps the list', () => {
  const v = parseView('?map=globe&z=4');
  assert.equal(v.zoom, null);
  assert.equal(v.following, null);
  assert.equal(parseView('?map=globe&lock=1&z=4').zoom, 4);
});

test('parseView caps the list at the follow limit', () => {
  const many = Array.from({ length: 30 }, (_, i) => i + 1).join(',');
  assert.equal(parseView(`?map=flat&sats=${many}`).following.length, 20);
});

test('stripView keeps other parameters', () => {
  assert.equal(stripView('?map=globe&focus=99999&z=3&c=1,2&sats=1&mode=radio&f=1'), '?focus=99999');
  assert.equal(stripView('?map=globe&lock=1'), '');
});

test('linkPath drops an old share blob', () => {
  assert.equal(linkPath('/sat/25544/share/eyJvIjpbXX0'), '/sat/25544');
  assert.equal(linkPath('/sat/25544'), '/sat/25544');
  assert.equal(linkPath('/'), '/');
});
