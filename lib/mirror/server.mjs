// lib/mirror/server.mjs - lazily created production wiring of the catalog reader.
import { createCatalogReader } from './reader.mjs';
import { createOnDemandFetcher } from './on-demand.mjs';
import { createBlobSnapshotStore } from './snapshot-store.mjs';
import { fetchByCatnr } from './celestrak.mjs';

let reader = null;

export function getCatalogReader() {
  if (!reader) {
    reader = createCatalogReader({
      store: createBlobSnapshotStore(),
      onDemand: createOnDemandFetcher({ fetchByCatnr, now: Date.now }),
      now: Date.now,
    });
  }
  return reader;
}
