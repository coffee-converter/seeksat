import type { MetadataRoute } from "next";

// App Router auto-serves /sitemap.xml from this file. One entry for
// the home page - the only public route the app ships.
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
