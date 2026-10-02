"""Software rasterizer for the agent's self-check (spec 2026-10-02 §7.4).

Orthographic, area-weighted surface splatting into a z-buffer: each triangle gets samples in
proportion to its projected pixel area (fixed-seed RNG), the nearest sample per pixel wins and is
shaded flat from its triangle normal. Outlines mark part-id and depth jumps. No GPU, no window.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app.asset_models.placement import bearing_dir

MAX_SIZE = 1024
SAMPLES_PER_PX = 5.0
MAX_SAMPLES = 6_000_000
MARGIN = 0.06
SEED = 11
BG = (20, 26, 36)
OUTLINE = (12, 14, 18)
GROUP_RGB = {
    "Shell": (196, 200, 206),
    "Head": (176, 186, 200),
    "Bottom": (150, 150, 158),
    "Nozzle": (230, 160, 70),
    "Manway": (230, 120, 70),
    "Support": (120, 150, 190),
    "Access": (120, 190, 140),
    "Internal": (190, 120, 200),
    "Lining": (70, 72, 78),
    "Other": (160, 160, 160),
}
HIGHLIGHT = (255, 90, 90)


@dataclass(frozen=True)
class View:
    kind: Literal["iso", "front", "side", "top", "section", "custom"]
    bearing_deg: float | None = None
    direction: tuple[float, float, float] | None = None


def _basis(view: View) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """forward (into the screen), right, up — all unit vectors in the asset frame."""
    up_world = np.array([0.0, 1.0, 0.0])
    if view.kind == "top":
        f, up = np.array([0.0, -1.0, 0.0]), np.array([1.0, 0.0, 0.0])  # plant north up the image
    else:
        if view.kind == "front":
            f = np.array([1.0, 0.0, 0.0])
        elif view.kind == "side":
            f = np.array([0.0, 0.0, 1.0])
        elif view.kind == "iso":
            f = np.array([1.0, -0.8, 1.0])
        elif view.kind == "section":
            f = bearing_dir(view.bearing_deg or 0.0)
        else:
            f = np.asarray(view.direction, dtype=float)
        f = f / np.linalg.norm(f)
        up = up_world - f * (up_world @ f)
        if np.linalg.norm(up) < 1e-6:
            up = np.array([1.0, 0.0, 0.0])
    up = up / np.linalg.norm(up)
    right = np.cross(f, up)
    return f, right / np.linalg.norm(right), up


def render(
    meshes, view: View, *, size: int = 1024, labels: bool = False, groups=None, highlight=None
) -> Image.Image:
    size = int(min(max(size, 64), MAX_SIZE))
    groups = groups or {}
    highlight = highlight or set()
    ids = list(meshes)
    if not ids:
        return Image.new("RGB", (size, size), BG)
    tris = np.concatenate([meshes[i].triangles for i in ids])
    owner = np.concatenate([np.full(len(meshes[i].faces), k, dtype=np.int32) for k, i in enumerate(ids)])
    normals = np.concatenate([meshes[i].face_normals for i in ids])
    f, right, up = _basis(view)
    if view.kind == "section":  # keep what lies beyond the vertical plane through the axis
        keep = (tris.mean(axis=1) @ f) >= 0
        tris, owner, normals = tris[keep], owner[keep], normals[keep]
    sx, sy, sd = tris @ right, tris @ up, tris @ f  # (T,3) each
    half_w = float(
        max(abs(sx.min()), abs(sx.max()))
    )  # centre on the asset axis, so a nozzle can't shift the frame
    lo = np.array([-half_w, sy.min()])
    hi = np.array([half_w, sy.max()])
    span = float(max(hi - lo)) or 1.0
    scale = size * (1 - 2 * MARGIN) / span
    off = (size - (hi - lo) * scale) / 2
    px = (sx - lo[0]) * scale + off[0]
    py = size - ((sy - lo[1]) * scale + off[1])  # image y grows downward
    area = 0.5 * np.abs(
        (px[:, 1] - px[:, 0]) * (py[:, 2] - py[:, 0]) - (px[:, 2] - px[:, 0]) * (py[:, 1] - py[:, 0])
    )
    counts = np.maximum(1, np.ceil(area * SAMPLES_PER_PX)).astype(np.int64)
    if counts.sum() > MAX_SAMPLES:
        counts = np.maximum(1, (counts * (MAX_SAMPLES / counts.sum())).astype(np.int64))
    tri_of = np.repeat(np.arange(len(tris)), counts)
    rng = np.random.default_rng(SEED)
    u, v = rng.random(len(tri_of)), rng.random(len(tri_of))
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    w = 1 - u - v

    def interp(q):
        return w * q[tri_of, 0] + u * q[tri_of, 1] + v * q[tri_of, 2]

    ix = np.clip(interp(px).astype(np.int64), 0, size - 1)
    iy = np.clip(interp(py).astype(np.int64), 0, size - 1)
    depth = interp(sd)
    pix = iy * size + ix
    d0, d1 = float(depth.min()), float(depth.max())
    dq = ((depth - d0) / ((d1 - d0) or 1.0) * ((1 << 20) - 1)).astype(np.int64)
    order = np.argsort(pix * (1 << 20) + dq, kind="stable")  # by pixel, then nearest first
    pix_sorted = pix[order]
    first = np.ones(len(order), dtype=bool)
    first[1:] = pix_sorted[1:] != pix_sorted[:-1]
    win = order[first]
    wp = pix[win]
    shade = 0.35 + 0.65 * np.abs(normals[tri_of[win]] @ f)
    base = np.array([GROUP_RGB.get(groups.get(i, "Other"), GROUP_RGB["Other"]) for i in ids], dtype=float)
    part = owner[tri_of[win]]
    rgb = base[part] * shade[:, None]
    for k, pid in enumerate(ids):
        if pid in highlight:
            rgb[part == k] = HIGHLIGHT
    img = np.empty((size * size, 3), dtype=np.uint8)
    img[:] = BG
    img[wp] = np.clip(rgb, 0, 255).astype(np.uint8)
    idmap = np.full(size * size, -1, dtype=np.int32)
    idmap[wp] = part
    dmap = np.full(size * size, np.inf)
    dmap[wp] = depth[win]
    img, idmap, dmap = img.reshape(size, size, 3), idmap.reshape(size, size), dmap.reshape(size, size)
    edge = np.zeros((size, size), dtype=bool)
    jump = span * 0.01
    for a, b in (
        ((slice(None), slice(1, None)), (slice(None), slice(None, -1))),
        ((slice(1, None), slice(None)), (slice(None, -1), slice(None))),
    ):
        id_change = idmap[a] != idmap[b]
        with np.errstate(invalid="ignore"):
            depth_jump = np.abs(dmap[a] - dmap[b]) > jump
        e = id_change | depth_jump
        edge[a] |= e & (idmap[a] >= 0)
    img[edge] = OUTLINE
    out = Image.fromarray(img, "RGB")
    if labels:
        draw = ImageDraw.Draw(out)
        font = ImageFont.load_default()
        for k, pid in enumerate(ids):
            ys, xs = np.nonzero(idmap == k)
            if len(xs) > 30:
                draw.text(
                    (int(xs.mean()), int(ys.mean())),
                    pid,
                    fill=(255, 255, 255),
                    font=font,
                    stroke_width=2,
                    stroke_fill=(0, 0, 0),
                    anchor="mm",
                )
    return out


def grid(images: list[Image.Image], titles: list[str]) -> Image.Image:
    n = len(images)
    cols = 2 if n == 4 else n
    rows = math.ceil(n / cols)
    cell = min(800, 1600 // cols, 1600 // rows - 20)
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 20)), BG)
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for k, (img, title) in enumerate(zip(images, titles, strict=False)):
        r, c = divmod(k, cols)
        sheet.paste(img.resize((cell, cell)), (c * cell, r * (cell + 20) + 20))
        draw.text((c * cell + 6, r * (cell + 20) + 4), title, fill=(230, 230, 230), font=font)
    return sheet
