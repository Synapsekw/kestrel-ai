"""256 px tiles in the map's pixel grid (spec section 5).

At zoom z one tile pixel covers 2^(max_zoom - z) map pixels; z = max_zoom is full resolution and
z = 0 fits the whole map in one tile. Each tile is one windowed read whose output is at most
256 x 256, which GDAL serves from the matching overview, so a tile costs the same on any map.
"""

from __future__ import annotations

import io
import math
import threading
from collections import OrderedDict
from dataclasses import dataclass

import numpy as np
from PIL import Image as PILImage

from app.maps import raster

TILE = 256
JPEG_QUALITY = 90  # match raster.JPEG_QUALITY: re-encoding below the display raster's own quality
# adds a second, avoidable round of loss (measured mean abs diff ~9.4/255 at 85 vs ~6.7/255 at 90)
CACHE_ITEMS = 512


@dataclass(frozen=True)
class TileWindow:
    x: int
    y: int
    w: int
    h: int
    out_w: int
    out_h: int


def max_zoom(width: int, height: int) -> int:
    return max(0, math.ceil(math.log2(max(width, height) / TILE))) if max(width, height) > TILE else 0


def tile_window(z: int, x: int, y: int, width: int, height: int, mz: int) -> TileWindow | None:
    if z > mz:
        return None
    res = 2 ** (mz - z)
    size = TILE * res
    x0, y0 = x * size, y * size
    if x0 >= width or y0 >= height:
        return None
    w, h = min(size, width - x0), min(size, height - y0)
    return TileWindow(x0, y0, w, h, max(1, round(w / res)), max(1, round(h / res)))


def render_tile(src, width: int, height: int, z: int, x: int, y: int) -> tuple[bytes, str] | None:
    win = tile_window(z, x, y, width, height, max_zoom(width, height))
    if win is None:
        return None
    rgb, valid = raster.read_rgb(src, win.x, win.y, win.w, win.h, win.out_w, win.out_h)
    if not valid.any():
        return None
    buf = io.BytesIO()
    if valid.all() and (win.out_w, win.out_h) == (TILE, TILE):
        PILImage.fromarray(rgb, "RGB").save(buf, "JPEG", quality=JPEG_QUALITY)
        return buf.getvalue(), "image/jpeg"
    canvas = np.zeros((TILE, TILE, 4), dtype=np.uint8)
    canvas[: win.out_h, : win.out_w, :3] = rgb
    canvas[: win.out_h, : win.out_w, 3] = np.where(valid, 255, 0)
    PILImage.fromarray(canvas, "RGBA").save(buf, "PNG", optimize=False)
    return buf.getvalue(), "image/png"


class TileCache:
    """Recently served tiles; a map's display raster never changes, so entries never go stale."""

    def __init__(self, max_items: int = CACHE_ITEMS):
        self.max_items = max_items
        self._items: OrderedDict[tuple, tuple[bytes, str] | None] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: tuple):
        with self._lock:
            if key not in self._items:
                return None
            self._items.move_to_end(key)
            return self._items[key]

    def put(self, key: tuple, value) -> None:
        with self._lock:
            self._items[key] = value
            self._items.move_to_end(key)
            while len(self._items) > self.max_items:
                self._items.popitem(last=False)

    def drop_map(self, map_id: str) -> None:
        with self._lock:
            for key in [k for k in self._items if k[1] == map_id]:
                del self._items[key]


TILE_CACHE = TileCache()
