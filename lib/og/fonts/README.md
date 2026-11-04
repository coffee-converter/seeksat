# Bundled OG fonts

Rasterizing OG images on the server has no system fonts, so these are
loaded explicitly by `lib/og/rasterize.mjs`.

- **Atkinson Hyperlegible Next** (OFL, `OFL-Atkinson.txt`) Regular 400 and
  SemiBold 600, static instances of the upstream variable font, subset to
  Latin plus degree, middle dot, minus, dashes and quotes (~19 KB each).
  Same design as the app and the in-browser chart exports
  (`lib/pass-finder/atkinson-embed.js`).
  Regenerate: `fonttools varLib.instancer AtkinsonHyperlegibleNext[wght].ttf wght=400`
  (and 600), then `pyftsubset` with `--unicodes` for U+0020-007E, U+00A0,
  U+00B0, U+00B7, U+00D7, U+2212, U+2013-2014, U+2018-2019, U+201C-201D,
  U+2026, a few superscripts/accents, ≤ ≥ ≈ μ Δ, then `node scripts/build-fonts-embed.mjs`.
- **Exo 2** (OFL, `OFL.txt`) Regular/SemiBold, subset to the wordmark glyphs - the
  same faces embedded in `lib/pass-finder/exo2-embed.js`.
- Planet symbols fallback: see `lib/og/symbols-font-embed.mjs`.
