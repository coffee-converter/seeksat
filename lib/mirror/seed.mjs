// lib/mirror/seed.mjs - the home page's initial { [noradId]: Tle } seed for the
// curated catalog. Snapshot only (never the on-demand CelesTrak path) and
// raced against a short timeout so a slow mirror can't hold up the page;
// any failure or timeout falls back to {} and the client fetch fills in.
import { recordsToSatelliteTles } from '../pass-finder/satellite-seed.js';

export const HOME_SEED_TIMEOUT_MS = 1500;

export async function readInitialSatelliteTles({
  reader, catalog, timeoutMs = HOME_SEED_TIMEOUT_MS,
  setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout,
}) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeoutImpl(() => resolve(null), timeoutMs); });
  const read = (async () => {
    const entries = await Promise.all(
      catalog.map(async (s) => [s.noradId, await reader.getSnapshotRecord(s.noradId)]),
    );
    return recordsToSatelliteTles(catalog, Object.fromEntries(entries));
  })();
  read.catch(() => {}); // a late rejection after the timeout won is not unhandled
  try {
    return (await Promise.race([read, timeout])) ?? {};
  } catch {
    return {};
  } finally {
    clearTimeoutImpl(timer);
  }
}
