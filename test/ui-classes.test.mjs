import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cx, buttonClass, badgeClass, segmentedNext, modalClass } from '../lib/ui/classes.mjs';

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
test('cx drops falsy parts', () => assert.equal(cx('a', false, null, 'b', undefined, ''), 'a b'));

test('modalClass', () => {
  assert.equal(modalClass(), 'modal');
  assert.equal(modalClass({ size: 'full', tone: 'dark' }), 'modal modal--full theme-dark');
});
