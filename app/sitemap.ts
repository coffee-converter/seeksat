import type { MetadataRoute } from "next";
import { getCatalogReader } from "@/lib/mirror/server.mjs";
import { SITE_URL } from "@/lib/site.mjs";

// App Router auto-serves /sitemap.xml from this file: the home page plus one
// entry per satellite in the catalog snapshot (never the on-demand path).
export const revalidate = 3600;

const READ_TIMEOUT_MS = 5000;

async function loadIds(): Promise<{ ids: number[]; generatedAtMs: number | null }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS);
  });
  const read = (async () => {
    const reader = getCatalogReader();
    const ids: number[] = await reader.noradIds();
    return { ids, generatedAtMs: reader.generatedAtMs() as number | null };
  })();
  read.catch(() => {}); // a late rejection after the timeout won is not unhandled
  try {
    return (await Promise.race([read, timeout])) ?? { ids: [], generatedAtMs: null };
  } catch {
    return { ids: [], generatedAtMs: null };
  } finally {
    clearTimeout(timer);
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { ids, generatedAtMs } = await loadIds();
  const lastModified = new Date(generatedAtMs ?? Date.now());
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    ...ids.map((id) => ({
      url: `${SITE_URL}/sat/${id}`,
      lastModified,
      changeFrequency: "daily" as const,
      priority: 0.5,
    })),
  ];
}
