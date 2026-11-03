import HomeApp from "@/components/home/HomeApp";
import { getCatalogReader } from "@/lib/mirror/server.mjs";
import { POPULAR_IDS } from "@/lib/home/prefs.mjs";
import type { SatApiRecord } from "@/lib/home/store";

// Rebuilt at most every 15 minutes rather than frozen at build time.
export const revalidate = 900;

const SEED_TIMEOUT_MS = 1500;

// Snapshot records for the popular satellites so the map paints on first
// load. Snapshot only (never CelesTrak) and raced against 1.5 s; any
// failure or timeout falls back to [] and the client fetch fills in.
async function loadInitialRecords(): Promise<SatApiRecord[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SEED_TIMEOUT_MS);
  });
  const read = (async () => {
    const reader = getCatalogReader();
    const records = await Promise.all(
      POPULAR_IDS.map((id: number) => reader.getSnapshotRecord(id)),
    );
    return records.filter((r): r is SatApiRecord => r != null);
  })();
  read.catch(() => {}); // a late rejection after the timeout won is not unhandled
  try {
    return (await Promise.race([read, timeout])) ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export default async function Page() {
  return <HomeApp initialRecords={await loadInitialRecords()} />;
}
