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
