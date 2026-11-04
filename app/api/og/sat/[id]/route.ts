// app/api/og/sat/[id]/route.ts - link-preview image for /sat/<id>. Logic in
// lib/og/sat-og.mjs (unit-tested). Node runtime (resvg-wasm).
import { getCatalogReader } from "@/lib/mirror/server.mjs";
import { satOgResponse } from "@/lib/og/sat-og.mjs";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return satOgResponse(id, { reader: getCatalogReader(), nowMs: Date.now() });
}
