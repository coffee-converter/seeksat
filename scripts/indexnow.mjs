#!/usr/bin/env node
// scripts/indexnow.mjs - tell IndexNow (Bing, Yandex, Seznam and others; not
// Google, which reads the sitemap through Search Console) about SeekSat's
// pages, so new and changed ones are crawled sooner.
//
// Reads the PRODUCTION sitemap, so run it only after a deploy is live:
//
//   npm run indexnow                 every URL in the sitemap
//   npm run indexnow -- / /mcp       just these paths
//
// IndexNow takes at most 10,000 URLs per request; the sitemap (one page per
// catalogued satellite) is longer, so it goes in batches. The key is
// published at https://seeksat.com/<key>.txt (public/), which is how IndexNow
// checks the site is ours.

const HOST = "seeksat.com";
const KEY = "643bd01cd90649ce18522629263d9d05";
const SITEMAP = `https://${HOST}/sitemap.xml`;
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/indexnow";
const BATCH = 10_000;

async function urls() {
  const paths = process.argv.slice(2);
  if (paths.length) return paths.map((p) => `https://${HOST}${p.startsWith("/") ? p : `/${p}`}`);
  const res = await fetch(SITEMAP);
  if (!res.ok) throw new Error(`Could not fetch the sitemap: HTTP ${res.status}`);
  const list = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (!list.length) throw new Error("No <loc> URLs found in the sitemap.");
  return list;
}

async function main() {
  const list = await urls();
  console.log(`Submitting ${list.length} URLs to IndexNow in ${Math.ceil(list.length / BATCH)} batch(es)...`);
  for (let i = 0; i < list.length; i += BATCH) {
    const urlList = list.slice(i, i + BATCH);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
    });
    // 200 accepted, 202 accepted with the key still to be checked.
    console.log(`Batch ${i / BATCH + 1} (${urlList.length} URLs): HTTP ${res.status} ${res.statusText}`);
    if (res.status !== 200 && res.status !== 202) throw new Error(`Rejected. ${await res.text().catch(() => "")}`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
