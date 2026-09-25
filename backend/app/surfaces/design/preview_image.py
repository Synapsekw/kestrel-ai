"""preview.png (spec §10): the target's hillshade in greys, the design's tinted in the Contour accent
at 60 % over it, both footprints outlined; two labelled panels when the boxes are far apart."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from app.surfaces import grid

ACCENT = np.array([0xE5, 0xAF, 0x64], dtype=np.float64)
TARGET_LINE = np.array([0xA3, 0xAE, 0xA6], dtype=np.float64)
BACKGROUND = np.array([0x15, 0x1B, 0x19], dtype=np.float64)
INK = (0xED, 0xF0, 0xE9, 255)
MAX_SIDE = 512
PANEL_SIDE = 252  # two panels + an 8 px gutter = 512
LABEL_H = 20
FAR = 10.0


@dataclass(frozen=True)
class Layer:
    """A north-up raster in the output CRS: the preview grid, or the target's overview."""

    z: np.ndarray
    x0: float
    y0: float
    cell_x: float
    cell_y: float

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        h, w = self.z.shape
        return self.x0, self.y0 - h * self.cell_y, self.x0 + w * self.cell_x, self.y0


def _outline(mask: np.ndarray) -> np.ndarray:
    """The cells of `mask` that border a False cell — a False neighbour just off the array (the
    panel edge) counts too, so a footprint that reaches the edge of the panel is still outlined
    there, not just where it borders another False cell inside the array."""
    p = np.pad(mask, 1, constant_values=False)
    inner = p[1:-1, 1:-1] & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    return mask & ~inner


def _sample(layer: Layer, shade: np.ndarray, x0: float, y0: float, cell: float, w: int, h: int):
    lh, lw = layer.z.shape
    cols = np.floor((x0 + (np.arange(w) + 0.5) * cell - layer.x0) / layer.cell_x).astype(np.int64)
    rows = np.floor((layer.y0 - (y0 - (np.arange(h) + 0.5) * cell)) / layer.cell_y).astype(np.int64)
    ok = ((rows >= 0) & (rows < lh))[:, None] & ((cols >= 0) & (cols < lw))[None, :]
    rr, cc = np.ix_(rows.clip(0, lh - 1), cols.clip(0, lw - 1))
    return np.where(ok, shade[rr, cc], 0), ok & np.isfinite(layer.z[rr, cc])


def _panel(layers: list[tuple[Layer, str]], bounds, side: int) -> np.ndarray:
    minx, miny, maxx, maxy = bounds
    cell = max(maxx - minx, maxy - miny, 1e-9) / side
    w = min(side, max(1, math.ceil((maxx - minx) / cell)))
    h = min(side, max(1, math.ceil((maxy - miny) / cell)))
    img = np.empty((h, w, 3), np.float64)
    img[:] = BACKGROUND
    edges = []
    for layer, role in layers:
        shade, valid = _sample(
            layer,
            grid.hillshade(layer.z.astype(np.float32), layer.cell_x, layer.cell_y),
            minx,
            maxy,
            cell,
            w,
            h,
        )
        s = shade.astype(np.float64)[..., None]
        if role == "target":
            img = np.where(valid[..., None], np.repeat(s, 3, axis=-1), img)
        else:
            img = np.where(valid[..., None], 0.6 * ACCENT * (s / 255.0) + 0.4 * img, img)
        edges.append((_outline(valid), TARGET_LINE if role == "target" else ACCENT))
    for edge, colour in edges:
        img[edge] = colour
    rgba = np.full((h, w, 4), 255, np.uint8)
    rgba[..., :3] = img.clip(0, 255).astype(np.uint8)
    return rgba


def _gap(a, b) -> float:
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    return math.hypot(dx, dy)


def render(design: Layer, target: Layer | None, out: Path) -> int:
    """Write preview.png; returns the number of panels (1 or 2)."""
    out.parent.mkdir(parents=True, exist_ok=True)
    if target is None:
        Image.fromarray(_panel([(design, "design")], design.bounds, MAX_SIDE), "RGBA").save(out)
        return 1
    db, tb = design.bounds, target.bounds
    gap = _gap(db, tb)
    extent = max(db[2] - db[0], db[3] - db[1], tb[2] - tb[0], tb[3] - tb[1])
    if gap <= FAR * extent:
        union = (min(db[0], tb[0]), min(db[1], tb[1]), max(db[2], tb[2]), max(db[3], tb[3]))
        Image.fromarray(_panel([(target, "target"), (design, "design")], union, MAX_SIDE), "RGBA").save(out)
        return 1
    left = _panel([(design, "design")], db, PANEL_SIDE)
    right = _panel([(target, "target")], tb, PANEL_SIDE)
    h = max(left.shape[0], right.shape[0]) + LABEL_H
    canvas = Image.new("RGBA", (MAX_SIDE, h), tuple(int(c) for c in BACKGROUND) + (255,))
    canvas.paste(Image.fromarray(left, "RGBA"), (0, 0))
    canvas.paste(Image.fromarray(right, "RGBA"), (PANEL_SIDE + 8, 0))
    ImageDraw.Draw(canvas).text(
        (4, h - LABEL_H + 4), f"design | cloud surface — {gap / 1000:.1f} km apart", fill=INK
    )
    canvas.save(out)
    return 2
