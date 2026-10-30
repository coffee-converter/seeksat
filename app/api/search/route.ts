// app/api/search/route.ts - GET /api/search?q=molniya
import { searchHandler } from '@/lib/mirror/api.mjs';
import { getCatalogReader } from '@/lib/mirror/server.mjs';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const { status, body, headers } = await searchHandler(getCatalogReader(), searchParams);
  return Response.json(body, { status, headers });
}
