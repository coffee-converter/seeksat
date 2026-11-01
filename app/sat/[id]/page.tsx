import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import SatApp from "@/components/sat/SatApp";
import { getCatalogReader } from "@/lib/mirror/server.mjs";
import { resolveSatellite } from "@/lib/catalog.mjs";
import { lookupSat, satMetadata, satPageData } from "@/lib/sat/page-data.mjs";

export const revalidate = 3600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };

// Deduped per request. Throws (never a cached 404) while the catalog is down.
const load = cache(async (param: string) => {
  const found = await lookupSat(getCatalogReader(), param);
  if (found.kind === "redirect") permanentRedirect(found.path as string);
  if (found.kind === "not-found") notFound();
  return satPageData(found.record, resolveSatellite(found.record.noradId), Date.now());
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return satMetadata(await load(id));
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <SatApp data={await load(id)} />;
}
