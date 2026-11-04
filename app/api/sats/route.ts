// app/api/sats/route.ts - GET /api/sats?ids=25544,25485
import { satsHandler } from '@/lib/mirror/api.mjs';
import { getCatalogReader } from '@/lib/mirror/server.mjs';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const { status, body, headers } = await satsHandler(getCatalogReader(), searchParams, Date.now());
  return Response.json(body, { status, headers });
}
