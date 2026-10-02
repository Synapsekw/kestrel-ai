"""Drawing images from the rendered plan.tif; text from the source PDF or DXF (spec §7.3)."""

from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np
from PIL import Image

from app.asset_models.look import LookError, LookImage, clamp_region, to_jpeg
from app.db.models import Drawing
from app.drawings import store as dstore

__all__ = ["LookError", "LookImage", "TextResult", "drawing_text", "drawing_view"]


class TextResult:
    def __init__(self, spans: list[dict], note: str = "", truncated: bool = False):
        self.spans, self.note, self.truncated = spans, note, truncated


def _drawing(handle, drawing_id: str) -> Drawing:
    with handle.session() as s:
        row = s.get(Drawing, drawing_id)
        if row is None:
            raise LookError("There is no drawing with that id in this project.")
        if row.status != "ready":
            raise LookError(
                "That drawing is still importing."
                if row.status == "importing"
                else "That drawing failed to import."
            )
        s.expunge(row)
        return row


def drawing_view(handle, drawing_id: str, region=None, *, max_side: int = 1600) -> LookImage:
    import rasterio
    from rasterio.errors import NotGeoreferencedWarning
    from rasterio.windows import Window

    from app.drawings.raster_io import read_rgba

    _drawing(handle, drawing_id)
    region, note = clamp_region(region)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        src = rasterio.open(dstore.plan_path(handle, drawing_id))
    with src:
        W, H = src.width, src.height
        x0, y0, x1, y1 = region or [0.0, 0.0, 1.0, 1.0]
        win = Window(int(x0 * W), int(y0 * H), max(1, int((x1 - x0) * W)), max(1, int((y1 - y0) * H)))
        scale = min(1.0, max_side / max(win.width, win.height))
        out_shape = (max(1, round(win.height * scale)), max(1, round(win.width * scale)))
        rgba = read_rgba(src, window=win, out_shape=out_shape)  # (4, h, w), decimated by GDAL
    rgb = np.moveaxis(rgba[:3], 0, -1)
    alpha = rgba[3][..., None] / 255.0
    flat = (rgb * alpha + 255 * (1 - alpha)).astype(np.uint8)  # transparent -> white paper
    return to_jpeg(Image.fromarray(flat, "RGB"), max_side, note)


def _overlaps(box, region) -> bool:
    return region is None or not (
        box[2] < region[0] or box[0] > region[2] or box[3] < region[1] or box[1] > region[3]
    )


def _pdf_spans(path: Path, page_n: int) -> list[dict]:
    from app.drawings.pdf import open_pdf

    spans = []
    with open_pdf(path) as pdf:
        page = pdf[page_n - 1]
        w, h = page.get_size()
        tp = page.get_textpage()
        for i in range(tp.count_rects()):
            left, bottom, right, top = tp.get_rect(i)
            text = tp.get_text_bounded(left, bottom, right, top).strip()
            if text:
                spans.append(
                    {
                        "text": text,
                        "box": [
                            round(left / w, 4),
                            round(1 - top / h, 4),
                            round(right / w, 4),
                            round(1 - bottom / h, 4),
                        ],
                    }
                )
        tp.close()
        page.close()
    return spans


def _dxf_spans(path: Path, extent) -> list[dict]:
    import ezdxf

    doc = ezdxf.readfile(str(path))
    minx, miny, maxx, maxy = extent
    sx, sy = (maxx - minx) or 1.0, (maxy - miny) or 1.0
    spans = []
    for e in doc.modelspace().query("TEXT MTEXT"):
        text = (e.plain_text() if e.dxftype() == "MTEXT" else e.dxf.text).strip()
        if not text:
            continue
        x, y = e.dxf.insert.x, e.dxf.insert.y
        fx, fy = (x - minx) / sx, 1 - (y - miny) / sy
        spans.append({"text": text, "box": [round(fx, 4), round(fy, 4), round(fx, 4), round(fy, 4)]})
    return spans


def drawing_text(handle, drawing_id: str, region=None, *, max_spans: int = 4000) -> TextResult:
    d = _drawing(handle, drawing_id)
    region, _ = clamp_region(region)
    src = Path(d.source_path)
    if d.format not in ("pdf", "dxf"):
        return TextResult(
            [], "This drawing is a raster image with no text layer - read it with drawing_view."
        )
    if not src.exists():
        return TextResult([], "The drawing's source file is not reachable - read it with drawing_view.")
    spans = (
        _pdf_spans(src, d.page or 1) if d.format == "pdf" else _dxf_spans(src, d.extent_src or [0, 0, 1, 1])
    )
    spans = [sp for sp in spans if _overlaps(sp["box"], region)]
    if not spans:
        return TextResult([], "This page has no text layer (a scan?) - read it with drawing_view.")
    return TextResult(spans[:max_spans], "", truncated=len(spans) > max_spans)
