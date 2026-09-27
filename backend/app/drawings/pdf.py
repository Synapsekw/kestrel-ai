"""PDF drawings through pypdfium2 (spec 2026-09-26-map-workspace M9, §8.2, §13, §14).

pypdfium2 is imported only inside these functions: when PDFium cannot load in a broken frozen
build, `unavailable_reason()` says why, PDF import answers 422 `pdf_unavailable`, and DXF and raster
drawings still work. `get_size()` returns the page as displayed (it honours /Rotate) and `render()`
draws it that way (checked on 5.13.0), so a rotated page needs no special case.
"""

from __future__ import annotations

import contextlib
import math
import os
from pathlib import Path

from app.drawings import store
from app.drawings.inspected import Inspected
from app.jobs.cancellation import JobFailure

DPI_CHOICES = (100, 150, 200, 300)
DEFAULT_DPI = 150
MAX_SIDE = 20_000
MAX_PIXELS = 300_000_000
STRIP_ROWS = 1024
MAX_THUMB_PAGES = 50
THUMB = 160
MESSAGE = "Reading drawing"


def unavailable_reason() -> str | None:
    try:
        import pypdfium2  # noqa: F401
    except Exception as e:  # ImportError, or an OSError from a missing pdfium.dll
        return f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
    return None


def _fits(w_pt: float, h_pt: float, dpi: int) -> bool:
    width, height = math.ceil(w_pt * dpi / 72), math.ceil(h_pt * dpi / 72)
    return max(width, height) <= MAX_SIDE and width * height <= MAX_PIXELS


def max_dpi(w_pt: float, h_pt: float) -> int:
    """The largest whole DPI whose render stays within 20 000 px a side and 300 MP (spec §8.2)."""
    d = int(math.floor(min(MAX_SIDE * 72 / max(w_pt, h_pt), math.sqrt(MAX_PIXELS / (w_pt * h_pt)) * 72)))
    while d > 1 and not _fits(w_pt, h_pt, d):
        d -= 1
    return max(d, 1)


def effective_dpi(requested: int, w_pt: float, h_pt: float) -> int:
    return min(requested, max_dpi(w_pt, h_pt))


@contextlib.contextmanager
def open_pdf(path: Path):
    import pypdfium2 as pdfium

    try:
        doc = pdfium.PdfDocument(str(path))
    except pdfium.PdfiumError as e:
        if "password" in str(e).lower():
            raise JobFailure(
                f"{path.name} is password-protected; save an unprotected copy and import that"
            ) from None
        raise JobFailure(f"{path.name} can't be read as PDF ({e})") from None
    try:
        if len(doc) == 0:
            raise JobFailure(f"{path.name} has no pages")
        yield doc
    finally:
        doc.close()  # Windows: an open document keeps the file locked


def page_rgb(bitmap):
    """(h, w, 3) uint8 RGB of a rendered bitmap, whatever format PDFium chose."""
    arr = bitmap.to_numpy()
    mode = bitmap.mode
    if mode == "L":
        return arr[..., None].repeat(3, axis=-1)
    if mode.startswith("BGR"):
        return arr[..., 2::-1]
    return arr[..., :3]


def _write_thumb(rgb, out: Path) -> None:
    """Same atomic idiom as raster_io's page thumbnails (tmp + os.replace): a reader never sees a
    half-written PNG, and a write into a deleted inspection folder is a no-op, never a recreate."""
    from PIL import Image

    out.parent.mkdir(parents=False, exist_ok=True)
    tmp = out.with_name(out.name + ".tmp")
    Image.fromarray(rgb).save(tmp, format="PNG")
    os.replace(tmp, out)


