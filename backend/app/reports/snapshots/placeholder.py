"""The grey figure printed when a source is missing or unreadable (spec §9.5, §16)."""

from __future__ import annotations

import textwrap

from PIL import Image as PILImage
from PIL import ImageDraw

from app.reports.snapshots.draw import font, text_box

BG = (226, 228, 232)
BORDER = (196, 200, 208)
INK = (70, 76, 88)
TITLE = "Snapshot unavailable"


def render_placeholder(reason: str, size) -> PILImage.Image:
    w, h = int(size[0]), int(size[1])
    img = PILImage.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w - 1, h - 1], outline=BORDER, width=2)
    body = max(10, round(h / 32))
    title_font, body_font = font(body + 4), font(body)
    chars = max(16, int(w / (body * 0.55)))
    lines = [(TITLE, title_font)] + [(line, body_font) for line in textwrap.wrap(reason, chars)[:4]]
    boxes = [text_box(d, text, f) for text, f in lines]
    gap = round(body * 0.6)
    y = (h - (sum(b[1] for b in boxes) + gap * (len(lines) - 1))) / 2
    for (text, f), (tw, th, left, top) in zip(lines, boxes, strict=True):
        d.text(((w - tw) / 2 - left, y - top), text, fill=INK, font=f)
        y += th + gap
    return img
