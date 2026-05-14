#!/usr/bin/env python3
"""
Build six labeled test cube faces so we can read off Cesium's actual cubemap
orientation convention. Each face has:
  - a unique solid background colour
  - the face name (PX/MX/PY/MY/PZ/MZ) huge in the centre
  - the word TOP/BOTTOM/LEFT/RIGHT written along each edge so any flip,
    rotation, or transpose Cesium applies is visually obvious
  - corner markers (TL/TR/BL/BR) so we can also tell if it transposes
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets/stars"
SIZE = 1024

FACES = {
    "px": "#cc2222",   # red
    "mx": "#22aaaa",   # teal
    "py": "#22aa22",   # green
    "my": "#aa22aa",   # magenta
    "pz": "#2222cc",   # blue
    "mz": "#cccc22",   # yellow
}


def get_font(size):
    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/Library/Fonts/Arial.ttf",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def build(name, colour):
    img = Image.new("RGB", (SIZE, SIZE), colour)
    draw = ImageDraw.Draw(img)

    # thin border so seams are visible
    draw.rectangle([0, 0, SIZE - 1, SIZE - 1], outline="white", width=4)

    big = get_font(SIZE // 5)
    mid = get_font(SIZE // 14)
    small = get_font(SIZE // 22)

    # centre face name
    text = name.upper()
    bbox = draw.textbbox((0, 0), text, font=big)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    draw.text(((SIZE - w) // 2, (SIZE - h) // 2 - bbox[1]),
              text, fill="white", font=big)

    # edge labels
    margin = SIZE // 24
    edge_labels = [
        ("TOP",    SIZE // 2, margin,           "mt"),
        ("BOTTOM", SIZE // 2, SIZE - margin,    "mb"),
        ("LEFT",   margin,    SIZE // 2,        "lm"),
        ("RIGHT",  SIZE - margin, SIZE // 2,    "rm"),
    ]
    for label, x, y, anchor in edge_labels:
        draw.text((x, y), label, fill="white", font=mid, anchor=anchor)

    # corner markers
    pad = SIZE // 16
    corners = [
        ("TL", pad,         pad,         "la"),
        ("TR", SIZE - pad,  pad,         "ra"),
        ("BL", pad,         SIZE - pad,  "ld"),
        ("BR", SIZE - pad,  SIZE - pad,  "rd"),
    ]
    for label, x, y, anchor in corners:
        draw.text((x, y), label, fill="white", font=small, anchor=anchor)

    return img


def main():
    for name, colour in FACES.items():
        out = OUT_DIR / f"starmap_2020_4k_{name}.jpg"
        img = build(name, colour)
        img.save(out, "JPEG", quality=92)
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
