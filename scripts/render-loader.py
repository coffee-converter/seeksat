#!/usr/bin/env python3
"""Pre-render the cartoony-earth loader to assets/loader.gif.

Generates static SVG frames with positions baked in, renders each via
rsvg-convert, then combines into an animated GIF with Pillow. Replaces
the SMIL animateMotion + CSS keyframes used in passes.html so the
loader doesn't get starved by main-thread work during Cesium boot.

Ratio: ISS 1.5s per orbit, Earth 24s per rotation = 16:1, within 3% of
the physical ~15.5:1 (92.5 min vs sidereal 23h 56m). One Earth rotation
= one ISS orbit cycle = one GIF loop.
"""
import math
import shutil
import subprocess
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
TMP = Path("/tmp/loader-frames")

ISS_PERIOD = 1.5     # seconds per orbit
EARTH_PERIOD = 24.0  # seconds per rotation = 16 ISS orbits
LOOP_PERIOD = EARTH_PERIOD
FPS = 10
N_FRAMES = int(LOOP_PERIOD * FPS)
PALETTE_COLORS = 32

# SVG geometry - matches passes.html.
VIEW_X, VIEW_Y, VIEW_W, VIEW_H = 32, 32, 156, 156
CX, CY = 110, 110
EARTH_R = 46
INCLINATION_DEG = 51.6
ORBIT_RX = 56
ORBIT_RY = 14
BAND_WIDTH = 92  # one earth diameter

BG_RGBA = (10, 14, 26, 255)  # #0a0e1a - page loader background
OCEAN_FILL = "#2b78c9"
CONTINENT_FILL = "#4fc070"
OUTLINE_STROKE = "#0c2c5a"
OUTLINE_WIDTH = 3.2
ORBIT_STROKE = "#cfe4ff"
ORBIT_STROKE_OPACITY = 0.9
ORBIT_WIDTH = 3
ORBIT_DASH = "3 6"
ISS_FILL = "#ffffff"

