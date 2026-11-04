// app/api/clouds/route.ts - GET /api/clouds?lat=41.9&lon=-87.6
import { cloudsHandler } from '@/lib/sky/clouds-handler.mjs';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const { status, body, headers } = await cloudsHandler(searchParams);
  return Response.json(body, { status, headers });
}
