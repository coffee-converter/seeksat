// app/api/refresh-tle/route.ts - Vercel Cron target. Fetches the CelesTrak
// OMM groups (plus any curated satellite no group holds) and rewrites the
// Blob catalog snapshot. Guarded by CRON_SECRET so only Vercel Cron (or an
// authorized caller) can run it, and only on the production deployment.
import { MIRROR_GROUPS, fetchGroup, fetchByCatnr } from '@/lib/mirror/celestrak.mjs';
import { CATALOG } from '@/lib/catalog.mjs';
import { refreshMirror, refreshResponse } from '@/lib/mirror/refresh.mjs';
import { createBlobSnapshotStore } from '@/lib/mirror/snapshot-store.mjs';
import { downlinksFromTransmitters, fetchTransmitters } from '@/lib/mirror/satnogs.mjs';
import { siteUrl, submitToIndexNow } from '@/lib/seo/indexnow.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  // Only production refreshes. Previews and local builds share the same Blob
  // store, and every refresh counts against CelesTrak's limits for our IPs.
  if (process.env.VERCEL_ENV !== 'production') {
    return new Response('Refresh runs only in production', { status: 403 });
  }
  const result = await refreshMirror({
    store: createBlobSnapshotStore(),
    groups: MIRROR_GROUPS,
    fetchGroup,
    pinnedIds: CATALOG.map((s) => s.noradId),
    fetchByCatnr,
    // Once a day: radio downlinks from SatNOGS DB.
    fetchDownlinks: async () => downlinksFromTransmitters(await fetchTransmitters()),
    now: Date.now,
  });
  // Satellites new to the catalog have new pages, and ones gone from it have
  // pages that now 404: tell search engines about just those. A refusal is
  // logged and reported, and never fails the refresh.
  let indexNow: { submitted: number } | { error: string } | undefined;
  const diff = result as { addedIds?: number[]; removedIds?: number[] };
  const changed = result.written ? [...(diff.addedIds ?? []), ...(diff.removedIds ?? [])] : [];
  if (changed.length) {
    try {
      await submitToIndexNow(changed.map((id: number) => siteUrl(`/sat/${id}`)));
      indexNow = { submitted: changed.length };
    } catch (err) {
      indexNow = { error: (err as Error).message };
      console.warn(`refresh-tle: ${indexNow.error}`);
    }
  }
  const { status, body } = refreshResponse(result);
  return Response.json(indexNow ? { ...body, indexNow } : body, { status });
}
