import type { MetadataRoute } from "next";

// App Router auto-serves /robots.txt from this file. Allow everything
// (default) except the private /triangulate route — Vercel preview
// deploys also pick this up so we don't accidentally have preview
// URLs indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: "/triangulate" },
    ],
    sitemap: "https://seeksat.com/sitemap.xml",
  };
}
