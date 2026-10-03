"""Software rasterizer for the agent's self-check (spec 2026-10-02 §7.4).

Orthographic, area-weighted surface splatting into a z-buffer: each triangle gets samples in
proportion to its projected pixel area (fixed-seed RNG), the nearest sample per pixel wins and is
shaded flat from its triangle normal. Outlines mark part-id and depth jumps. No GPU, no window.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app.asset_models.placement import bearing_dir

MAX_SIZE = 1024
SAMPLES_PER_PX = 5.0
MAX_SAMPLES = 6_000_000
MARGIN = 0.06
MAX_SPLIT_PASSES = 16
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


@dataclass(frozen=True)
class Marker:
    """A finding drawn over a render (spec 2026-10-02-asset-findings A9): a pin at one point, or a
    closed outline through several, in the asset frame."""

    kind: Literal["pin", "outline"]
    points: tuple[tuple[float, float, float], ...]
    rgb: tuple[int, int, int]


Window = tuple[tuple[float, float, float], float]  # (centre, half-width in metres)


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
        elif view.kind == "custom":
            if view.direction is None:
                raise ValueError("a custom view needs a direction")
            f = np.asarray(view.direction, dtype=float)
        else:
            raise ValueError(f"unknown view kind: {view.kind!r}")
        norm = np.linalg.norm(f)
        if not np.isfinite(norm) or norm < 1e-9:
            raise ValueError("view direction must be a non-zero finite vector")
        f = f / norm
        up = up_world - f * (up_world @ f)
        if np.linalg.norm(up) < 1e-6:
            up = np.array([1.0, 0.0, 0.0])
    up = up / np.linalg.norm(up)
    right = np.cross(f, up)
    return f, right / np.linalg.norm(right), up


def basis(view: View) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """forward, right, up for `view` (the report's 3D locator projects patch outlines with it)."""
    return _basis(view)


def _draw_markers(img: Image.Image, markers: Sequence[Marker] | None, project, size: int) -> Image.Image:
    if not markers:
        return img
    draw = ImageDraw.Draw(img)
    for mk in markers:
        pts = [project(np.asarray(p, dtype=float)) for p in mk.points]
        if mk.kind == "pin" and pts:
            x, y = pts[0]
            r = max(5, round(size * 0.018))
            draw.ellipse([x - r - 2, y - r - 2, x + r + 2, y + r + 2], fill=(255, 255, 255))
            draw.ellipse([x - r, y - r, x + r, y + r], fill=mk.rgb)
        elif mk.kind == "outline" and len(pts) >= 2:
            w = max(2, round(size * 0.004))
            ring = [*pts, pts[0]]
            draw.line(ring, fill=(255, 255, 255), width=w + 4, joint="curve")
            draw.line(ring, fill=mk.rgb, width=w, joint="curve")
    return img


def render(
    meshes,
    view: View,
    *,
    size: int = 1024,
    labels: bool = False,
    groups=None,
    highlight=None,
    window: Window | None = None,
    markers: Sequence[Marker] | None = None,
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
        if len(tris) == 0:
            return Image.new("RGB", (size, size), BG)
    sx, sy, sd = tris @ right, tris @ up, tris @ f  # (T,3) each
    if window is not None:
        c = np.asarray(window[0], dtype=float)
        half = float(window[1])
        if not np.isfinite(half) or half <= 0:
            raise ValueError("window half-width must be a positive finite number")
        cx, cy = float(c @ right), float(c @ up)
        lo = np.array([cx - half, cy - half])
        hi = np.array([cx + half, cy + half])
        keep = (
            (sx.max(axis=1) >= lo[0])
            & (sx.min(axis=1) <= hi[0])
            & (sy.max(axis=1) >= lo[1])
            & (sy.min(axis=1) <= hi[1])
        )
        tris, owner, normals = tris[keep], owner[keep], normals[keep]
        sx, sy, sd = sx[keep], sy[keep], sd[keep]
    else:
        lo = np.array([sx.min(), sy.min()])
        hi = np.array([sx.max(), sy.max()])
    span = float(max(hi - lo)) or 1.0
    scale = size * (1 - 2 * MARGIN) / span
    off = (size - (hi - lo) * scale) / 2

    def project(p: np.ndarray) -> tuple[float, float]:
        return (
            float((p @ right - lo[0]) * scale + off[0]),
            float(size - ((p @ up - lo[1]) * scale + off[1])),
        )

    if window is not None:
        # a triangle far larger than the frame would spend its samples outside it: split those first
        frame_m = size / scale  # the frame's side in metres
        for _ in range(MAX_SPLIT_PASSES):
            big = (np.ptp(sx, axis=1) > frame_m) | (np.ptp(sy, axis=1) > frame_m)
            if not big.any():
                break
            a, b, c3 = (tris[big][:, k] for k in range(3))
            ab, bc, ca = (a + b) / 2, (b + c3) / 2, (c3 + a) / 2
            parts = np.concatenate(
                [np.stack(t, axis=1) for t in ((a, ab, ca), (ab, b, bc), (ca, bc, c3), (ab, bc, ca))]
            )
            tris = np.concatenate([tris[~big], parts])
            owner = np.concatenate([owner[~big], np.tile(owner[big], 4)])
            normals = np.concatenate([normals[~big], np.tile(normals[big], (4, 1))])
            sx, sy, sd = tris @ right, tris @ up, tris @ f
            keep = (
                (sx.max(axis=1) >= lo[0])
                & (sx.min(axis=1) <= hi[0])
                & (sy.max(axis=1) >= lo[1])
                & (sy.min(axis=1) <= hi[1])
            )
            tris, owner, normals = tris[keep], owner[keep], normals[keep]
            sx, sy, sd = sx[keep], sy[keep], sd[keep]
    if len(tris) == 0:
        return _draw_markers(Image.new("RGB", (size, size), BG), markers, project, size)
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

    fx, fy, depth = interp(px), interp(py), interp(sd)
    if window is not None:  # a sample outside the frame is dropped, never clamped onto its border
        inside = (fx >= 0) & (fx < size) & (fy >= 0) & (fy < size)
        tri_of, fx, fy, depth = tri_of[inside], fx[inside], fy[inside], depth[inside]
        if len(tri_of) == 0:
            return _draw_markers(Image.new("RGB", (size, size), BG), markers, project, size)
    ix = np.clip(fx.astype(np.int64), 0, size - 1)
    iy = np.clip(fy.astype(np.int64), 0, size - 1)
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
    return _draw_markers(out, markers, project, size)


def grid(images: list[Image.Image], titles: list[str]) -> Image.Image:
    n = len(images)
    if n == 0:
        raise ValueError("grid needs at least one image")
    if n != len(titles):
        raise ValueError("grid needs one title per image")
    cols = 2 if n == 4 else n
    rows = math.ceil(n / cols)
    cell = min(800, 1600 // cols, 1600 // rows - 20)
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 20)), BG)
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for k, (img, title) in enumerate(zip(images, titles, strict=True)):
        r, c = divmod(k, cols)
        sheet.paste(img.resize((cell, cell)), (c * cell, r * (cell + 20) + 20))
        draw.text((c * cell + 6, r * (cell + 20) + 4), title, fill=(230, 230, 230), font=font)
    return sheet
