#!/usr/bin/env python3
# scripts/build-atkinson-web.py - regenerate the site's Atkinson Hyperlegible
# Next web fonts in app/fonts/ (loaded by next/font/local in app/layout.tsx).
#
# Downloads the variable font and its OFL licence from the same PINNED
# google/fonts commit as scripts/build-atkinson-embed.py, then writes two
# variable (wght 200-800) woff2 subsets, split the way Google Fonts splits
# this family:
#   - app/fonts/AtkinsonHyperlegibleNext-latin.woff2      (preloaded)
#   - app/fonts/AtkinsonHyperlegibleNext-latin-ext.woff2  (fetched on demand)
#   - app/fonts/OFL.txt
# next/font needs literal options, so app/layout.tsx repeats RANGES in its
# unicode-range declarations; test/fonts-local.test.mjs holds the two equal.
#
# Usage (needs fonttools + brotli):
#   python3 -m venv .superpowers/venv
#   .superpowers/venv/bin/pip install fonttools brotli
#   .superpowers/venv/bin/python scripts/build-atkinson-web.py

import io
import os
import urllib.request

from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options

COMMIT = "95f4904fc8bcf26d3420fe315560c96417c6dec7"  # google/fonts
BASE = f"https://github.com/google/fonts/raw/{COMMIT}/ofl/atkinsonhyperlegiblenext/"
FONT_URL = BASE + "AtkinsonHyperlegibleNext%5Bwght%5D.ttf"
OFL_URL = BASE + "OFL.txt"

# Google Fonts' latin and latin-ext ranges for this family.
RANGES = {
    "latin": "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, "
             "U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    "latin-ext": "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, "
                 "U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, "
                 "U+2C60-2C7F, U+A720-A7FF",
}
OUT = os.path.join(os.path.dirname(__file__), "..", "app", "fonts")


def codepoints(spec: str):
    out = []
    for part in spec.split(","):
        part = part.strip()[2:]
        lo, _, hi = part.partition("-")
        out.extend(range(int(lo, 16), int(hi or lo, 16) + 1))
    return out


def subset(src: bytes, spec: str) -> bytes:
    f = TTFont(io.BytesIO(src))
    opts = Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]  # keep tnum (tabular figures), kern, liga, ...
    opts.name_IDs = ["*"]
    s = Subsetter(opts)
    s.populate(unicodes=codepoints(spec))
    s.subset(f)
    buf = io.BytesIO()
    f.flavor = "woff2"
    f.save(buf)
    return buf.getvalue()


def main():
    src = urllib.request.urlopen(FONT_URL).read()
    os.makedirs(OUT, exist_ok=True)
    for name, spec in RANGES.items():
        data = subset(src, spec)
        with open(os.path.join(OUT, f"AtkinsonHyperlegibleNext-{name}.woff2"), "wb") as fh:
            fh.write(data)
        print(f"{name}: {len(data)} bytes")
    with open(os.path.join(OUT, "OFL.txt"), "wb") as fh:
        fh.write(urllib.request.urlopen(OFL_URL).read())


if __name__ == "__main__":
    main()
