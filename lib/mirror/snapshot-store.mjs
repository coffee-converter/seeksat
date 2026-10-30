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

export const SNAPSHOT_FETCH_TIMEOUT_MS = 15_000;

export function createBlobSnapshotStore({
  blob, fetchImpl, timeoutMs = SNAPSHOT_FETCH_TIMEOUT_MS,
  setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout,
} = {}) {
  let mod = blob || null;
  const getBlob = async () => (mod ||= await import('@vercel/blob'));
  const doFetch = (url, opts) => (fetchImpl || globalThis.fetch)(url, opts);

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
      // Bound the download (headers and body) so a stalled Blob fetch
      // can't hang every reader caller.
      const ac = new AbortController();
      const timer = setTimeoutImpl(() => ac.abort(new Error(`snapshot fetch aborted after ${timeoutMs} ms`)), timeoutMs);
      try {
        const res = await doFetch(meta.url, { signal: ac.signal });
        if (!res.ok) throw new Error(`snapshot fetch failed: ${res.status}`);
        return decodeSnapshot(Buffer.from(await res.arrayBuffer()));
      } finally {
        clearTimeoutImpl(timer);
      }
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
