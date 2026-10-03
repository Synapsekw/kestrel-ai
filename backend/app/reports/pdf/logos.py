"""Logos for the PDF without an alpha channel (the kit's "zero /SMask" rule): a PNG with transparency
is composited onto the colour it sits on, then embedded as RGB. Capped at `max_px` a side, so a logo
costs kilobytes. A bad file costs the logo, never the report."""

from __future__ import annotations

import logging
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib.utils import ImageReader

log = logging.getLogger(__name__)


def flat_logo(path: Path | None, background: str = "#FFFFFF", max_px: int = 600) -> ImageReader | None:
    if path is None:
        return None
    bg = tuple(int(background[i : i + 2], 16) for i in (1, 3, 5))
    try:
        with PILImage.open(path) as im:
            im.load()
            if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
                rgba = im.convert("RGBA")
                flat = PILImage.new("RGB", rgba.size, bg)
                flat.paste(rgba, mask=rgba.getchannel("A"))
            else:
                flat = im.convert("RGB")
    except Exception as exc:
        log.warning("logo %s could not be read: %s", path, exc)
        return None
    flat.thumbnail((max_px, max_px), PILImage.Resampling.LANCZOS)
    return ImageReader(flat)
