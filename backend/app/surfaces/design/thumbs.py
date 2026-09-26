"""160 px plan-view thumbnails of candidates (spec §3 `thumbs/<cid>.png`)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

MAX_POINTS = 200_000


def plan_thumbnail(points: np.ndarray, out: Path, *, size: int = 160) -> None:
    """Vertices drawn as pixels, grey by height, on a transparent square-scaled canvas."""
    n = len(points)
    if n == 0:
        return
    p = np.asarray(points[:: max(1, n // MAX_POINTS)], dtype=np.float64)
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    w, h = max(float(x.max() - x.min()), 1e-9), max(float(y.max() - y.min()), 1e-9)
    scale = (size - 1) / max(w, h)
    width, height = int(round(w * scale)) + 1, int(round(h * scale)) + 1
    cols = np.clip(np.round((x - x.min()) * scale).astype(int), 0, width - 1)
    rows = np.clip(np.round((y.max() - y) * scale).astype(int), 0, height - 1)
    zr = float(z.max() - z.min())
    shade = (90 + (165 * (z - z.min()) / zr if zr > 0 else 0 * z)).astype(np.uint8)
    img = np.zeros((height, width, 4), np.uint8)
    img[rows, cols, 0] = img[rows, cols, 1] = img[rows, cols, 2] = shade
    img[rows, cols, 3] = 255
    # A single level below the inspection dir: parents=False so a deleted inspection raises
    # FileNotFoundError instead of the write recreating the folder (spec §3 store.py note).
    out.parent.mkdir(parents=False, exist_ok=True)
    Image.fromarray(img, "RGBA").save(out)


def shade_thumbnail(shade: np.ndarray, out: Path, *, size: int = 160) -> None:
    """A grid.hillshade result (0 = no data) as a transparent-where-empty thumbnail."""
    rgba = np.zeros((*shade.shape, 4), np.uint8)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = shade
    rgba[..., 3] = np.where(shade > 0, 255, 0)
    im = Image.fromarray(rgba, "RGBA")
    im.thumbnail((size, size), Image.Resampling.BILINEAR)
    out.parent.mkdir(parents=False, exist_ok=True)
    im.save(out)
