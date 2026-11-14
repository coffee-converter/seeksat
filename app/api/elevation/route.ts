// app/api/elevation/route.ts - GET /api/elevation?lat=41.9&lon=-87.6
import { canonicalElevationSearch, elevationHandler } from '@/lib/sky/elevation-handler.mjs';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { searchParams } = url;
  // One address per rounded place, so the CDN's cache (keyed on the full
  // address) serves every asker of that place: anything else is sent there.
  const canonical = canonicalElevationSearch(searchParams);
  if (canonical && canonical !== url.search) {
    return new Response(null, { status: 308, headers: { Location: `${url.pathname}${canonical}`, 'Cache-Control': 'public, s-maxage=86400' } });
  }
  const { status, body, headers } = await elevationHandler(searchParams);
  return Response.json(body, { status, headers });
}
