// lib/sat/busy.ts - what a satellite page renders when the catalog can't
// answer (Blob unreachable, or an object outside the snapshot after the
// hourly CelesTrak lookups are spent).
//
// These pages are ISR: a throw serves Next's bare 500 (error.tsx never shows
// for a prerender), and anything dynamic is a 500 too. So the page renders a
// "busy" view instead, and an unstable_cache entry with a short revalidate
// lowers this render's cache life to a minute: the next visit after that
// tries the catalog again, rather than an hour later.

import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { unstable_rethrow } from "next/navigation";

export const BUSY_RETRY_S = 60;

/** Rethrows Next's own control flow (notFound, redirects); otherwise makes
 *  this render's page cache last BUSY_RETRY_S. */
export async function asBusy(err: unknown, key: string): Promise<void> {
  unstable_rethrow(err);
  await unstable_cache(async () => true, ["sat-busy", key], { revalidate: BUSY_RETRY_S })();
}

export const BUSY_METADATA: Metadata = {
  title: "Satellite catalog busy | SeekSat",
  robots: { index: false, follow: true },
};
