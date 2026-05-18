import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cesium is loaded from the CDN via a <Script> in app/layout.tsx
  // (same approach as the legacy static pages) — keeps the bundle
  // out of Webpack/Turbopack and avoids the asset-copy ceremony.
  // Migrate to the npm package later if we need version pinning or
  // offline support.
  reactStrictMode: true,
};

export default nextConfig;
