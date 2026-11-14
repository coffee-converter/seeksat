import { NextResponse, type NextRequest } from 'next/server';
import { legacyRedirect, satRedirect } from './lib/share/legacy-redirect.mjs';

// Old share links (/?s=..., /classic?s=...) land on the ISS page's shared view.
// `/` without `s` or `map` passes straight through, so it stays statically cached.
// Satellite URLs that are not canonical are redirected here too (satRedirect).
export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const target = pathname.startsWith('/sat/') ? satRedirect(pathname) : legacyRedirect(pathname, searchParams);
  if (target) return NextResponse.redirect(new URL(target, req.url), 308);
  // A shared map view (/?map=...): the same home page, rendered so its share
  // image shows that view. The address bar keeps the link.
  if (pathname === '/' && searchParams.has('map')) {
    const to = req.nextUrl.clone();
    to.pathname = '/shared-view';
    return NextResponse.rewrite(to);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/', '/classic', '/classic/:path*', '/sat/:path*'] };
