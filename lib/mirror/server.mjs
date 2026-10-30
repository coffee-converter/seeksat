// lib/mirror/server.mjs - lazily created production wiring of the catalog reader.
import { createCatalogReader } from './reader.mjs';
import { createOnDemandFetcher } from './on-demand.mjs';
import { createBlobSnapshotStore } from './snapshot-store.mjs';
import { fetchByCatnr } from './celestrak.mjs';

let reader = null;

// Only production asks CelesTrak for objects missing from the snapshot.
// Local dev and previews read the snapshot alone, so a developer machine
// (or a busy preview) never adds to the request count CelesTrak sees.
const NO_ON_DEMAND = { get: async () => null };

export function onDemandFor(vercelEnv) {
  return vercelEnv === 'production' ? createOnDemandFetcher({ fetchByCatnr, now: Date.now }) : NO_ON_DEMAND;
}

export function getCatalogReader() {
  if (!reader) {
    reader = createCatalogReader({
      store: createBlobSnapshotStore(),
      onDemand: onDemandFor(process.env.VERCEL_ENV),
      now: Date.now,
    });
  }
  return reader;
}
