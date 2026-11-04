import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cx, buttonClass, badgeClass, segmentedNext, modalClass, linkClass, surfaceClass } from '../lib/ui/classes.mjs';

test('buttonClass defaults and modifiers', () => {
  assert.equal(buttonClass(), 'btn');
  assert.equal(buttonClass({ variant: 'primary', size: 'sm' }), 'btn btn--primary btn--sm');
  assert.equal(buttonClass({ variant: 'quiet', iconOnly: true, tone: 'danger', done: true }), 'btn btn--quiet btn--icon btn--danger btn--done');
});
test('buttonClass overlay variant and the accent pressed look', () => {
  assert.equal(buttonClass({ variant: 'overlay', size: 'sm' }), 'btn btn--overlay btn--sm');
  assert.equal(buttonClass({ pressedLook: 'accent' }), 'btn btn--accent-pressed');
  assert.equal(buttonClass({ pressedLook: 'fill' }), 'btn');
});
test('buttonClass on: the pressed look without aria-pressed', () => {
  assert.equal(buttonClass({ on: true }), 'btn btn--on');
  assert.equal(buttonClass({ variant: 'primary', on: true, pressedLook: 'accent' }), 'btn btn--primary btn--accent-pressed btn--on');
  assert.equal(buttonClass({ on: false }), 'btn');
});
test('badgeClass', () => {
  assert.equal(badgeClass(), 'badge');
  assert.equal(badgeClass('warn'), 'badge badge--warn');
  assert.equal(badgeClass('rating'), 'badge badge--rating');
});
test('segmentedNext moves with arrows, wraps, and jumps with Home and End', () => {
  const v = ['auto', 'light', 'dark'];
  assert.equal(segmentedNext(v, 'auto', 'ArrowRight'), 'light');
  assert.equal(segmentedNext(v, 'dark', 'ArrowRight'), 'auto');
  assert.equal(segmentedNext(v, 'auto', 'ArrowLeft'), 'dark');
  assert.equal(segmentedNext(v, 'light', 'Home'), 'auto');
  assert.equal(segmentedNext(v, 'light', 'End'), 'dark');
  assert.equal(segmentedNext(v, 'light', 'a'), 'light');
});
test('segmentedNext from nothing chosen goes to the first (or last) option', () => {
  const v = ['auto', 'light', 'dark'];
  assert.equal(segmentedNext(v, null, 'ArrowRight'), 'auto');
  assert.equal(segmentedNext(v, null, 'ArrowDown'), 'auto');
  assert.equal(segmentedNext(v, null, 'ArrowLeft'), 'dark');
  assert.equal(segmentedNext(v, null, 'ArrowUp'), 'dark');
  // A value no longer among the enabled options counts as nothing chosen.
  assert.equal(segmentedNext(['light', 'dark'], 'auto', 'ArrowRight'), 'light');
});
test('segmentedNext ignores keys held with Alt, Meta or Ctrl', () => {
  const v = ['auto', 'light', 'dark'];
  for (const mod of ['altKey', 'metaKey', 'ctrlKey']) {
    assert.equal(segmentedNext(v, 'auto', 'ArrowRight', { [mod]: true }), 'auto', mod);
    assert.equal(segmentedNext(v, 'light', 'Home', { [mod]: true }), 'light', mod);
  }
  assert.equal(segmentedNext(v, 'auto', 'ArrowRight', { shiftKey: true }), 'light');
});
test('linkClass is the library link look', () => assert.equal(linkClass(), buttonClass({ variant: 'link' })));
test('cx drops falsy parts', () => assert.equal(cx('a', false, null, 'b', undefined, ''), 'a b'));

test('modalClass', () => {
  assert.equal(modalClass(), 'modal');
  assert.equal(modalClass({ size: 'full', tone: 'dark' }), 'modal modal--full theme-dark');
});

test('surfaceClass: padded by default, compact, flush, accent, selected, interactive', () => {
  assert.equal(surfaceClass(), 'surface surface--padded');
  assert.equal(surfaceClass({ padded: 'sm' }), 'surface surface--padded-sm');
  assert.equal(surfaceClass({ padded: false }), 'surface');
  assert.equal(surfaceClass({ accent: true, selected: true }), 'surface surface--padded surface--accent surface--selected');
  assert.equal(surfaceClass({ padded: 'sm', interactive: true }), 'surface surface--padded-sm surface--interactive');
});
