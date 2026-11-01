// lib/og/og-metadata.mjs - given a share-blob string `s`, build the Next
// Metadata fragment that points the social preview at the dynamic
// per-pass OG image. Returns {} when there's no blob (the page then
// inherits the static og.png from the root layout). Kept as a plain
// module so it's unit-testable without importing the @/-aliased page.
export function ogImageMetadata(s) {
  if (!s) return {};
  const url = `/api/og?s=${encodeURIComponent(s)}`;
  return {
    openGraph: { images: [{ url, width: 1200, height: 630 }] },
    twitter: { images: [url] },
  };
}

// Share-page metadata: the satellite page's base metadata with its preview
// images swapped for the per-pass render, and kept out of the index.
export function shareMetadata(baseMetadata, { noradId, blob }) {
  const url = `/api/og?s=${encodeURIComponent(blob)}&id=${noradId}`;
  return {
    ...baseMetadata,
    openGraph: { ...baseMetadata.openGraph, images: [{ url, width: 1200, height: 630 }] },
    twitter: { ...baseMetadata.twitter, images: [url] },
    robots: { index: false, follow: true },
    alternates: { ...baseMetadata.alternates, canonical: `/sat/${noradId}` },
  };
}
