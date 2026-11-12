import type { MetadataRoute } from "next";

// App Router auto-serves /robots.txt from this file. Allow all
// crawlers: the home page and the satellite pages under /sat/. The private
// triangulate tool no longer ships in the public bundle at all (the
// route file is deleted; the code stays in the repo for local use).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      // SEO-index crawlers: they walk every satellite page (14,000 a day) and
      // bring no visitors. Both honour robots.txt.
      { userAgent: ["AhrefsBot", "SERankingBacklinksBot"], disallow: "/" },
    ],
    sitemap: "https://seeksat.com/sitemap.xml",
  };
}
