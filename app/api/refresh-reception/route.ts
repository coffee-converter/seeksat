// app/api/refresh-reception/route.ts - Vercel Cron target. Sweeps SatNOGS
// Network observations (good and bad, a UTC day at a time) into the rolling
// 30-day reception tally in Blob (lib/reception/). Guarded like the catalog
// refresh: CRON_SECRET, production only.
import { collectReception } from '@/lib/reception/collect.mjs';
import { createBlobReceptionStore } from '@/lib/reception/store.mjs';
import { sweepObservations } from '@/lib/reception/satnogs-network.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  // Only production collects: previews share the Blob store, and every run
  // is load on SatNOGS's volunteer-run servers.
  if (process.env.VERCEL_ENV !== 'production') {
    return new Response('Reception collection runs only in production', { status: 403 });
  }
  try {
    const result = await collectReception({ store: createBlobReceptionStore(), sweep: sweepObservations });
    if (result.failed) console.warn(`refresh-reception: ${result.failed}`);
    return Response.json(result, { status: result.failed && !result.units ? 500 : 200 });
  } catch (err) {
    console.error(`refresh-reception: ${(err as Error).message}`);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
