// app/api/elevation/route.ts - GET /api/elevation?lat=41.9&lon=-87.6
import { elevationHandler } from '@/lib/sky/elevation-handler.mjs';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const { status, body, headers } = await elevationHandler(searchParams);
  return Response.json(body, { status, headers });
}
