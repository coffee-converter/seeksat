#!/usr/bin/env python3
# scripts/build-exo2-embed.py - regenerate lib/pass-finder/exo2-embed.js.
#
# Downloads the Exo 2 variable font (Google Fonts, OFL), instances it to
# the two weights the SeekSat wordmark/URL watermark uses, subsets to
# just the glyphs in TEXT, converts to woff2, and emits the base64
# @font-face module that polar-modal-frame.js inlines into the chart SVG.
#
# Why embed instead of a <link>: the polar modal exports to PNG by
# serializing the SVG into a standalone <img> and rasterizing it - a path
# that can't fetch external fonts. Only data: URIs inside the SVG's own
# <style> survive. See lib/pass-finder/polar-png.js.
#
# Usage (needs fonttools + brotli):
#   python3 -m venv /tmp/fontvenv
#   /tmp/fontvenv/bin/pip install fonttools brotli
#   /tmp/fontvenv/bin/python scripts/build-exo2-embed.py
#
# Bump TEXT or WEIGHTS here and re-run if the watermark copy changes.

import base64
import io
import os
import urllib.request

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.subset import Subsetter, Options

EXO2_URL = "https://github.com/google/fonts/raw/main/ofl/exo2/Exo2%5Bwght%5D.ttf"
TEXT = "SeekSat seeksat.com"   # subset glyphs: S s e k a t . c o m (+ space)
WEIGHTS = [400, 600]
OUT = os.path.join(os.path.dirname(__file__), "..", "lib", "pass-finder", "exo2-embed.js")


def subset_woff2_b64(src_ttf: bytes, weight: int) -> str:
    f = TTFont(io.BytesIO(src_ttf))
    instantiateVariableFont(f, {"wght": weight}, inplace=True)
    opts = Options()
    opts.flavor = "woff2"
    opts.desubroutinize = True
    opts.name_IDs = []
    opts.notdef_outline = True
    ss = Subsetter(options=opts)
    ss.populate(text=TEXT)
    ss.subset(f)
    buf = io.BytesIO()
    f.save(buf)
    return base64.b64encode(buf.getvalue()).decode()


def main() -> None:
    print(f"Fetching {EXO2_URL}")
    src = urllib.request.urlopen(EXO2_URL).read()
    faces = []
    for w in WEIGHTS:
        b64 = subset_woff2_b64(src, w)
        print(f"  weight {w}: {len(b64)} base64 chars")
        faces.append(
            "  @font-face {\n"
            "    font-family: 'Exo 2';\n"
            "    font-style: normal;\n"
            f"    font-weight: {w};\n"
            "    font-display: block;\n"
            f"    src: url(data:font/woff2;base64,{b64}) format('woff2');\n"
            "  }"
        )
    body = "\n".join(faces)
    js = (
        "// lib/pass-finder/exo2-embed.js - Exo 2 (Google Fonts, OFL) subset\n"
        "// to just the glyphs used by the SeekSat wordmark + URL watermark,\n"
        "// instanced to two weights and embedded as base64 woff2 @font-face\n"
        "// rules. Embedding (rather than a Google Fonts <link>) is REQUIRED so\n"
        "// the font survives PNG export: the modal SVG is serialized into a\n"
        "// standalone <img> and rasterized to canvas, a path that can't fetch\n"
        "// external font resources - only data: URIs inside the SVG's own\n"
        "// <style> apply. The same rules also drive the on-screen modal, so a\n"
        "// single embed covers both. Regenerate via scripts/build-exo2-embed.py\n"
        "// if the wordmark text or weights change.\n"
        "//\n"
        "// Subset glyphs: S s e k a t . c o m (+ space). Family: \"Exo 2\".\n"
        "export const EXO2_FONT_FACE = `\n"
        f"{body}\n"
        "`;\n"
    )
    out = os.path.abspath(OUT)
    with open(out, "w") as fh:
        fh.write(js)
    print(f"Wrote {out} ({len(js)} bytes)")


if __name__ == "__main__":
    main()
