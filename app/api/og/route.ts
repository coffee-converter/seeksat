// app/api/og/route.ts — dynamic per-pass OG image. The request→Response
// logic lives in lib/og/og-response.mjs (unit-tested); this file is just
// the Next adapter. Node runtime (jsdom + resvg need Node).
import { ogResponse } from "@/lib/og/og-response.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return ogResponse(req);
}
