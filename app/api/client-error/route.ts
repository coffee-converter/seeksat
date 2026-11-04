// app/api/client-error/route.ts - POST /api/client-error. A browser error
// report (components/ErrorReporter.tsx), cleaned and written to the log.
import { cleanReport, MAX_BODY } from '@/lib/site/error-report.mjs';
import { SITE_URL } from '@/lib/site.mjs';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const text = await req.text().catch(() => '');
  if (!text || text.length > MAX_BODY) return new Response(null, { status: 400 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  // Reports name paths on this site; any origin works for reading them back.
  const report = cleanReport(body, new URL(SITE_URL).origin);
  if (!report) return new Response(null, { status: 400 });
  console.error('[client-error]', JSON.stringify(report));
  return new Response(null, { status: 204 });
}
