import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapLayers, focusBarText, followLabel, parseFocus, focusHref, focusNavMethod, satPageLayers, showAllCount,
} from '../lib/home/focus.mjs';

const layer = (noradId, emphasis) => ({ noradId, emphasis });

test('unfocused: followed are normal, hidden are hidden, in following order', () => {
  assert.deepEqual(mapLayers({ followed: [1, 2, 3], hidden: [2], focusId: null, viewing: null }), [
    layer(1, 'normal'), layer(2, 'hidden'), layer(3, 'normal'),
  ]);
});

test('unfocused with nothing hidden: all normal', () => {
  assert.deepEqual(mapLayers({ followed: [1, 2], hidden: [], focusId: null, viewing: null }), [
    layer(1, 'normal'), layer(2, 'normal'),
  ]);
});

test('unfocused: a viewing satellite is not shown', () => {
  assert.deepEqual(mapLayers({ followed: [1], hidden: [], focusId: null, viewing: 9 }), [layer(1, 'normal')]);
});

test('focused on a followed satellite: it is focus, the others ghost', () => {
  assert.deepEqual(mapLayers({ followed: [1, 2, 3], hidden: [], focusId: 2, viewing: null }), [
    layer(1, 'ghost'), layer(2, 'focus'), layer(3, 'ghost'),
  ]);
});

test('focused on a hidden satellite: it shows while focused', () => {
  assert.deepEqual(mapLayers({ followed: [1, 2], hidden: [2], focusId: 2, viewing: null }), [
    layer(1, 'ghost'), layer(2, 'focus'),
  ]);
});

test('focused: other hidden satellites stay hidden', () => {
  assert.deepEqual(mapLayers({ followed: [1, 2, 3], hidden: [3], focusId: 1, viewing: null }), [
    layer(1, 'focus'), layer(2, 'ghost'), layer(3, 'hidden'),
  ]);
});

test('focused on a non-followed viewing satellite: it is focus, every followed one ghosts', () => {
  assert.deepEqual(mapLayers({ followed: [1, 2], hidden: [], focusId: 9, viewing: 9 }), [
    layer(1, 'ghost'), layer(2, 'ghost'), layer(9, 'focus'),
  ]);
});

test('focused on a followed satellite while another is viewing: the viewing one is not shown', () => {
  assert.deepEqual(mapLayers({ followed: [1, 2], hidden: [], focusId: 1, viewing: 9 }), [
    layer(1, 'focus'), layer(2, 'ghost'),
  ]);
});

test('a focus that is neither followed nor viewing adds nothing', () => {
  assert.deepEqual(mapLayers({ followed: [1], hidden: [], focusId: 7, viewing: 9 }), [layer(1, 'ghost')]);
});

test('viewing a followed satellite is not listed twice', () => {
  assert.deepEqual(mapLayers({ followed: [1, 2], hidden: [], focusId: 2, viewing: 2 }), [
    layer(1, 'ghost'), layer(2, 'focus'),
  ]);
});

test('nothing followed: only the focused viewing satellite', () => {
  assert.deepEqual(mapLayers({ followed: [], hidden: [], focusId: 9, viewing: 9 }), [layer(9, 'focus')]);
  assert.deepEqual(mapLayers({ followed: [], hidden: [], focusId: null, viewing: 9 }), []);
});

test('missing arguments default to empty', () => {
  assert.deepEqual(mapLayers({}), []);
  assert.deepEqual(mapLayers({ followed: [4] }), [layer(4, 'normal')]);
});

test('focusBarText gives the title and the show all count', () => {
  assert.deepEqual(focusBarText('GOES 16', false, 4), { title: 'Viewing GOES 16', showAll: 'Show all (4)', follow: '☆ Follow' });
  assert.deepEqual(focusBarText('ISS', true, 1), { title: 'Viewing ISS', showAll: 'Show all (1)', follow: '★ Following' });
  assert.equal(focusBarText('X', true, 0).showAll, 'Show all (0)');
});

test('followLabel names the satellite for the star', () => {
  assert.equal(followLabel('GOES 16', false), 'Follow GOES 16');
  assert.equal(followLabel('GOES 16', true), 'Unfollow GOES 16');
});

test('no copy has an em dash', () => {
  const all = [
    ...Object.values(focusBarText('A', true, 2)), ...Object.values(focusBarText('A', false, 2)),
    followLabel('A', true), followLabel('A', false),
  ];
  for (const s of all) assert.ok(!s.includes('—'), s);
});

test('parseFocus accepts a NORAD id and nothing else', () => {
  assert.equal(parseFocus('25544'), 25544);
  assert.equal(parseFocus('1'), 1);
  for (const bad of [null, undefined, '', 'abc', '0', '-3', '2.5', '1e3', ' 12', '1234567890']) {
    assert.equal(parseFocus(bad), null, String(bad));
  }
});

test('focusHref sets or drops focus and keeps other params', () => {
  assert.equal(focusHref('/', '', 25544), '/?focus=25544');
  assert.equal(focusHref('/', '?focus=1', 2), '/?focus=2');
  assert.equal(focusHref('/', '?focus=1', null), '/');
  assert.equal(focusHref('/', '?a=b&focus=1', null), '/?a=b');
  assert.equal(focusHref('/', 'a=b', 3), '/?a=b&focus=3');
});

test('focusNavMethod: replace for the first focus and for clearing, push when switching', () => {
  assert.equal(focusNavMethod(null, 5), 'replace');
  assert.equal(focusNavMethod(5, 6), 'push');
  assert.equal(focusNavMethod(5, null), 'replace');
  assert.equal(focusNavMethod(5, 5), null);
  assert.equal(focusNavMethod(null, null), null);
});

test('satPageLayers: focused on the page satellite, not followed', () => {
  assert.deepEqual(satPageLayers({ followed: [1, 2], hidden: [], focusId: 9, pageId: 9 }), [
    layer(1, 'ghost'), layer(2, 'ghost'), layer(9, 'focus'),
  ]);
});

test('satPageLayers: show all draws the followed ones plus the page satellite', () => {
  assert.deepEqual(satPageLayers({ followed: [1, 2], hidden: [2], focusId: null, pageId: 9 }), [
    layer(1, 'normal'), layer(2, 'hidden'), layer(9, 'normal'),
  ]);
  // A followed, hidden page satellite still shows on its own page.
  assert.deepEqual(satPageLayers({ followed: [1, 9], hidden: [9], focusId: null, pageId: 9 }), [
    layer(1, 'normal'), layer(9, 'normal'),
  ]);
});

test('satPageLayers: focused on another satellite, the page one ghosts', () => {
  assert.deepEqual(satPageLayers({ followed: [1, 2], hidden: [], focusId: 1, pageId: 9 }), [
    layer(1, 'focus'), layer(2, 'ghost'), layer(9, 'ghost'),
  ]);
  assert.deepEqual(satPageLayers({ followed: [1, 9], hidden: [], focusId: 1, pageId: 9 }), [
    layer(1, 'focus'), layer(9, 'ghost'),
  ]);
});

test('showAllCount counts what Show all draws', () => {
  assert.equal(showAllCount(mapLayers({ followed: [1, 2, 3], hidden: [2], focusId: null })), 2);
  assert.equal(showAllCount(satPageLayers({ followed: [1, 2], hidden: [], focusId: null, pageId: 9 })), 3);
  assert.equal(showAllCount(satPageLayers({ followed: [1, 9], hidden: [9], focusId: null, pageId: 9 })), 2);
});
