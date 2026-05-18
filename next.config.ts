import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cesium is loaded from the CDN via a <Script> in app/layout.tsx
  // (same approach as the legacy static pages) — keeps the bundle
  // out of Webpack/Turbopack and avoids the asset-copy ceremony.
  // Migrate to the npm package later if we need version pinning or
  // offline support.
  // Strict mode double-invokes effects in dev. The triangulate
  // bootstrap is fully imperative (attaches DOM listeners, mounts
  // a Cesium viewer) and isn't double-mount-safe yet — leave strict
  // mode off until the bootstrap is broken into idempotent pieces.
  reactStrictMode: false,
};

export default nextConfig;
