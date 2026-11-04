import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import SatApp from "@/components/sat/SatApp";
import SatBusy from "@/components/sat/SatBusy";
import { BUSY_METADATA, asBusy } from "@/lib/sat/busy";
import { getCatalogReader } from "@/lib/mirror/server.mjs";
import { resolveSatellite } from "@/lib/catalog.mjs";
import { lookupSat, parseSatParam, satMetadata, satPageData, satPath } from "@/lib/sat/page-data.mjs";
import { decodeStateBlob } from "@/lib/pass-finder/state-blob.js";
import { sharePath } from "@/lib/share/share-link.mjs";
import { shareMetadata } from "@/lib/og/og-metadata.mjs";

export const revalidate = 3600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string; blob: string }> };

// Deduped per request. Throws (never a cached 404) while the catalog is down;
// the page then renders the busy view for a minute (lib/sat/busy.ts).
// A blob with no one to view from degrades to the plain satellite page.
const load = cache(async (param: string, blob: string) => {
  const found = await lookupSat(getCatalogReader(), param);
  if (found.kind === "redirect") permanentRedirect(sharePath(parseSatParam(param)!.id, blob));
  if (found.kind === "not-found") notFound();
  const shared = decodeStateBlob(blob);
  if (!shared || !shared.observers.length) permanentRedirect(satPath(found.id));
  return {
    data: satPageData(found.record, resolveSatellite(found.record.noradId), Date.now()),
    shared,
  };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, blob } = await params;
  try {
    const { data } = await load(id, blob);
    return shareMetadata(satMetadata(data), { noradId: data.noradId, blob }) as Metadata;
  } catch (err) {
    await asBusy(err, id);
    return BUSY_METADATA;
  }
}

export default async function Page({ params }: Props) {
  const { id, blob } = await params;
  let loaded;
  try {
    loaded = await load(id, blob);
  } catch (err) {
    await asBusy(err, id);
    return <SatBusy />;
  }
  const { data, shared } = loaded;
  return <SatApp key={data.noradId} data={data} shared={shared} />;
}
