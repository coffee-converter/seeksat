// lib/og/og-metadata.mjs - metadata helpers for share pages. Kept as a plain
// module so it's unit-testable without importing the @/-aliased page.

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
