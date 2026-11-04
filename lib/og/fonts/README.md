# Bundled OG fonts

Rasterizing OG images on the server has no system fonts, so these are
loaded explicitly by `lib/og/rasterize.mjs`.

- **Atkinson Hyperlegible Next** (OFL, `OFL-Atkinson.txt`) Regular 400 and
  SemiBold 600, static instances of the upstream variable font, subset to
  Latin plus degree, middle dot, minus, dashes and quotes (~20 KB each).
  Same design as the app and the in-browser chart exports
  (`lib/pass-finder/atkinson-embed.js`).
  Regenerate: `scripts/build-atkinson-embed.py` (pinned google/fonts commit, exact
  glyph list, venv recipe in its docstring), then `node scripts/build-fonts-embed.mjs`.
- **Exo 2** (OFL, `OFL.txt`) Regular/SemiBold, subset to the wordmark glyphs - the
  same faces embedded in `lib/pass-finder/exo2-embed.js`.
- Planet symbols fallback: see `lib/og/symbols-font-embed.mjs`.
