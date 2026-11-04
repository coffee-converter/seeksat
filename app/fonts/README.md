# Atkinson Hyperlegible Next (web)

The site's text face, loaded by `next/font/local` in `app/layout.tsx`.

- `AtkinsonHyperlegibleNext-latin.woff2`: variable (wght 200-800), Google Fonts'
  latin range. Preloaded.
- `AtkinsonHyperlegibleNext-latin-ext.woff2`: the same font, latin-ext range.
  Fetched only when a page uses one of its characters.
- `OFL.txt`: the SIL Open Font License 1.1 the font is released under.

Source, pinned to the same google/fonts commit as the chart and share-card
exports (`scripts/build-atkinson-embed.py`):

- Font: https://github.com/google/fonts/raw/95f4904fc8bcf26d3420fe315560c96417c6dec7/ofl/atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext%5Bwght%5D.ttf
- Licence: https://github.com/google/fonts/raw/95f4904fc8bcf26d3420fe315560c96417c6dec7/ofl/atkinsonhyperlegiblenext/OFL.txt

Regenerate with `scripts/build-atkinson-web.py` (needs fonttools and brotli;
usage in the script's header). If you change its ranges, change the
`unicode-range` declarations in `app/layout.tsx` to match
(`test/fonts-local.test.mjs` checks).
