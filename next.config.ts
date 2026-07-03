import type { NextConfig } from "next";

// Vercel defaults static files in /public to `cache-control: public,
// max-age=0, must-revalidate`, which forces a conditional revalidate
// on every page load. That's right for HTML but very wrong for the
// ~10MB starfield JPGs and the other immutable assets we ship — they
// never change inside a deploy. The headers() block below explicitly
// tells the browser + Vercel's edge cache to hold them.
//
// Next's own /_next/static/* chunks already get cache-control:
// public, max-age=31536000, immutable from the framework (their
// filenames are content-hashed), so we don't touch that path.
// Content-Security-Policy. Shipped in *Report-Only* mode first: the
// browser reports violations to the console without blocking anything,
// so we can watch the real Cesium globe + Vercel Analytics load and
// tighten the allowlist before enforcing. To ENFORCE, change the header
// key below from "Content-Security-Policy-Report-Only" to
// "Content-Security-Policy" (and re-verify the globe on a preview deploy).
//
// Origins are driven by what the app actually loads:
//   cesium.com                     — Cesium.js + widgets.css from the CDN
//   *.arcgisonline / carto / osm   — globe imagery tiles
//   nominatim / open-meteo / met.no / wheretheiss / open-elevation
//     / celestrak / ivanstanojevic / timeapi / ssd.jpl.nasa.gov
//                                  — client-side geocode/weather/TLE/ephemeris
//   'unsafe-eval'                  — Cesium evaluates strings as JS (shader
//                                    / expression compilation) and needs
//                                    real eval, not just wasm-unsafe-eval;
//                                    this also covers its WebAssembly. It
//                                    means script-src gives little XSS
//                                    protection, but the host allowlist,
//                                    object-src/base-uri/frame-ancestors
//                                    still do useful work.
//   blob: + cesium.com (worker)    — Cesium's CDN build spawns web workers
//                                    both from blob: URLs and directly from
//                                    the CDN origin
//   'unsafe-inline' (script)       — Next.js hydration bootstrap inlines a
//                                    <script>; drop it once we move to nonces
//   'unsafe-inline' (style)        — the inlined Exo 2 @font-face <style> +
//                                    Cesium widget styles
//   data: (font/img)               — the base64 Exo 2 font + canvas data URIs
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cesium.com",
  "worker-src 'self' blob: https://cesium.com",
  "style-src 'self' 'unsafe-inline' https://cesium.com",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://cesium.com https://server.arcgisonline.com https://cartodb-basemaps-a.global.ssl.fastly.net https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
  "connect-src 'self' https://cesium.com https://server.arcgisonline.com https://cartodb-basemaps-a.global.ssl.fastly.net https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://nominatim.openstreetmap.org https://api.open-meteo.com https://api.met.no https://api.wheretheiss.at https://api.open-elevation.com https://tle.ivanstanojevic.me https://celestrak.org https://timeapi.io https://ssd.jpl.nasa.gov",
  // NOTE: add "upgrade-insecure-requests" back here when flipping to
  // enforcing — it's spec-ignored (and warns) in a Report-Only policy.
].join("; ");

// Baseline security headers applied to every response. These are all
// non-breaking for this app:
//   HSTS               — force HTTPS for 2y incl. subdomains (Vercel is
//                        HTTPS-only anyway; this pins it in the browser).
//   nosniff            — stop MIME-sniffing our JSON/image responses.
//   frame DENY         — no clickjacking; belt-and-suspenders with the
//                        CSP frame-ancestors above (older scanners still
//                        look for the X-Frame-Options header specifically).
//   Referrer-Policy    — send only the origin to cross-origin destinations.
//   Permissions-Policy — deny powerful features we never use; geolocation
//                        stays self-enabled because AddObserverForm calls
//                        navigator.geolocation.getCurrentPosition to fill
//                        in the observer's location.
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Content-Security-Policy-Report-Only", value: CSP },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The OG renderer (lib/og) is intentionally all-bundleable: linkedom
  // (DOM) + @resvg/resvg-wasm (rasterizer) are ESM/JS, and the wasm bytes
  // and fonts are base64-embedded modules — so nothing needs externalizing
  // or filesystem access at runtime. We dropped the native @resvg/resvg-js
  // (its linux binary silently dropped all text on Vercel) and jsdom (its
  // dep tree hit ERR_REQUIRE_ESM), which is why there's no serverExternal
  // list anymore.
  // Cesium is loaded from the CDN via a <Script> in app/layout.tsx
  // (same approach as the legacy static pages) — keeps the bundle
  // out of Webpack/Turbopack and avoids the asset-copy ceremony.

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
        // across deploys — safe to mark immutable with a 1-year TTL.
        source: "/assets/stars/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // Other /assets — observer-icon overlays, future OG image,
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
        // robots.txt + sitemap.xml — short cache so crawler updates
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
