// app/api/refresh-tle/route.ts - Vercel Cron target. Fetches the CelesTrak
// OMM groups and rewrites the Blob catalog snapshot. Guarded by CRON_SECRET
// so only Vercel Cron (or an authorized caller) can run it.
import { MIRROR_GROUPS, fetchGroup } from '@/lib/mirror/celestrak.mjs';
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
  const result = await refreshMirror({
    store: createBlobSnapshotStore(),
    groups: MIRROR_GROUPS,
    fetchGroup,
    now: Date.now,
  });
  const { status, body } = refreshResponse(result);
  return Response.json(body, { status });
}
