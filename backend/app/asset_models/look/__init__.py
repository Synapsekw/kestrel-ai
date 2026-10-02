"""What the build agent can look at (spec 2026-10-02 §7.3). Every read is bounded."""

from __future__ import annotations

import io
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


def clamp_region(region) -> tuple[list[float] | None, str]:
    if region is None:
        return None, ""
    x0, y0, x1, y1 = (min(max(float(v), 0.0), 1.0) for v in region)
    if x1 - x0 < 1e-3 or y1 - y0 < 1e-3:
        raise LookError("The region is empty. Give [x0, y0, x1, y1] as fractions with x1 > x0 and y1 > y0.")
    note = "region clipped to the page" if [x0, y0, x1, y1] != list(map(float, region)) else ""
    return [x0, y0, x1, y1], note
