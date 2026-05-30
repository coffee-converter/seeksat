#!/usr/bin/env python3
"""Render the 1200×630 Open Graph card to public/og.png.

The card pairs the SeekSat brand with a REAL polar sky chart of an actual
upcoming ISS pass. Two halves, two sources of truth:

  • The chart (right) is drawn by the app's OWN renderer. scripts/
    render-real-chart.mjs runs the exact modal painter pipeline
    (lib/pass-finder-scene.js → renderPolarModalInto) under jsdom against
    a live ISS TLE, so the disc, grid, real star field, constellation
    lines, the magnitude-graded pass arc, Sun/Moon/planets, the event
    times and the metadata header are all identical to what a user sees
    in the fullscreen modal — not a re-implementation. We nest that SVG
    verbatim into the card.

  • The wordmark (left) is real Exo 2. rsvg-convert (2.62) ignores
    @font-face data-URIs, so "SeekSat"/"seeksat.com" are converted to SVG
    outline *paths* from the exact subset woff2 the app ships
    (lib/pass-finder/exo2-embed.js) — baked vectors, no font fallback.

Pipeline: render real chart (node) → compose card SVG → rsvg-convert.

Usage (needs the fonttools venv from build-exo2-embed.py):
  /tmp/fontvenv/bin/python scripts/build-og-image.py

  env OG_CHART_SVG=/path   reuse a cached chart (skip the live recompute)
  env OBS_NAME/OBS_LAT/OBS_LON/OBS_TZ   passed to the chart renderer
"""
import base64
import io
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EMBED_JS = ROOT / "lib" / "pass-finder" / "exo2-embed.js"
CHART_SCRIPT = ROOT / "scripts" / "render-real-chart.mjs"
OUT_PNG = ROOT / "public" / "og.png"

W, H = 1200, 630

# Brand palette (seeksat-branding-direction memory / globals.css)
SEEK = "#8aa0c8"
SAT = "#7eb8ff"
URL_GRAY = "#6a7a9a"
TAGLINE = "#aab8d4"
SUBTLE = "#62748f"

# Centered composition: the circular sky chart is the hero, the wordmark
# sits beneath it. Centering keeps the key content inside the middle
# square (x≈285–915) so surfaces that crop the 1.91:1 card to a square
# (iMessage/WhatsApp-style previews) still show the circle + wordmark.
# The chart's cropped viewBox is square (216×216 — just the disc).
CHART_VB_W = CHART_VB_H = 216
CHART_SIDE = 478
CHART_X = (W - CHART_SIDE) // 2          # centered horizontally
CHART_Y = 12                              # hero up top; wordmark below


# ----- Exo 2 glyphs → SVG outline paths (exact, renderer-independent) ---
def _load_faces():
    from fontTools.ttLib import TTFont
    blobs = re.findall(r"data:font/woff2;base64,([A-Za-z0-9+/=]+)", EMBED_JS.read_text())
    if len(blobs) < 2:
        sys.exit("Expected 2 woff2 faces in exo2-embed.js — format changed?")
    return {
        "regular": TTFont(io.BytesIO(base64.b64decode(blobs[0]))),
        "semibold": TTFont(io.BytesIO(base64.b64decode(blobs[1]))),
    }


def text_to_path(face, text, font_px, x, y):
    """Lay out `text` as a single SVG path `d` with baseline at (x, y).
    Returns (d, advance_px). Font units scaled by font_px/upm, Y flipped."""
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen

    upm = face["head"].unitsPerEm
    scale = font_px / upm
    cmap = face.getBestCmap()
    glyph_set = face.getGlyphSet()
    hmtx = face["hmtx"]
    pen = SVGPathPen(glyph_set)
    cursor = 0.0
    for ch in text:
        gname = cmap.get(ord(ch))
        if gname is None:
            adv = hmtx[cmap[0x20]][0] if cmap.get(0x20) else upm * 0.25
            cursor += adv * scale
            continue
        glyph_set[gname].draw(TransformPen(pen, (scale, 0, 0, -scale, x + cursor, y)))
        cursor += hmtx[gname][0] * scale
    return pen.getCommands(), cursor


