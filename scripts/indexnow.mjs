#!/usr/bin/env node
// scripts/indexnow.mjs - submit SeekSat's pages to IndexNow (lib/seo/indexnow.mjs).
// Reads the PRODUCTION sitemap, so run it only after a deploy is live, and
// only when the deploy changed what search engines see (CLAUDE.md):
//
//   npm run indexnow                 every URL in the sitemap
//   npm run indexnow -- / /mcp       just these paths
//
// New satellites need no run: the catalog refresh submits them itself.
import { INDEXNOW_BATCH, siteUrl, submitToIndexNow } from '../lib/seo/indexnow.mjs';

async function urls() {
  const paths = process.argv.slice(2);
  if (paths.length) return paths.map(siteUrl);
  const res = await fetch(siteUrl('/sitemap.xml'));
  if (!res.ok) throw new Error(`Could not fetch the sitemap: HTTP ${res.status}`);
  const list = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (!list.length) throw new Error('No <loc> URLs found in the sitemap.');
  return list;
}

const list = await urls();
console.log(`Submitting ${list.length} URLs to IndexNow in ${Math.ceil(list.length / INDEXNOW_BATCH)} batch(es)...`);
try {
  for (const [i, b] of (await submitToIndexNow(list)).entries()) console.log(`Batch ${i + 1} (${b.count} URLs): HTTP ${b.status}`);
  console.log('Done.');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
