import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProKeys, resolveTier } from '../lib/mcp/auth.mjs';

test('parseProKeys: empty/undefined/blank -> empty set', () => {
  assert.equal(parseProKeys(undefined).size, 0);
  assert.equal(parseProKeys('').size, 0);
  assert.equal(parseProKeys('   ').size, 0);
});

test('parseProKeys: trims and drops blank entries', () => {
  const s = parseProKeys(' a , b ,, c ');
  assert.deepEqual([...s].sort(), ['a', 'b', 'c']);
});

test('resolveTier: no keys configured -> free for any input, keyId masked or null', () => {
  const none = new Set();
  assert.deepEqual(resolveTier(null, none), { tier: 'free', keyId: null });
  const r = resolveTier('whatever', none);
  assert.equal(r.tier, 'free');
  assert.ok(r.keyId.startsWith('key_'));
});

test('resolveTier: matching key -> pro; non-matching -> free; raw key never leaks', () => {
  const keys = parseProKeys('secret123');
  const pro = resolveTier('secret123', keys);
  assert.equal(pro.tier, 'pro');
  assert.ok(pro.keyId.startsWith('key_'));
  assert.ok(!pro.keyId.includes('secret123'));
  const free = resolveTier('wrongkey', keys);
  assert.equal(free.tier, 'free');
  assert.ok(!free.keyId.includes('wrongkey'));
});

test('resolveTier: anonymous (no key) -> null keyId', () => {
  assert.equal(resolveTier(null, parseProKeys('k')).keyId, null);
  assert.equal(resolveTier('', parseProKeys('k')).keyId, null);
  assert.equal(resolveTier('   ', parseProKeys('k')).keyId, null);
});