# Continents arranged like a Mercator strip across one Earth-diameter
# band [64..156]; the +92 duplicate makes the pan loop seamlessly.
# Silhouettes hand-traced from a low-res world map at 92px/360° (≈0.26
# px/°), so each shape sits at its real longitude and the relative
# sizes roughly match. Pacific gap wraps across the band seam. Polar
# regions are out-of-band (Antarctica below the disc, Arctic above).
CONTINENT_PATHS = """
  <!-- North America: wide Canadian top, Hudson Bay notch, Florida hook,
       narrows through Mexico to Yucatan -->
  <path d="M 65,76 L 68,72 L 74,70 L 79,71 L 78,73 L 82,72 L 86,70 L 90,72 L 92,76 L 91,80 L 92,85 L 90,88 L 92,92 L 92,96 L 88,98 L 84,96 L 86,100 L 89,104 L 84,102 L 80,96 L 76,92 L 73,86 L 70,82 L 66,80 Z" />
  <!-- Greenland (sits above the disc rim, only its southern tip
       typically pokes into the visible window) -->
  <path d="M 88,66 L 94,66 L 98,69 L 96,73 L 92,74 L 89,71 Z" />
  <!-- South America: Brazil bulge upper-right, taper to Cape Horn -->
  <path d="M 91,108 L 96,105 L 103,108 L 105,116 L 103,124 L 99,132 L 95,139 L 91,144 L 87,138 L 86,131 L 87,123 L 89,116 Z" />
  <!-- Europe + Scandinavia (small jagged top, peninsulas south) -->
  <path d="M 105,72 L 110,69 L 116,71 L 120,73 L 122,77 L 117,80 L 113,82 L 109,81 L 106,78 Z" />
  <!-- Africa: wide Sahara top, Horn of Africa east bump, narrows south -->
  <path d="M 107,84 L 112,82 L 118,82 L 124,84 L 127,87 L 125,91 L 128,93 L 125,97 L 123,103 L 121,110 L 117,116 L 113,118 L 110,114 L 108,108 L 107,100 L 106,92 Z" />
  <!-- Arabia (triangular peninsula off NE Africa) -->
  <path d="M 124,85 L 129,84 L 132,88 L 131,91 L 127,92 L 124,89 Z" />
  <!-- Madagascar -->
  <path d="M 127,108 L 129,108 L 130,113 L 128,117 L 126,114 Z" />
  <!-- Asian landmass: Siberia/Russia top, China east, Korea/Japan
       suggestion. Drawn separately from India and SE Asia for the
       characteristic peninsulas-hanging-down silhouette. -->
  <path d="M 120,72 L 126,68 L 134,67 L 142,68 L 148,69 L 152,72 L 154,77 L 151,80 L 145,80 L 140,82 L 145,82 L 148,84 L 144,86 L 138,86 L 132,86 L 128,84 L 124,82 L 121,79 Z" />
  <!-- Japan (small island group off East Asia) -->
  <path d="M 152,80 L 154,82 L 153,86 L 151,86 Z" />
  <!-- India: clear triangular peninsula hanging south from Asia -->
  <path d="M 130,86 L 134,87 L 138,90 L 135,98 L 132,102 L 129,99 L 127,94 L 128,89 Z" />
  <!-- SE Asia / Indochina + Indonesia archipelago -->
  <path d="M 138,90 L 142,93 L 141,98 L 138,99 L 136,95 Z" />
  <path d="M 139,102 L 146,101 L 150,105 L 147,108 L 141,107 Z" />
  <circle cx="152" cy="108" r="1.6" />
  <circle cx="155" cy="105" r="1.2" />
  <!-- Australia: kidney-ish, slight Cape York bump on north, Great
       Australian Bight slight indent on south -->
  <path d="M 139,118 L 144,116 L 148,117 L 150,115 L 153,118 L 156,121 L 155,125 L 150,128 L 144,128 L 140,125 L 138,122 Z" />
  <!-- Tasmania (south of Australia, often near disc edge) -->
  <circle cx="149" cy="132" r="1.6" />
  <!-- New Guinea (just NE of Australia) -->
  <path d="M 142,113 L 148,113 L 151,115 L 148,116 L 143,115 Z" />
"""


def iss_position(t_frac):
    """ISS (x, y) at the given fraction-of-orbit in [0, 1). t=0 is the
    lower-left line-of-nodes point (emerging from behind earth)."""
    theta = math.pi + 2 * math.pi * t_frac  # CW from leftmost
    cx = ORBIT_RX * math.cos(theta)
    cy = -ORBIT_RY * math.sin(theta)
    a = math.radians(-INCLINATION_DEG)
    cos_a, sin_a = math.cos(a), math.sin(a)
    rx = cos_a * cx - sin_a * cy
    ry = sin_a * cx + cos_a * cy
    return (CX + rx, CY + ry)