def inspect_file(path: Path, idir: Path, *, progress, check_cancelled) -> Inspected:
    """Every page's size (into pages.json, for the build's DPI cap), thumbnails for the first 50."""
    sizes = []
    with open_pdf(path) as doc:
        n = len(doc)
        for i in range(n):
            check_cancelled()
            page = doc[i]
            try:
                w, h = page.get_size()
                if i < MAX_THUMB_PAGES:
                    bitmap = page.render(scale=THUMB / max(w, h), rev_byteorder=True)
                    try:
                        _write_thumb(page_rgb(bitmap), store.page_thumb(idir, i + 1))
                    finally:
                        bitmap.close()
            finally:
                page.close()
            sizes.append({"page": i + 1, "width_pt": float(w), "height_pt": float(h)})
            progress((i + 1) / n, MESSAGE)
    store.write_json(idir / "pages.json", {"pages": sizes})
    return Inspected(page_count=n, pages=sizes[:MAX_THUMB_PAGES])


def strip_crop(r0: int, r1: int, height: int, scale: float) -> tuple[float, float, float, float]:
    """(left, bottom, right, top) crop in points that makes render() return rows r0..r1 exactly.
    pypdfium2 5.13 turns crop into pixels with math.ceil(c * scale); the 0.25 px bias lands every
    strip on its whole row despite float error (test_strip_crop_lands_on_whole_rows)."""
    return (0.0, (height - r1 - 0.25) / scale, 0.0, (r0 - 0.25) / scale)


def render_page_to_plan(
    path: Path, page_n: int, dpi: int, dst: Path, *, progress, check_cancelled, strip_rows: int | None = None
) -> tuple[int, int]:
    """Render page `page_n` (1-based) at `dpi` into plan.tif, STRIP_ROWS rows at a time (spec §13:
    one strip of <= 20 000 px x 1024 rows x 4 B in memory). Written to .partial, renamed at the end.
    numpy and rasterio are imported here, not at module scope, so `pdf` stays light for `placement`."""
    import numpy as np
    from rasterio.windows import Window

    from app.drawings import raster_io

    rows = strip_rows or STRIP_ROWS
    partial = dst.with_name(dst.name + ".partial")
    try:
        with open_pdf(path) as doc:
            if not 1 <= page_n <= len(doc):
                raise JobFailure(f"page {page_n} is not in {path.name}")
            page = doc[page_n - 1]
            try:
                scale = dpi / 72
                w_pt, h_pt = page.get_size()
                # render() sizes its canvas as ceil(size * scale), which float error can push one row
                # past the true size (7200 pt at 150 dpi -> 15000.000000000002 -> 15001). The plan is
                # the true size, as the DPI cap computed it; the surplus row/column is cropped away.
                src_w, src_h = math.ceil(w_pt * scale), math.ceil(h_pt * scale)
                width = min(src_w, math.ceil(w_pt * dpi / 72))
                height = min(src_h, math.ceil(h_pt * dpi / 72))
                with raster_io.open_plan(partial, width, height) as out:
                    for r0 in range(0, height, rows):
                        check_cancelled()
                        r1 = min(height, r0 + rows)
                        bitmap = page.render(
                            scale=scale, crop=strip_crop(r0, r1, src_h, scale), rev_byteorder=True
                        )
                        try:
                            rgb = page_rgb(bitmap)
                            if rgb.shape[:2] != (r1 - r0, src_w):
                                raise JobFailure(
                                    f"PDF strip rendered {rgb.shape[:2]}, expected {(r1 - r0, src_w)}"
                                )
                            rgb = rgb[:, :width]
                            strip = np.empty((4, r1 - r0, width), np.uint8)
                            strip[:3] = np.moveaxis(rgb, -1, 0)
                            strip[3] = 255
                            out.write(strip, window=Window(0, r0, width, r1 - r0))
                            del strip, rgb
                        finally:
                            bitmap.close()
                        progress(0.88 * r1 / height, f"rows {r1} / {height}")
            finally:
                page.close()
        raster_io.build_overviews(partial, progress=progress, check_cancelled=check_cancelled)
        os.replace(partial, dst)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    return width, height
