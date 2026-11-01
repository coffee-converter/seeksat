import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import SatApp from "@/components/sat/SatApp";
import { getCatalogReader } from "@/lib/mirror/server.mjs";
import { resolveSatellite } from "@/lib/catalog.mjs";
import { parseSatParam, satMetadata, satPageData, satPath } from "@/lib/sat/page-data.mjs";

export const revalidate = 3600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };

async function load(param: string) {
  const parsed = parseSatParam(param);
  if (!parsed) notFound();
  if (!parsed.canonical) permanentRedirect(satPath(parsed.id));
  const record = await getCatalogReader().getRecord(parsed.id);
  if (!record) notFound();
  return satPageData(record, resolveSatellite(parsed.id), Date.now());
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return satMetadata(await load(id));
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <SatApp data={await load(id)} />;
}
