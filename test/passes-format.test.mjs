import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPassDuration } from '../lib/passes/format.mjs';

test('formatPassDuration', () => {
  assert.equal(formatPassDuration(318), '5m18s');
  assert.equal(formatPassDuration(65), '1m05s');
  assert.equal(formatPassDuration(29_220), '8h07m');
  assert.equal(formatPassDuration(3600), '1h00m');
});
