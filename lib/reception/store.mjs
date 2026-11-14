// lib/reception/store.mjs - where the reception tally lives: its own gzipped
// JSON file in Blob, beside the catalog snapshot but never inside it, so the
// catalog refresh and the reception collector never overwrite each other.
import { gzipSync, gunzipSync } from 'node:zlib';
import { createBlobGzipJsonStore } from '../mirror/snapshot-store.mjs';

export const RECEPTION_PATHNAME = 'catalog/reception.json.gz';
const VERSION = 1;

export function encodeReception(tally) {
  return gzipSync(Buffer.from(JSON.stringify(tally), 'utf8'));
}

export function decodeReception(buf) {
  const t = JSON.parse(gunzipSync(buf).toString('utf8'));
  if (!t || t.version !== VERSION) throw new Error(`unsupported reception version: ${t && t.version}`);
  return t;
}

export function createBlobReceptionStore(opts = {}) {
  return createBlobGzipJsonStore({ ...opts, pathname: RECEPTION_PATHNAME, encode: encodeReception, decode: decodeReception, label: 'reception' });
}

export function createMemoryReceptionStore(initial = null) {
  let current = initial;
  return {
    async read() { return current && structuredClone(current); },
    async write(t) { current = structuredClone(t); },
  };
}
