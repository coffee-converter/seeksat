// lib/reception/reader.mjs - the reception tally for the MCP tools, read
// from its store at most once an hour per server instance and indexed for
// lookups (lib/reception/tally.mjs). Never throws: no data reads as null, and
// a failed read keeps the last index.
import { indexTally } from './tally.mjs';

/** How long a read is kept. The collector writes a few times a day. */
export const RELOAD_MS = 3_600_000;

export function createReceptionReader({ store, now = Date.now, reloadMs = RELOAD_MS }) {
  let current = null;
  let loadedAtMs = null;
  let inflight = null;
  return {
    async index() {
      const t = now();
      if (loadedAtMs != null && t - loadedAtMs < reloadMs) return current;
      inflight ??= (async () => {
        try {
          const tally = await store.read();
          current = tally ? indexTally(tally) : current;
        } catch {
          // keep what we had
        } finally {
          loadedAtMs = now();
          inflight = null;
        }
        return current;
      })();
      return inflight;
    },
  };
}
