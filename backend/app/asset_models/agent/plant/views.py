# backend/app/asset_models/agent/plant/views.py
"""What the plant run renders for the model; every image is <= 1 600 px on its long side.
- drawing_zoom: a page region at up to 600 dpi, with page-fraction ticks and plant grid lines.
- mosaics: the ortho or a placed drawing as site tiles, warped plant-north-up.
- render_site: plan and iso views of the register."""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app.asset_models.look import LookError, clamp_region, to_jpeg
from app.asset_models.look.drawing import _drawing, drawing_view

MAX_PX = 1600
MAX_DPI = 600
RASTER = ("png", "jpg", "tif")
NICE = (1.0, 2.0, 2.5, 5.0)
TICK = (200, 0, 120)
GRID = (0, 120, 255)


@dataclass(frozen=True)
class Zoom:
    jpeg: bytes
    width: int
    height: int
    dpi: int | None
    note: str
    grid_step_m: float | None


def zoom_dpi(w_in: float, h_in: float, requested: int) -> tuple[int, str]:
    """The dpi to render a region of w_in x h_in inches at, and a note when it is below the request."""
    notes = []
    want = int(requested)
    if want > MAX_DPI:
        notes.append(f"{MAX_DPI} dpi is the most a zoom renders.")
        want = MAX_DPI
    fit = int(math.floor(MAX_PX / max(w_in, h_in, 1e-9)))
    if want > fit:
        px = math.ceil(max(w_in, h_in) * want)
        eff = max(fit, 1)
        notes.append(
            f"Rendered at {eff} dpi, not {want}: at {want} dpi this region would be {px} px on its long "
            "side, over the 1 600 px limit. Zoom into a smaller region to read finer detail."
        )
        want = eff
    return want, " ".join(notes)


def _pdf_region(src: Path, page_n: int, region, dpi: int) -> tuple[Image.Image, int, str]:
    import pypdfium2

    from app.drawings.pdf import open_pdf, page_rgb
    from app.jobs.cancellation import JobFailure

    try:
        with open_pdf(src) as doc:
            if not 1 <= page_n <= len(doc):
                raise LookError("That page is no longer in the drawing's source PDF.")
            page = doc[page_n - 1]
            try:
                w_pt, h_pt = page.get_size()
                x0, y0, x1, y1 = region
                eff, note = zoom_dpi((x1 - x0) * w_pt / 72, (y1 - y0) * h_pt / 72, dpi)
                # crop = points trimmed from (left, bottom, right, top)
                crop = (x0 * w_pt, (1 - y1) * h_pt, (1 - x1) * w_pt, y0 * h_pt)
                bitmap = page.render(scale=eff / 72, crop=crop, rev_byteorder=True)
                try:
                    rgb = np.array(page_rgb(bitmap), dtype=np.uint8, copy=True)
                finally:
                    bitmap.close()
            finally:
                page.close()
    except (OSError, JobFailure, pypdfium2.PdfiumError):
        raise LookError("The drawing's source PDF can't be read - read the page with drawing_view.") from None
    return Image.fromarray(rgb, "RGB"), eff, note


def _plan_region(handle, d, region) -> tuple[Image.Image, str]:
    li = drawing_view(handle, d.id, region, max_side=MAX_PX)
    img = Image.open(io.BytesIO(li.jpeg)).convert("RGB")
    note = ""
    if d.width and d.height:
        x0, y0, x1, y1 = region
        native = max((x1 - x0) * d.width, (y1 - y0) * d.height)
        if native > MAX_PX:
            note = (
                f"Shown at {100 * MAX_PX / native:.0f}% of the scan's resolution: zoom into a smaller "
                "region to read finer detail."
            )
    return img, note


def drawing_zoom(
    handle, drawing_id: str, region, dpi: int = 300, *, grid: bool = True, page_to_plant=None
) -> Zoom:
    d = _drawing(handle, drawing_id)
    region, rnote = clamp_region(region if region is not None else [0.0, 0.0, 1.0, 1.0])
    src = Path(d.source_path)
    eff: int | None = None
    if d.format == "pdf" and src.exists():
        img, eff, note = _pdf_region(src, d.page or 1, region, dpi)
    elif d.format == "pdf" or d.format in RASTER:
        img, note = _plan_region(handle, d, region)
        if d.format == "pdf":
            note = f"The source PDF is not reachable, so this is the imported page image. {note}".strip()
    else:
        raise LookError("That drawing has no page image (DXF or LandXML): read it with drawing_text.")
    step = draw_overlay(img, region, page_to_plant) if grid else None
    note = " ".join(x for x in (rnote, note) if x)
    li = to_jpeg(img, MAX_PX, note)
    return Zoom(li.jpeg, li.width, li.height, eff, note, step)


