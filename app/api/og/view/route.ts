// app/api/og/view/route.ts - share image for a shared map view
// (/?map=...&sats=...). Logic in lib/og/view-og.mjs. Node runtime (resvg-wasm).
import { getCatalogReader } from "@/lib/mirror/server.mjs";
import { viewOgResponse } from "@/lib/og/view-og.mjs";

export const runtime = "nodejs";

export function GET(req: Request): Promise<Response> {
  return viewOgResponse(req.url, { reader: getCatalogReader(), nowMs: Date.now() });
}
