import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INDEXNOW_KEY, siteUrl, submitToIndexNow } from '../lib/seo/indexnow.mjs';

test('the IndexNow key is published where IndexNow looks for it', () => {
  assert.equal(readFileSync(new URL(`../public/${INDEXNOW_KEY}.txt`, import.meta.url), 'utf8').trim(), INDEXNOW_KEY);
  assert.equal(siteUrl('sat/25544'), 'https://seeksat.com/sat/25544');
});

test('URLs go in batches of 10,000, and a refusal says why', async () => {
  const sent = [];
  const ok = async (_u, init) => { sent.push(JSON.parse(init.body)); return { status: 200 }; };
  const urls = Array.from({ length: 12_345 }, (_, i) => siteUrl(`/sat/${i}`));
  assert.deepEqual(await submitToIndexNow(urls, { fetchImpl: ok }), [{ count: 10_000, status: 200 }, { count: 2_345, status: 200 }]);
  assert.equal(sent[0].host, 'seeksat.com');
  assert.equal(sent[0].keyLocation, `https://seeksat.com/${INDEXNOW_KEY}.txt`);
  const no = async () => ({ status: 403, text: async () => 'SiteVerificationNotCompleted' });
  await assert.rejects(submitToIndexNow(urls.slice(0, 3), { fetchImpl: no }), /HTTP 403 SiteVerificationNotCompleted/);
});
