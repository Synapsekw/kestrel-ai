"""What the build agent can look at (spec 2026-10-02 §7.3). Every read is bounded."""

from __future__ import annotations

import io
import math
from dataclasses import dataclass

from PIL import Image


@dataclass(frozen=True)
class LookImage:
    jpeg: bytes
    width: int
    height: int
    note: str = ""


class LookError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def to_jpeg(img: Image.Image, max_side: int, note: str = "") -> LookImage:
    img = img.convert("RGB")
    img.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return LookImage(buf.getvalue(), img.width, img.height, note)


def finite_numbers(values, n: int) -> list[float] | None:
    """`values` as n finite floats, or None when it is not a sequence of exactly n finite numbers."""
    if isinstance(values, (str, bytes)) or not hasattr(values, "__len__") or len(values) != n:
        return None
    try:
        out = [float(v) for v in values]
    except (TypeError, ValueError):
        return None
    return out if all(math.isfinite(v) for v in out) else None


def clamp_region(region) -> tuple[list[float] | None, str]:
    if region is None:
        return None, ""
    vals = finite_numbers(region, 4)
    if vals is None:
        raise LookError(
            "The region must be [x0, y0, x1, y1]: four numbers, as fractions of the page (0 to 1)."
        )
    x0, y0, x1, y1 = (min(max(v, 0.0), 1.0) for v in vals)
    if x1 - x0 < 1e-3 or y1 - y0 < 1e-3:
        raise LookError("The region is empty. Give [x0, y0, x1, y1] as fractions with x1 > x0 and y1 > y0.")
    note = "region clipped to the page" if [x0, y0, x1, y1] != vals else ""
    return [x0, y0, x1, y1], note
