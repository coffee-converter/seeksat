#!/usr/bin/env python3
"""
Project an all-sky equirectangular image into 6 cube faces with the OpenGL
(and therefore Cesium SkyBox) cubemap convention. Bypasses ffmpeg's v360
cubemap output because its per-face orientations don't match OpenGL's spec.

Input:  16384x8192 equirect PNG  (NASA SVS plate-carrée, RA 0..24h L->R,
        NCP at top, SCP at bottom)
Output: 6 x 4096x4096 face JPGs in assets/stars/, named starmap_2020_4k_{px,mx,py,my,pz,mz}.jpg

OpenGL cubemap face ray direction (per spec):
  +X face: ray = ( 1, -t, -s)     image-up=+Y, image-right=-Z
  -X face: ray = (-1, -t,  s)     image-up=+Y, image-right=+Z
  +Y face: ray = ( s,  1,  t)     image-up=-Z, image-right=+X
  -Y face: ray = ( s, -1, -t)     image-up=+Z, image-right=+X
  +Z face: ray = ( s, -t,  1)     image-up=+Y, image-right=+X
  -Z face: ray = (-s, -t, -1)     image-up=+Y, image-right=-X
where (s, t) range over [-1, 1] across the face (s=horizontal, t=vertical;
texture-V=1 is the image's top row).

Cesium ICRF axes: +X=RA0h (vernal equinox), +Y=RA6h, +Z=NCP. The face content
lives in those coordinates, so we just sample the equirect at (lon, lat) =
(atan2(y, x), arcsin(z)) for each face pixel.
"""

import sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
EQUIRECT = ROOT / "assets/stars/raw/starmap_2020_16k_tm.png"
OUT_DIR = ROOT / "assets/stars"
FACE_SIZE = 4096
QUALITY = 85

# Each entry: (face_name, ray-direction function on grid s, t in [-1, 1]).
# Cesium's SkyBox loads cubemap faces with image-top == texture-top (verified
# empirically with a labelled test cubemap), which is the opposite of the
# raw OpenGL spec where texture t=0 is bottom. We compensate by negating the
# t component of every face's ray equation - equivalent to a per-face vflip
# on the OpenGL-spec output.
FACES = {
    "px": lambda s, t: (np.ones_like(s),   t, -s),
    "mx": lambda s, t: (-np.ones_like(s),  t,  s),
    "py": lambda s, t: (s,  np.ones_like(s), -t),
    "my": lambda s, t: (s, -np.ones_like(s),  t),
    "pz": lambda s, t: (s,  t,  np.ones_like(s)),
    "mz": lambda s, t: (-s, t, -np.ones_like(s)),
}


def bilinear_sample(img, x, y):
    """Bilinear sample img (H, W, C) at float (x, y). x wraps horizontally."""
    H, W = img.shape[:2]
    x = np.mod(x, W)            # wrap RA at the equirect seam
    y = np.clip(y, 0, H - 1.001)
    x0 = np.floor(x).astype(np.int64)
    x1 = (x0 + 1) % W
    y0 = np.floor(y).astype(np.int64)
    y1 = np.minimum(y0 + 1, H - 1)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    a = img[y0, x0].astype(np.float32)
    b = img[y0, x1].astype(np.float32)
    c = img[y1, x0].astype(np.float32)
    d = img[y1, x1].astype(np.float32)
    return ((1 - fx) * (1 - fy)) * a + (fx * (1 - fy)) * b + \
           ((1 - fx) * fy) * c + (fx * fy) * d


def build_face(equirect, dir_fn):
    H, W = equirect.shape[:2]
    # Sample at pixel centers: (i + 0.5) maps from [0..N] to [-1, 1].
    coords = (np.arange(FACE_SIZE) + 0.5) / FACE_SIZE * 2 - 1
    s, t = np.meshgrid(coords, coords, indexing="xy")
    x, y, z = dir_fn(s, t)
    norm = np.sqrt(x * x + y * y + z * z)
    x, y, z = x / norm, y / norm, z / norm
    # NASA equirect: laid out as if viewed from OUTSIDE the celestial sphere
    # (RA increases left-to-right with RA=0 at the image centre - the "star
    # atlas" convention). Cesium's SkyBox is viewed from INSIDE the cube, so
    # we negate longitude in the lookup to invert east/west and produce the
    # correct in-sky orientation. NCP stays at row 0 because the polar axis
    # is unaffected by this east/west flip.
    lon = np.arctan2(y, x)
    lat = np.arcsin(z)
    col = np.mod(np.pi - lon, 2 * np.pi) / (2 * np.pi) * W
    row = (np.pi / 2 - lat) / np.pi * H
    sampled = bilinear_sample(equirect, col, row)
    return np.clip(sampled, 0, 255).astype(np.uint8)


def main():
    if not EQUIRECT.exists():
        sys.exit(f"missing input equirect: {EQUIRECT}")
    print(f"loading {EQUIRECT}…")
    equirect = np.array(Image.open(EQUIRECT))
    H, W = equirect.shape[:2]
    print(f"  -> {W}x{H} {equirect.dtype}")
    for name, dir_fn in FACES.items():
        out = OUT_DIR / f"starmap_2020_4k_{name}.jpg"
        print(f"building {name} -> {out}")
        face = build_face(equirect, dir_fn)
        Image.fromarray(face).save(out, "JPEG", quality=QUALITY)


if __name__ == "__main__":
    main()
