// lib/og/og-metadata.mjs - metadata helpers for share pages. Kept as a plain
// module so it's unit-testable without importing the @/-aliased page.

import { sharePath } from "../share/share-link.mjs";

// Share-page metadata: the satellite page's base metadata with its preview
// images swapped for the per-pass render, and kept out of the index.
export function shareMetadata(baseMetadata, { noradId, blob, name = null }) {
  const url = `/api/og?s=${encodeURIComponent(blob)}&id=${noradId}`;
  const alt = `${name ? `A ${name}` : 'A satellite'} pass on a globe: its track, the part you can see, and the place it is seen from`;
  return {
    ...baseMetadata,
    openGraph: { ...baseMetadata.openGraph, url: sharePath(noradId, blob), images: [{ url, width: 1200, height: 630, alt }] },
    twitter: { ...baseMetadata.twitter, images: [{ url, alt }] },
    robots: { index: false, follow: true },
    alternates: { ...baseMetadata.alternates, canonical: `/sat/${noradId}` },
  };
}
