import type { MetadataRoute } from "next";

// App Router serves this as /manifest.webmanifest and links it from every
// page. Same-origin, so the CSP's default-src 'self' already covers it.
// Icons: the favicon (app/icon.svg), the touch icon (app/apple-icon.png) and
// two PNGs that scripts/build-icons.mjs rasterizes from the favicon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SeekSat",
    short_name: "SeekSat",
    description: "Track any satellite and find its passes from where you are.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0e1a",
    theme_color: "#0a0e1a",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
      { src: "/icon-192.png", type: "image/png", sizes: "192x192", purpose: "any" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512", purpose: "any" },
      { src: "/apple-icon.png", type: "image/png", sizes: "180x180", purpose: "any" },
    ],
  };
}
