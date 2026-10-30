// lib/mirror/snapshot-store.mjs - snapshot persistence (Vercel Blob or memory).
// I/O is injected; @vercel/blob and fetch are resolved lazily when not given.
import { encodeSnapshot, decodeSnapshot } from './snapshot.mjs';

export const SNAPSHOT_PATHNAME = 'catalog/snapshot.json.gz';

export function createMemorySnapshotStore(initial = null) {
  let current = initial;
  return {
    async read() { return current; },
    async write(s) { current = s; },
  };
}

export function createBlobSnapshotStore({ blob, fetchImpl } = {}) {
  let mod = blob || null;
  const getBlob = async () => (mod ||= await import('@vercel/blob'));
  const doFetch = (url) => (fetchImpl || globalThis.fetch)(url);

  return {
    async read() {
      const b = await getBlob();
      let meta;
      try {
        meta = await b.head(SNAPSHOT_PATHNAME);
      } catch (err) {
        const NF = b.BlobNotFoundError;
        if (err && ((typeof NF === 'function' && err instanceof NF) || err.name === 'BlobNotFoundError')) return null;
        throw err;
      }
      const res = await doFetch(meta.url);
      if (!res.ok) throw new Error(`snapshot fetch failed: ${res.status}`);
      return decodeSnapshot(Buffer.from(await res.arrayBuffer()));
    },
    async write(s) {
      const b = await getBlob();
      await b.put(SNAPSHOT_PATHNAME, encodeSnapshot(s), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/gzip',
        cacheControlMaxAge: 60,
      });
    },
  };
}
