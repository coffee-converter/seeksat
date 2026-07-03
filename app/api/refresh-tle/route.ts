// app/api/refresh-tle/route.ts - Vercel Cron target. Reads catalog,
// fetches each TLE, epoch-guard merges into Edge Config. Guarded by
// CRON_SECRET so only Vercel Cron (or an authorized caller) can run it.
import { CATALOG } from '@/lib/catalog.mjs';
import { fetchTleForId } from '@/lib/mcp/tle-fetch.mjs';
import { refreshCatalog } from '@/lib/mcp/refresh.mjs';
import { createEdgeConfigStore } from '@/lib/mcp/tle-store.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const result = await refreshCatalog({
    store: createEdgeConfigStore(),
    catalog: CATALOG,
    fetchTle: (id: string) => fetchTleForId(id),
    now: () => Date.now(),
  });
  return Response.json({ ok: true, ...result });
}
