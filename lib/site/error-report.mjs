// lib/site/error-report.mjs - what a browser error report carries, made the
// same way on both ends: the page builds it, the server cleans it again
// before it goes to the log (app/api/client-error/route.ts).
//
// Never anything personal: the page's path without its query or hash (a
// shared view's query can name a frequency, never a location, but the path is
// all a bug needs), the error's message and stack trimmed, and the browser.

export const REPORT_PATH = '/api/client-error';
/** Reports one page load may send. */
export const MAX_REPORTS = 5;
/** Largest body the server reads, in bytes. */
export const MAX_BODY = 8192;

const cut = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
const num = (v) => (Number.isFinite(v) ? Math.trunc(v) : null);

// Noise every site sees, which nobody here can fix: browser extensions,
// cross-origin scripts the browser hides ("Script error."), and Chrome's
// benign ResizeObserver warning.
const NOISE = [/^Script error\.?$/i, /ResizeObserver loop/i, /extension:\/\//i];

/** Only this site's paths: anything else (an extension's URL) becomes null. */
function pathOf(url, origin) {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url, origin);
    return u.origin === origin ? u.pathname : null;
  } catch {
    return null;
  }
}

/**
 * The report for one error, or null when it is noise.
 * @param {{ message?: string, source?: string, line?: number, col?: number,
 *   stack?: string, kind?: string }} e
 * @param {{ origin: string, page: string, userAgent?: string }} where
 */
export function errorReport(e, { origin, page, userAgent = '' }) {
  const message = cut(String(e?.message ?? ''), 300) || 'Unknown error';
  const stack = cut(e?.stack, 2000);
  if (NOISE.some((re) => re.test(message) || (stack && re.test(stack)) || re.test(e?.source ?? ''))) return null;
  return {
    kind: e?.kind === 'rejection' ? 'rejection' : 'error',
    message,
    source: pathOf(e?.source, origin),
    line: num(e?.line),
    col: num(e?.col),
    stack: stack ? stack.split('\n').slice(0, 12).join('\n') : null,
    page: pathOf(page, origin) ?? '/',
    ua: cut(userAgent, 200),
  };
}

/** The server's pass over a posted body: the same fields, trimmed again, or
 *  null when it is not a report. */
export function cleanReport(body, origin) {
  if (!body || typeof body !== 'object' || typeof body.message !== 'string') return null;
  return errorReport(
    { kind: body.kind, message: body.message, source: body.source, line: body.line, col: body.col, stack: body.stack },
    { origin, page: typeof body.page === 'string' ? body.page : '/', userAgent: typeof body.ua === 'string' ? body.ua : '' },
  );
}
