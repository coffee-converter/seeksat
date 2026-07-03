# Bundled OG fonts

Rasterizing OG images on the server has no system fonts, so these are
loaded explicitly by `lib/og/rasterize.mjs`.

- **Arimo** (Apache-2.0) - chart labels + tagline. Metric-compatible with
  Arial/Helvetica, matching the app's `-apple-system` fallback look.
  Regenerate: re-subset from the upstream Arimo release to the glyphs the OG card uses.
- **Exo 2** (OFL) Regular/SemiBold, subset to the wordmark glyphs - the
  same faces embedded in `lib/pass-finder/exo2-embed.js`.
