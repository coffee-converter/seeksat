// lib/seo/indexnow.mjs - tell IndexNow (Bing, Yandex, Seznam and others; not
// Google, which reads the sitemap through Search Console) which pages were
// added, changed or removed, so they are crawled sooner. Used by
// scripts/indexnow.mjs (by hand, after a deploy) and by the catalog refresh
// (app/api/refresh-tle: satellites new to the snapshot, and ones gone from it).
//
// The key is published at https://seeksat.com/<key>.txt (public/), which is
// how IndexNow checks the site is ours.

export const INDEXNOW_HOST = 'seeksat.com';
export const INDEXNOW_KEY = '643bd01cd90649ce18522629263d9d05';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
/** IndexNow takes at most this many URLs in one request. */
export const INDEXNOW_BATCH = 10_000;

/** A site path as a full URL. */
export const siteUrl = (path) => `https://${INDEXNOW_HOST}${path.startsWith('/') ? path : `/${path}`}`;

/**
 * Submit full URLs in batches. Resolves to one { count, status } per batch;
 * throws on a refusal (anything but 200 or 202), with IndexNow's reason.
 */
export async function submitToIndexNow(urls, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  const out = [];
  for (let i = 0; i < urls.length; i += INDEXNOW_BATCH) {
    const urlList = urls.slice(i, i + INDEXNOW_BATCH);
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: INDEXNOW_HOST, key: INDEXNOW_KEY, keyLocation: siteUrl(`/${INDEXNOW_KEY}.txt`), urlList }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 200 accepted, 202 accepted with the key still to be checked.
    if (res.status !== 200 && res.status !== 202) {
      const reason = await res.text().catch(() => '');
      throw new Error(`IndexNow refused batch ${out.length + 1}: HTTP ${res.status} ${reason}`.trim());
    }
    out.push({ count: urlList.length, status: res.status });
  }
  return out;
}
