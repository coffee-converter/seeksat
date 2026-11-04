import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import SatApp from "@/components/sat/SatApp";
import SatBusy from "@/components/sat/SatBusy";
import { BUSY_METADATA, asBusy } from "@/lib/sat/busy";
import { getCatalogReader } from "@/lib/mirror/server.mjs";
import { resolveSatellite } from "@/lib/catalog.mjs";
import { lookupSat, satMetadata, satPageData } from "@/lib/sat/page-data.mjs";

export const revalidate = 3600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };

// Deduped per request. Throws (never a cached 404) while the catalog is down;
// the page then renders the busy view for a minute (lib/sat/busy.ts).
const load = cache(async (param: string) => {
  const found = await lookupSat(getCatalogReader(), param);
  if (found.kind === "redirect") permanentRedirect(found.path as string);
  if (found.kind === "not-found") notFound();
  return satPageData(found.record, resolveSatellite(found.record.noradId), Date.now());
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    return satMetadata(await load(id));
  } catch (err) {
    await asBusy(err, id);
    return BUSY_METADATA;
  }
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  let data;
  try {
    data = await load(id);
  } catch (err) {
    await asBusy(err, id);
    return <SatBusy />;
  }
  return <SatApp key={data.noradId} data={data} />;
}
