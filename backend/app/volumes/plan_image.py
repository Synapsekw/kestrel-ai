"""The report's plan view (spec 2026-09-23-volumes §10): hillshade of the top surface over the
polygon's bbox plus 10 %, the cut/fill overlay, the polygons, a scale bar, a north arrow and a
legend. One overview read of at most 2000 px per side for each grid; composed with PIL."""

from __future__ import annotations

import io
import math

import numpy as np
from PIL import Image, ImageDraw
from rasterio.windows import Window
from shapely.geometry import Polygon

from app.surfaces.grid import SurfaceReader, hillshade
from app.surfaces.tiles import DIFF_CUT, DIFF_FILL, diff_colours
from app.volumes.regions import lattice_window

MAX_PX = 2000
MARGIN = 0.10
POLYGON = (229, 175, 100)  # the app's accent amber
STABLE = (174, 209, 177)
EXCLUSION = (224, 108, 96)
CLUTTER = (233, 196, 106)
INK = (30, 30, 30)
STEPS = (1, 2, 5)


def _nice(metres: float) -> float:
    exp = math.floor(math.log10(metres))
    best = 10.0**exp
    for s in STEPS:
        if s * 10.0**exp <= metres:
            best = s * 10.0**exp
    return best


def render_plan_image(
    top: SurfaceReader,
    diff: SurfaceReader | None,
    polygon: list[list[float]],
    *,
    diff_scale: float,
    stable: list[list[float]] | None = None,
    exclusions: list[list[list[float]]] = (),
    clutter: list[list[list[float]]] = (),
    max_px: int = MAX_PX,
) -> bytes:
    """PNG bytes of the plan view."""
    spec = top.spec
    minx, miny, maxx, maxy = Polygon(polygon).bounds
    mx, my = (maxx - minx) * MARGIN, (maxy - miny) * MARGIN
    win = lattice_window(spec, (minx - mx, miny - my, maxx + mx, maxy + my))
    f = max(1, math.ceil(max(int(win.width), int(win.height)) / max_px))
    shape = (math.ceil(int(win.height) / f), math.ceil(int(win.width) / f))
    z = top.read(win, out_shape=shape, boundless=True)
    shade = hillshade(z, spec.cell_size * f, spec.cell_size * f)
    grey = np.where(shade > 0, shade, 245).astype(np.uint8)
    img = Image.fromarray(np.stack([grey] * 3, axis=-1), "RGB").convert("RGBA")
    if diff is not None:
        dc = round((diff.spec.x0 - spec.x0) / spec.cell_size)
        dr = round((spec.y0 - diff.spec.y0) / spec.cell_size)
        dwin = Window(int(win.col_off) - dc, int(win.row_off) - dr, int(win.width), int(win.height))
        dz = diff.read(dwin, out_shape=shape, boundless=True).astype(np.float64)
        img = Image.alpha_composite(img, Image.fromarray(diff_colours(dz, diff_scale), "RGBA"))
    x0 = spec.x0 + int(win.col_off) * spec.cell_size
    y0 = spec.y0 - int(win.row_off) * spec.cell_size
    px_m = spec.cell_size * f

    def to_px(ring):
        return [((x - x0) / px_m, (y0 - y) / px_m) for x, y in ring]

    draw = ImageDraw.Draw(img)
    for ring in clutter:
        draw.polygon(to_px(ring), outline=CLUTTER, width=2)
    for ring in exclusions:
        draw.polygon(to_px(ring), outline=EXCLUSION, width=2)
    if stable:
        draw.polygon(to_px(stable), outline=STABLE, width=3)
    draw.polygon(to_px(polygon), outline=POLYGON, width=4)
    w, h = img.size
    bar_m = _nice(w * px_m / 4)
    bar_px = bar_m / px_m
    draw.rectangle([10, h - 30, 10 + bar_px, h - 24], fill=INK)
    draw.text((10, h - 22), f"{bar_m:g} m", fill=INK)
    draw.polygon([(w - 24, 12), (w - 32, 34), (w - 16, 34)], fill=INK)
    draw.text((w - 28, 36), "N", fill=INK)
    if diff is not None:
        for i, (colour, label) in enumerate(
            ((DIFF_FILL, f"+{diff_scale:.2f} m"), (DIFF_CUT, f"-{diff_scale:.2f} m"))
        ):
            draw.rectangle(
                [w - 110, h - 44 + 18 * i, w - 96, h - 32 + 18 * i], fill=tuple(int(c) for c in colour)
            )
            draw.text((w - 90, h - 44 + 18 * i), label, fill=INK)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "PNG")
    return buf.getvalue()
