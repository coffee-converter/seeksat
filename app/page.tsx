import type { Metadata } from "next";
import PassFinderApp from "@/components/PassFinderApp";
import { ogImageMetadata } from "@/lib/og/og-metadata.mjs";
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

// Home page: multi-observer satellite pass finder. The component is
// "use client" and waits for window.Cesium inside useEffect, so SSR
// only emits the DOM skeleton; the bootstrap runs entirely on the
// client.
export default function HomePage() {
  return <PassFinderApp />;
}
