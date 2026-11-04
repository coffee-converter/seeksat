// app/api/refresh-tle/route.ts - Vercel Cron target. Fetches the CelesTrak
// OMM groups (plus any curated satellite no group holds) and rewrites the
// Blob catalog snapshot. Guarded by CRON_SECRET so only Vercel Cron (or an
// authorized caller) can run it, and only on the production deployment.
import { MIRROR_GROUPS, fetchGroup, fetchByCatnr } from '@/lib/mirror/celestrak.mjs';
import { CATALOG } from '@/lib/catalog.mjs';
import { refreshMirror, refreshResponse } from '@/lib/mirror/refresh.mjs';
import { createBlobSnapshotStore } from '@/lib/mirror/snapshot-store.mjs';

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
    now: Date.now,
  });
  const { status, body } = refreshResponse(result);
  return Response.json(body, { status });
}
