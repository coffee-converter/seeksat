import type { MetadataRoute } from "next";

// App Router auto-serves /sitemap.xml from this file. One entry for
// the home page; /triangulate is intentionally absent (it's a
// private tool, kept out of search-engine indexes by robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://seeksat.com/",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