# ------------------------------------------------------------------ overlay
def _nice(x: float) -> float:
    if not (x > 0 and math.isfinite(x)):
        return 1.0
    k = 10 ** math.floor(math.log10(x))
    for m in NICE:
        if m * k >= x:
            return m * k
    return 10 * k


def _segment(a: float, b: float, c: float, value: float, W: int, H: int):
    """The image segment where a*u + b*v + c == value, clipped to the image rectangle, or None."""
    pts = []
    if abs(b) > 1e-12:
        for u in (0.0, float(W)):
            v = (value - c - a * u) / b
            if 0 <= v <= H:
                pts.append((u, v))
    if abs(a) > 1e-12:
        for v in (0.0, float(H)):
            u = (value - c - b * v) / a
            if 0 <= u <= W:
                pts.append((u, v))
    uniq = []
    for p in pts:
        if all(math.dist(p, q) > 0.5 for q in uniq):
            uniq.append(p)
    return (uniq[0], uniq[1]) if len(uniq) >= 2 else None


def _affine_px_to(fn, region, W: int, H: int):
    """(a, b, c, d, e, f): E = a u + b v + c, N = d u + e v + f for image pixel (u, v); exact for the
    similarity transforms in use (page -> drawing georef -> site -> plant)."""
    x0, y0, x1, y1 = region

    def page(u, v):
        return x0 + (x1 - x0) * u / W, y0 + (y1 - y0) * v / H

    vals = []
    for u, v in ((0.0, 0.0), (float(W), 0.0), (0.0, float(H))):
        e, n = fn(*page(u, v))
        vals.append((float(np.asarray(e)), float(np.asarray(n))))
    (e0, n0), (e1, n1), (e2, n2) = vals
    return (e1 - e0) / W, (e2 - e0) / H, e0, (n1 - n0) / W, (n2 - n0) / H, n0


def draw_overlay(img: Image.Image, region, page_to_plant) -> float | None:
    """Page-fraction ticks on the top and left edges; plant E/N grid lines when `page_to_plant` maps
    (fx, fy) page fractions to plant (E, N). Returns the grid step in metres, or None."""
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default()
    W, H = img.size
    x0, y0, x1, y1 = region
    step = _nice((x1 - x0) / 8)
    v = math.ceil(x0 / step) * step
    while v <= x1 + 1e-9:
        u = (v - x0) / (x1 - x0) * W
        draw.line([(u, 0), (u, 10)], fill=TICK, width=1)
        draw.text((u + 2, 11), f"{v:.3f}", fill=TICK, font=font)
        v += step
    step = _nice((y1 - y0) / 8)
    v = math.ceil(y0 / step) * step
    while v <= y1 + 1e-9:
        w = (v - y0) / (y1 - y0) * H
        draw.line([(0, w), (10, w)], fill=TICK, width=1)
        draw.text((12, w + 1), f"{v:.3f}", fill=TICK, font=font)
        v += step
    if page_to_plant is None:
        return None
    try:
        a, b, c, d, e, f = _affine_px_to(page_to_plant, region, W, H)
    except Exception:  # noqa: BLE001 - a frame that can't map this page draws no grid
        return None
    corners = [(0, 0), (W, 0), (0, H), (W, H)]
    es = [a * u + b * w + c for u, w in corners]
    ns = [d * u + e * w + f for u, w in corners]
    gstep = _nice(max(max(es) - min(es), max(ns) - min(ns)) / 6)
    for (p, q, r), lo, hi, axis in (((a, b, c), min(es), max(es), "E"), ((d, e, f), min(ns), max(ns), "N")):
        val = math.ceil(lo / gstep) * gstep
        while val <= hi:
            seg = _segment(p, q, r, val, W, H)
            if seg:
                draw.line(seg, fill=GRID, width=1)
                draw.text((seg[0][0] + 3, seg[0][1] + 3), f"{axis} {val:g}", fill=GRID, font=font)
            val += gstep
    return gstep
