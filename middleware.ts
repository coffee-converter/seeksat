import { NextResponse, type NextRequest } from 'next/server';
import { legacyRedirect } from './lib/share/legacy-redirect.mjs';

// Old share links (/?s=..., /classic?s=...) land on the ISS page's shared view.
// `/` without `s` passes straight through, so it stays statically cached.
export function middleware(req: NextRequest) {
  const target = legacyRedirect(req.nextUrl.pathname, req.nextUrl.searchParams);
  if (!target) return NextResponse.next();
  return NextResponse.redirect(new URL(target, req.url), 308);
}

export const config = { matcher: ['/', '/classic', '/classic/:path*'] };
