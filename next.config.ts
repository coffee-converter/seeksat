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
