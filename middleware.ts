import { NextResponse, type NextRequest } from 'next/server';
import { legacyRedirect, satRedirect } from './lib/share/legacy-redirect.mjs';

// Old share links (/?s=..., /classic?s=...) land on the ISS page's shared view.
// `/` without `s` passes straight through, so it stays statically cached.
// Satellite URLs that are not canonical are redirected here too (satRedirect).
export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const target = pathname.startsWith('/sat/') ? satRedirect(pathname) : legacyRedirect(pathname, searchParams);
  if (!target) return NextResponse.next();
  return NextResponse.redirect(new URL(target, req.url), 308);
}

export const config = { matcher: ['/', '/classic', '/classic/:path*', '/sat/:path*'] };
