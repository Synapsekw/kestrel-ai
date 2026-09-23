"""Where the detector looks on a map, and how its boxes are merged (spec section 6).

Windows are planned on a *virtual* map scaled to the model's training GSD, using the same
`make_tiles` as query runs, and mapped back to map pixels, so the read size and the model input
size can differ. Merging is per strip: a box that ends above the current strip's top can no longer
overlap anything still to come, so it is released and memory stays bounded by about two strips.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import groupby

import numpy as np

from app.providers.base import Detection, TilingSpec
from app.providers.tiling import make_tiles, nms_per_class

GSD_TOLERANCE = 0.15
SKIP_MASKED = 0.99


@dataclass(frozen=True)
class MapWindow:
    index: int
    x: int
    y: int
    w: int
    h: int
    out_w: int
    out_h: int


def gsd_scale(map_gsd_cm: float | None, target_gsd_cm: float | None) -> float:
    if not map_gsd_cm or not target_gsd_cm:
        return 1.0
    scale = map_gsd_cm / target_gsd_cm
    return 1.0 if abs(1.0 - scale) <= GSD_TOLERANCE else scale


def plan_windows(width: int, height: int, tile_size: int, overlap: float, scale: float) -> list[MapWindow]:
    vw, vh = max(1, round(width * scale)), max(1, round(height * scale))
    out: list[MapWindow] = []
    for t in make_tiles(vw, vh, TilingSpec(True, tile_size, overlap, 0.5)):
        x, y = int(t.x / scale), int(t.y / scale)
        x1 = width if t.x + t.w >= vw else min(width, math.ceil((t.x + t.w) / scale))
        y1 = height if t.y + t.h >= vh else min(height, math.ceil((t.y + t.h) / scale))
        out.append(MapWindow(t.index, x, y, x1 - x, y1 - y, t.w, t.h))
    return out


def strips(windows: list[MapWindow]) -> list[list[MapWindow]]:
    return [list(group) for _, group in groupby(windows, key=lambda w: w.y)]


def to_map(det: Detection, win: MapWindow) -> Detection:
    sx, sy = win.w / win.out_w, win.h / win.out_h
    return Detection(
        label=det.label,
        x=win.x + det.x * sx,
        y=win.y + det.y * sy,
        w=det.w * sx,
        h=det.h * sy,
        confidence=det.confidence,
        raw_ref=det.raw_ref,
    )


def masked_fraction(mask: np.ndarray, mask_scale: float, win: MapWindow) -> float:
    """Share of the window that is nodata, looked up in a low-resolution validity mask."""
    y0, x0 = int(win.y * mask_scale), int(win.x * mask_scale)
    y1 = max(y0 + 1, math.ceil((win.y + win.h) * mask_scale))
    x1 = max(x0 + 1, math.ceil((win.x + win.w) * mask_scale))
    sub = mask[y0:y1, x0:x1]
    return 1.0 - float(sub.mean()) if sub.size else 1.0


EDGE_MARGIN = 2.0  # model pixels: a box within this of a window edge is cut by it


def drop_cut_boxes(
    dets: list[Detection], win: MapWindow, width: int, height: int, overlap_px: int
) -> list[Detection]:
    """Drop boxes cut by an interior window edge when the neighbour must hold the whole object.

    A sliver at a seam and the neighbour's full box rarely reach the NMS IoU, so without this a
    machine on a seam counts twice. The neighbour window starts `overlap` before this one ends, so
    an object whose visible part is shorter than the overlap lies entirely inside the neighbour.
    """
    sx, sy = win.w / win.out_w, win.h / win.out_h
    mx, my = EDGE_MARGIN * sx, EDGE_MARGIN * sy
    ox, oy = overlap_px * sx, overlap_px * sy
    left, top, right, bottom = win.x, win.y, win.x + win.w, win.y + win.h
    kept = []
    for d in dets:
        cut = (
            (left > 0 and d.x <= left + mx and d.w < ox)
            or (right < width and d.x + d.w >= right - mx and d.w < ox)
            or (top > 0 and d.y <= top + my and d.h < oy)
            or (bottom < height and d.y + d.h >= bottom - my and d.h < oy)
        )
        if not cut:
            kept.append(d)
    return kept


class StripMerger:
    def __init__(self, nms_iou: float):
        self.nms_iou = nms_iou
        self.pending: list[Detection] = []

    def add_strip(self, top: float, dets: list[Detection]) -> list[Detection]:
        """Merge a new strip's boxes; returns the boxes that are now final."""
        final = [d for d in self.pending if d.y + d.h <= top]
        rest = [d for d in self.pending if d.y + d.h > top]
        self.pending = nms_per_class(rest + list(dets), self.nms_iou)
        return final

    def finish(self) -> list[Detection]:
        out, self.pending = self.pending, []
        return out
