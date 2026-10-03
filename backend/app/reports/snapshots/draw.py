"""Drawing helpers shared by the snapshot renderers (R3-private).

The font is Pillow's bundled one at a pixel size: it ships inside the pinned pillow wheel, so a
drawing is the same on every machine (no system fonts)."""

from __future__ import annotations

from functools import lru_cache

from PIL import Image as PILImage
from PIL import ImageColor, ImageDraw, ImageFont

WHITE = (255, 255, 255)
INK = (30, 30, 30)
CHIP_BG = (29, 35, 48)
FALLBACK_COLOUR = (229, 175, 100)  # the app's accent amber, as volumes/plan_image.POLYGON
DEFAULT_COLOUR = "#e5af64"  # a spec's default `colour` (same amber as FALLBACK_COLOUR, as a hex string)
PIN_R = 10  # a point geometry's marker radius, in output px


@lru_cache(maxsize=16)
def font(size: int):
    return ImageFont.load_default(size=size)


def rgb(colour) -> tuple[int, int, int]:
    try:
        return tuple(ImageColor.getrgb(str(colour))[:3])
    except ValueError:
        return FALLBACK_COLOUR


def text_box(d: ImageDraw.ImageDraw, text: str, f) -> tuple[int, int, int, int]:
    """(width, height, left, top) of `text`'s ink box; draw at (x - left, y - top) to place it at x, y."""
    left, top, right, bottom = d.textbbox((0, 0), text, font=f)
    return right - left, bottom - top, left, top


_SCRATCH = ImageDraw.Draw(PILImage.new("RGB", (1, 1)))


def chip_size(text: str, size: int = 18, pad: int = 6) -> tuple[int, int]:
    tw, th, _, _ = text_box(_SCRATCH, text, font(size))
    return tw + 2 * pad, th + 2 * pad


def draw_chip(d, xy, text: str, *, size: int = 18, pad: int = 6, bg=CHIP_BG, fg=WHITE) -> tuple[int, ...]:
    """A dark rounded tag with white text, its top-left at `xy`; returns its box."""
    f = font(size)
    tw, th, left, top = text_box(d, text, f)
    x, y = round(xy[0]), round(xy[1])
    box = (x, y, x + tw + 2 * pad, y + th + 2 * pad)
    d.rounded_rectangle(box, radius=4, fill=bg)
    d.text((x + pad - left, y + pad - top), text, fill=fg, font=f)
    return box


def pin(d: ImageDraw.ImageDraw, xy: tuple[float, float], colour) -> None:
    """A point geometry: a solid disc of radius `PIN_R` in `colour`, on a white ring, centred at `xy`
    (shared by `map_view` and `image_crop`, a one-vertex ring is drawn as a pin either way)."""
    cx, cy = xy
    d.ellipse([cx - PIN_R - 3, cy - PIN_R - 3, cx + PIN_R + 3, cy + PIN_R + 3], fill=WHITE)
    d.ellipse([cx - PIN_R, cy - PIN_R, cx + PIN_R, cy + PIN_R], fill=colour)


def paste_inset(
    img, inset, rect, *, colour, fraction: float = 0.25, margin: int = 8, bottom: int = 8
) -> None:
    """In place: `inset` scaled to `fraction` of `img`'s width, `rect` (in `inset`'s own pixels)
    outlined on it, pasted at the bottom-right inside a white frame."""
    tw = max(16, round(img.width * fraction))
    s = tw / inset.width
    th = max(1, round(inset.height * s))
    small = inset.convert("RGB").resize((tw, th), PILImage.LANCZOS)
    x0, y0, x1, y1 = rect
    ImageDraw.Draw(small).rectangle([x0 * s, y0 * s, x1 * s, y1 * s], outline=colour, width=2)
    x, y = img.width - tw - margin, img.height - th - bottom
    ImageDraw.Draw(img).rectangle([x - 2, y - 2, x + tw + 1, y + th + 1], fill=WHITE)
    img.paste(small, (x, y))
