// app/llms.txt/route.ts - serves /llms.txt. A route handler (not a static
// public/ file) so it shares lib/mcp/discovery.mjs and can't drift.
import { SITE_URL } from '@/lib/site.mjs';
import { buildLlmsTxt } from '@/lib/mcp/llms-txt.mjs';

export const dynamic = 'force-static';

export function GET() {
  return new Response(buildLlmsTxt(SITE_URL), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
