import type { MetadataRoute } from "next";

// App Router auto-serves /robots.txt from this file. Allow all
// crawlers; the home page is the only public route. The private
// triangulate tool no longer ships in the public bundle at all (the
// route file is deleted; the code stays in the repo for local use).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: "https://seeksat.com/sitemap.xml",
  };
}
