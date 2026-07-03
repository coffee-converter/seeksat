import type { Metadata } from "next";
import PassFinderApp from "@/components/PassFinderApp";
import { ogImageMetadata } from "@/lib/og/og-metadata.mjs";
import { createEdgeConfigStore } from "@/lib/mcp/tle-store.mjs";
import { recordsToSatelliteTles } from "@/lib/pass-finder/satellite-seed.js";
import { CATALOG } from "@/lib/catalog.mjs";
import type { Tle } from "@/lib/types";
import "./pass-finder.css";

// Per-share OG image: when the URL carries a ?s= state blob, point the
// social preview at the dynamic /api/og renderer so a shared pass link
// previews that pass's actual sky chart. Without ?s=, inherit the
// static og.png from the root layout's metadata.
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<{ s?: string }> },
): Promise<Metadata> {
  const { s } = await searchParams;
  return ogImageMetadata(s);
}

// Read the cron-cached TLEs for the whole catalog from Edge Config so
// the globe can paint the default satellite immediately and switch to
// any other without waiting on a client fetch. Any failure (Edge Config
// unset locally, read error) falls back to {} - the page then behaves
// as before and the client fetch fills each satellite on selection.
async function readInitialSatelliteTles(): Promise<Record<number, Tle>> {
  try {
    const map = await createEdgeConfigStore().readMap() as Record<string, unknown>;
    return recordsToSatelliteTles(CATALOG, map) as Record<number, Tle>;
  } catch {
    return {} as Record<number, Tle>;
  }
}

// Home page: multi-observer satellite pass finder. The component is
// "use client" and waits for window.Cesium inside useEffect, so SSR
// only emits the DOM skeleton; the bootstrap runs entirely on the
// client.
export default async function HomePage() {
  const initialSatelliteTles = await readInitialSatelliteTles();
  return <PassFinderApp initialSatelliteTles={initialSatelliteTles} />;
}
