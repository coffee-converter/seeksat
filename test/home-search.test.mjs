import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchQuery, searchUrl } from '../lib/home/search.mjs';

test('searchQuery rejects a single non-digit character', () => {
  assert.equal(searchQuery('i'), null);
});
test('searchQuery accepts a single digit', () => {
  assert.equal(searchQuery('5'), '5');
});
test('searchQuery trims', () => {
  assert.equal(searchQuery('  iss '), 'iss');
});
test('searchQuery caps at 64 characters', () => {
  assert.equal(searchQuery('a'.repeat(70)).length, 64);
});
test('searchQuery rejects empty and blank', () => {
  assert.equal(searchQuery(''), null);
  assert.equal(searchQuery('   '), null);
});
test('searchUrl encodes the query', () => {
  assert.equal(searchUrl('a b&c'), '/api/search?q=a%20b%26c');
});
test('searchQuery trims before capping', () => {
  assert.equal(searchQuery(' '.repeat(70) + 'iss'), 'iss');
});
