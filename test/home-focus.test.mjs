import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapLayers, focusBarText, parseFocus, focusHref, focusNavMethod, satPageLayers, showAllCount, focusDestination,
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
  // Followed (even hidden): it keeps its place, as the focus.
  assert.deepEqual(satPageLayers({ followed: [1, 9], hidden: [9], pageId: 9 }), [
    layer(1, 'ghost'), layer(9, 'focus'),
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

test('unfocused with a highlight (an open pass row): it is focus, the others ghost', () => {
  assert.deepEqual(mapLayers({ followed: [1, 2], highlightId: 2 }), [
    layer(1, 'ghost'), layer(2, 'focus'),
  ]);
});

test('a focus wins over a highlight', () => {
  assert.deepEqual(mapLayers({ followed: [1, 2], focusId: 1, highlightId: 2 }), [
    layer(1, 'focus'), layer(2, 'ghost'),
  ]);
});

test('a highlight that is not followed changes nothing', () => {
  assert.deepEqual(mapLayers({ followed: [1, 2], highlightId: 9 }), [
    layer(1, 'normal'), layer(2, 'normal'),
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
  assert.equal(focusBarText('GOES 16', false, 4).title, 'Viewing GOES 16');
  assert.equal(focusBarText('GOES 16', false, 4).showAll, 'Show all (4)');
  assert.equal(focusBarText('X', true, 0).showAll, 'Show all (0)');
});

test('no copy has an em dash', () => {
  const all = [
    ...Object.values(focusBarText('A', true, 2)).flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v))),
    ...Object.values(focusBarText('A', false, 2)).flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v))),
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

test('focusNavMethod: push to enter, replace to switch, back or replace to clear', () => {
  assert.equal(focusNavMethod(null, 5, false), 'push');
  assert.equal(focusNavMethod(null, 5, true), 'push');
  assert.equal(focusNavMethod(5, 6, false), 'replace');
  assert.equal(focusNavMethod(5, 6, true), 'replace');
  // Clearing steps back over our own pushed entry, else rewrites this one.
  assert.equal(focusNavMethod(5, null, true), 'back');
  assert.equal(focusNavMethod(5, null, false), 'replace');
  assert.equal(focusNavMethod(5, 5, true), null);
  assert.equal(focusNavMethod(null, null, false), null);
});

test('satPageLayers: focused on the page satellite, not followed', () => {
  assert.deepEqual(satPageLayers({ followed: [1, 2], hidden: [], pageId: 9 }), [
    layer(1, 'ghost'), layer(2, 'ghost'), layer(9, 'focus'),
  ]);
  // Followed (even hidden): it keeps its place, as the focus.
  assert.deepEqual(satPageLayers({ followed: [1, 9], hidden: [9], pageId: 9 }), [
    layer(1, 'ghost'), layer(9, 'focus'),
  ]);
});

test('showAllCount counts what Show all draws', () => {
  assert.equal(showAllCount(mapLayers({ followed: [1, 2, 3], hidden: [2], focusId: null })), 2);
});

test('focusDestination opens catalog satellites and keeps pasted ones home', () => {
  assert.equal(focusDestination(25544, []), '/sat/25544');
  assert.equal(focusDestination(90001, [90001]), null);
  assert.equal(focusDestination(90001, new Set([90001])), null);
});
