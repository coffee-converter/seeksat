import type { NextConfig } from "next";
import { buildCsp } from "./lib/site/csp.mjs";

// Vercel defaults static files in /public to `cache-control: public,
// max-age=0, must-revalidate`, which forces a conditional revalidate
// on every page load. That's right for HTML but very wrong for the
// ~10MB starfield JPGs and the other immutable assets we ship - they
// never change inside a deploy. The headers() block below explicitly
// tells the browser + Vercel's edge cache to hold them.
//
// Next's own /_next/static/* chunks already get cache-control:
// public, max-age=31536000, immutable from the framework (their
// filenames are content-hashed), so we don't touch that path.
// Content-Security-Policy is built in lib/site/csp.mjs (also unit-tested).
// It is enforcing. To debug a suspected breakage, temporarily rename the
// header key to "Content-Security-Policy-Report-Only" to log instead of block.
// If you add a new external fetch origin, extend CONNECT_ORIGINS there;
// test/csp.test.mjs scans the client code and fails on an unlisted origin.
//
//   connect-src      - 'self' plus the browser-side API: the Nominatim
//                      geocoder. (Open-Meteo / MET Norway are fetched
//                      server-side only, by the MCP route.)
//                      Vercel Analytics and Speed Insights post to the
//                      same-origin /_vercel/* paths, so they need nothing.
//   script-src       - 'unsafe-inline' for the Next.js hydration bootstrap
//                      script (drop once we move to nonces). 'unsafe-eval'
//                      is added in dev only; the dev server needs it.
//   worker-src blob: - the pass worker and bundler-created workers
//   style-src inline - the inlined Exo 2 @font-face <style>
//   data: (font/img) - the base64 Exo 2 font + canvas data URIs
const CSP = buildCsp({ dev: process.env.NODE_ENV !== "production" });

// Baseline security headers applied to every response. These are all
// non-breaking for this app:
//   HSTS               - force HTTPS for 2y incl. subdomains (Vercel is
//                        HTTPS-only anyway; this pins it in the browser).
//   nosniff            - stop MIME-sniffing our JSON/image responses.
//   frame DENY         - no clickjacking; belt-and-suspenders with the
//                        CSP frame-ancestors above (older scanners still
//                        look for the X-Frame-Options header specifically).
//   Referrer-Policy    - send only the origin to cross-origin destinations.
//   Permissions-Policy - deny powerful features we never use; geolocation
//                        stays self-enabled because AddObserverForm calls
//                        navigator.geolocation.getCurrentPosition to fill
//                        in the observer's location.
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The OG renderer (lib/og) is intentionally all-bundleable: linkedom
  // (DOM) + @resvg/resvg-wasm (rasterizer) are ESM/JS, and the wasm bytes
  // and fonts are base64-embedded modules - so nothing needs externalizing
  // or filesystem access at runtime. We dropped the native @resvg/resvg-js
  // (its linux binary silently dropped all text on Vercel) and jsdom (its
  // dep tree hit ERR_REQUIRE_ESM), which is why there's no serverExternal
  // list anymore.

  async headers() {
    return [
      {
        // Security headers on every response. Listed first; Next merges
        // all matching source blocks, so the asset Cache-Control rules
        // below still apply on top of these for their paths.
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
      {
        // NASA SVS starfield cubemap. Six JPGs, ~10MB total, identical
        // across deploys - safe to mark immutable with a 1-year TTL.
        source: "/assets/stars/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // Other /assets - observer-icon overlays, future OG image,
        // anything that might get tweaked between deploys but isn't
        // bandwidth-critical. 7-day cache so changes propagate within
        // a week without ever blocking initial load.
        source: "/assets/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // robots.txt + sitemap.xml - short cache so crawler updates
        // pick up quickly.
        source: "/(robots.txt|sitemap.xml)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