# ----- Real chart (the app's own renderer, via jsdom) ------------------
def get_chart():
    """Return (chart_svg_str, meta_dict)."""
    cached = os.environ.get("OG_CHART_SVG")
    raw = (Path(cached).read_text() if cached else
           subprocess.run(["node", str(CHART_SCRIPT)], check=True,
                          capture_output=True, text=True).stdout)
    m = re.match(r"<!--META (.*?) META-->", raw, re.S)
    meta = json.loads(m.group(1)) if m else {}
    svg = raw[m.end():].strip() if m else raw.strip()
    # Nest verbatim: give the chart's root <svg> a placement box. Its own
    # viewBox is preserved, so the painters' coordinates map unchanged.
    svg = re.sub(
        r"^<svg\b",
        f'<svg x="{CHART_X}" y="{CHART_Y}" width="{CHART_SIDE}" height="{CHART_SIDE}" '
        f'preserveAspectRatio="xMidYMid meet"',
        svg, count=1,
    )
    return svg, meta


def _centered_paths(face, runs, font_px, cx, baseline):
    """Lay out `runs` (list of (text, fill)) as one horizontal line of
    Exo 2 outline paths, centered on x=cx at `baseline`. Returns the SVG
    <path> markup. Two-pass: measure total advance, then place from the
    centered start x."""
    widths = [text_to_path(face, t, font_px, 0, 0)[1] for t, _ in runs]
    x = cx - sum(widths) / 2
    out = []
    for (text, fill), w in zip(runs, widths):
        d, _ = text_to_path(face, text, font_px, x, baseline)
        out.append(f'<path d="{d}" fill="{fill}"/>')
        x += w
    return "\n  ".join(out)


def build_svg(chart_svg, faces):
    cx = W / 2
    sans = "-apple-system,Helvetica,Arial,sans-serif"
    # Wordmark + URL as exact Exo 2 outlines, centered beneath the disc.
    wordmark = _centered_paths(
        faces["semibold"], [("Seek", SEEK), ("Sat", SAT)], 62, cx, 548)
    url = _centered_paths(
        faces["regular"], [("seeksat.com", URL_GRAY)], 18, cx, 612)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <defs>
    <radialGradient id="vign" cx="50%" cy="40%" r="75%">
      <stop offset="0%" stop-color="#0e1428"/>
      <stop offset="100%" stop-color="#070a14"/>
    </radialGradient>
  </defs>
  <rect width="{W}" height="{H}" fill="url(#vign)"/>
  {chart_svg}
  <!-- Wordmark (exact Exo 2 outlines) -->
  {wordmark}
  <!-- Tagline (system sans), centered -->
  <text x="{cx}" y="582" text-anchor="middle" font-family="{sans}" font-size="22" letter-spacing="0.4" fill="{TAGLINE}">Satellite pass forecasts · visual &amp; radio · multi-station</text>
  <!-- URL (exact Exo 2 outlines) -->
  {url}
</svg>
"""


def main():
    try:
        import fontTools  # noqa: F401
    except ImportError:
        sys.exit("Needs fonttools — run with /tmp/fontvenv/bin/python "
                 "(see build-exo2-embed.py header).")

    chart_svg, meta = get_chart()
    faces = _load_faces()
    svg = build_svg(chart_svg, faces)

    with tempfile.TemporaryDirectory() as td:
        svg_path = Path(td) / "og.svg"
        svg_path.write_text(svg)
        OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["rsvg-convert", "-w", str(W), "-h", str(H),
                        str(svg_path), "-o", str(OUT_PNG)], check=True)

    obs = meta.get("observer", {})
    note = (f" — {obs.get('name','?')}, {round(meta.get('maxAlt',0))}° max, "
            f"{'visible' if meta.get('visible') else 'daytime'}") if meta else ""
    print(f"Wrote {OUT_PNG.relative_to(ROOT)} ({W}×{H}, "
          f"{OUT_PNG.stat().st_size/1024:.1f} KB){note}")


if __name__ == "__main__":
    main()
