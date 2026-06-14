import type { Metadata } from "next";
import PassFinderApp from "@/components/PassFinderApp";
import { ogImageMetadata } from "@/lib/og/og-metadata.mjs";
import { createEdgeConfigStore } from "@/lib/mcp/tle-store.mjs";
import { recordToTle } from "@/lib/pass-finder/tle-seed.js";
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

// Read the cron-cached ISS TLE from Edge Config so the globe can render
// immediately. Any failure (Edge Config unset locally, read error,
// missing/malformed record) falls back to null — the page then behaves
// exactly as before and the client fetch fills the globe.
async function readInitialIssTle() {
  try {
    const map = await createEdgeConfigStore().readMap() as Record<string, unknown>;
    return recordToTle(map["25544"]);
  } catch {
    return null;
  }
}

// Home page: multi-observer satellite pass finder. The component is
// "use client" and waits for window.Cesium inside useEffect, so SSR
// only emits the DOM skeleton; the bootstrap runs entirely on the
// client.
export default async function HomePage() {
  const initialTle = await readInitialIssTle();
  return <PassFinderApp initialTle={initialTle} />;
}
