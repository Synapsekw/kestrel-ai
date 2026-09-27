"""Helpers for the report-view tests (unit C-B4): images of the exact view size and a valid meta."""

import io
import json

from PIL import Image

META = {
    "pose": {
        "position": [243540.2, 3178030.5, 12.4],
        "target": [243552.0, 3178041.0, -20.1],
        "up": [0, 0, 1],
        "fov_deg": 50,
    },
    "render": {
        "colour_mode": "rgb",
        "point_budget": 3000000,
        "point_size": 1.4,
        "edl": True,
        "clip_box": None,
        "complete": True,
    },
}


def meta_json(**changes) -> str:
    return json.dumps({**META, **changes})


def _save(im: Image.Image, fmt: str, **kw) -> bytes:
    buf = io.BytesIO()
    im.save(buf, fmt, **kw)
    return buf.getvalue()


def png(w: int = 1600, h: int = 1000, colour=(40, 90, 160)) -> bytes:
    return _save(Image.new("RGB", (w, h), colour), "PNG")


def jpeg(w: int = 1600, h: int = 1000, colour=(160, 90, 40)) -> bytes:
    return _save(Image.new("RGB", (w, h), colour), "JPEG", quality=92)


def noise_png(w: int = 1600, h: int = 1000) -> bytes:
    """A PNG whose data does not compress away, so a truncation lands inside the pixel data."""
    return _save(Image.effect_noise((w, h), 64).convert("RGB"), "PNG")


def gif(w: int = 1600, h: int = 1000) -> bytes:
    return _save(Image.new("P", (w, h)), "GIF")