def build_svg(frame_t):
    pan_x = -BAND_WIDTH * ((frame_t % EARTH_PERIOD) / EARTH_PERIOD)
    iss_frac = (frame_t % ISS_PERIOD) / ISS_PERIOD
    iss_x, iss_y = iss_position(iss_frac)
    near = iss_frac < 0.5  # first half = lower-right visible arc

    iss_dot = (
        f'<circle cx="{iss_x:.3f}" cy="{iss_y:.3f}" r="4.5" '
        f'fill="{ISS_FILL}" filter="url(#iss-glow)" />'
    )
    far_iss = "" if near else iss_dot
    near_iss = iss_dot if near else ""

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VIEW_X} {VIEW_Y} {VIEW_W} {VIEW_H}" width="{VIEW_W}" height="{VIEW_H}">
  <defs>
    <clipPath id="earth-clip"><circle cx="{CX}" cy="{CY}" r="{EARTH_R}" /></clipPath>
    <filter id="iss-glow" x="-200%" y="-200%" width="500%" height="500%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" result="b1" />
      <feGaussianBlur in="SourceGraphic" stdDeviation="5"   result="b2" />
      <feMerge>
        <feMergeNode in="b2" />
        <feMergeNode in="b1" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>
  <!-- BEHIND-EARTH arc: the upper-left visible half (top of axis-
       aligned ellipse after the -51.6° rotation). This matches the
       half of the orbit where the far-side ISS instance also travels,
       so the dashed line and the dot stay on the same arc. -->
  <g transform="rotate(-{INCLINATION_DEG} {CX} {CY})">
    <path d="M 54,110 A {ORBIT_RX},{ORBIT_RY} 0 0 1 166,110"
          fill="none" stroke="{ORBIT_STROKE}" stroke-opacity="{ORBIT_STROKE_OPACITY}"
          stroke-width="{ORBIT_WIDTH}" stroke-dasharray="{ORBIT_DASH}" stroke-linecap="round" />
  </g>
  {far_iss}
  <circle cx="{CX}" cy="{CY}" r="{EARTH_R}" fill="{OCEAN_FILL}" />
  <g clip-path="url(#earth-clip)">
    <g transform="translate({pan_x:.3f}, 0)">
      <g fill="{CONTINENT_FILL}">{CONTINENT_PATHS}</g>
      <g fill="{CONTINENT_FILL}" transform="translate({BAND_WIDTH}, 0)">{CONTINENT_PATHS}</g>
    </g>
  </g>
  <circle cx="{CX}" cy="{CY}" r="{EARTH_R}" fill="none"
          stroke="{OUTLINE_STROKE}" stroke-width="{OUTLINE_WIDTH}" />
  <!-- IN-FRONT arc: the lower-right visible half (bottom of axis-
       aligned ellipse after rotation). Drawn over the earth so the
       dashed line crosses the disc, matching the front-side ISS path. -->
  <g transform="rotate(-{INCLINATION_DEG} {CX} {CY})">
    <path d="M 166,110 A {ORBIT_RX},{ORBIT_RY} 0 0 1 54,110"
          fill="none" stroke="{ORBIT_STROKE}" stroke-opacity="{ORBIT_STROKE_OPACITY}"
          stroke-width="{ORBIT_WIDTH}" stroke-dasharray="{ORBIT_DASH}" stroke-linecap="round" />
  </g>
  {near_iss}
</svg>
"""


def main():
    if TMP.exists():
        shutil.rmtree(TMP)
    TMP.mkdir(parents=True)
    ASSETS.mkdir(parents=True, exist_ok=True)

    print(f"Rendering {N_FRAMES} frames over {LOOP_PERIOD}s loop ({FPS} fps)…")
    pngs = []
    for i in range(N_FRAMES):
        t = i / FPS
        svg_path = TMP / f"f{i:04d}.svg"
        png_path = TMP / f"f{i:04d}.png"
        svg_path.write_text(build_svg(t))
        subprocess.run(
            ["rsvg-convert", str(svg_path), "-o", str(png_path)],
            check=True, capture_output=True,
        )
        pngs.append(png_path)
        if (i + 1) % 24 == 0:
            print(f"  {i + 1}/{N_FRAMES}")

    print("Combining into GIF…")
    bg = Image.new("RGBA", (VIEW_W, VIEW_H), BG_RGBA)
    frames = []
    for p in pngs:
        img = Image.open(p).convert("RGBA")
        composed = bg.copy()
        composed.alpha_composite(img)
        frames.append(
            composed.convert(
                "P", palette=Image.Palette.ADAPTIVE, colors=PALETTE_COLORS
            )
        )

    raw_path = TMP / "raw.gif"
    frames[0].save(
        raw_path,
        save_all=True,
        append_images=frames[1:],
        duration=int(1000 / FPS),
        loop=0,
        optimize=True,
        disposal=2,
    )

    out_path = ASSETS / "loader.gif"
    # Second pass via ImageMagick: coalesce + frame-diff optimization +
    # global palette collapse. Roughly halves the file size vs Pillow alone.
    subprocess.run(
        [
            "magick", str(raw_path), "-coalesce", "+remap",
            "-colors", str(PALETTE_COLORS), "-layers", "Optimize",
            str(out_path),
        ],
        check=True,
    )
    print(f"Wrote {out_path} ({out_path.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
