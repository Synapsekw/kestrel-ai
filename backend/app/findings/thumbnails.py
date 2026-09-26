"""A finding's list thumbnail (spec 2026-09-26-foundation section 8.3): for an image anchor a
160x120 crop around its annotation, cached under `cache/thumbs/findings/` and keyed by the box
geometry, so a moved box gets a new crop; otherwise the first attachment's thumbnail; otherwise 404.
One image read per crop, then the cache (spec section 14)."""

import hashlib
import os
from pathlib import Path
from uuid import uuid4

from PIL import Image as PILImage
from PIL import ImageOps
from sqlalchemy import select

from app.datasets import images
from app.db.models import Box, FindingAttachment, Image
from app.errors import not_found
from app.findings import attachments, service
from app.geometry import aabb_of

SIZE = (160, 120)
PAD = 0.25  # of the box's longer side, on every side
LETTERBOX = (14, 15, 28)  # --bg


def crop_window(
    x: float, y: float, w: float, h: float, angle: float, img_w: int, img_h: int
) -> tuple[int, int, int, int]:
    """A 4:3 window around the box with padding, at least the thumbnail's own size (a small box is
    never blown up into a blur, nor a sub-pixel one into an empty crop), moved (not shrunk) to stay
    inside the image where it fits, clamped where it does not."""
    ax, ay, aw, ah = aabb_of(x, y, w, h, angle)
    side = max(aw, ah) * (1 + 2 * PAD)
    win_w = max(side, ah * (1 + 2 * PAD) * 4 / 3, SIZE[0])
    win_h = win_w * 3 / 4
    win_w, win_h = min(win_w, img_w), min(win_h, img_h)
    cx, cy = ax + aw / 2, ay + ah / 2
    left = min(max(cx - win_w / 2, 0), img_w - win_w)
    top = min(max(cy - win_h / 2, 0), img_h - win_h)
    return round(left), round(top), round(left + win_w), round(top + win_h)


def finding_thumbnail(handle, finding_id: str) -> Path:
    with handle.session() as s:
        f = service.get_or_404(s, finding_id)
        box = s.get(Box, f.annotation_id) if f.annotation_id else None
        image = s.get(Image, f.image_id) if f.image_id else None
        first = s.execute(
            select(FindingAttachment.id)
            .where(FindingAttachment.finding_id == finding_id)
            .order_by(FindingAttachment.created_at, FindingAttachment.id)
            .limit(1)
        ).scalar_one_or_none()
        geometry = (box.x, box.y, box.w, box.h, box.angle) if box is not None else None
        size = (image.width, image.height) if image is not None else None
        image_id = image.id if image is not None else None
    if geometry is not None and size is not None:
        sig = hashlib.sha1(",".join(f"{v:.2f}" for v in geometry).encode()).hexdigest()[:12]
        dest = handle.thumbs_dir / "findings" / f"{finding_id}-{sig}.jpg"
        if not dest.is_file():
            _write_padded(images.image_file(handle, image_id, None), dest, crop_window(*geometry, *size))
        return dest
    if first is not None:
        # The attachment's own thumbnail is 256 px with the photo's aspect; the finding's is 160x120.
        dest = handle.thumbs_dir / "findings" / f"{finding_id}-att-{first}.jpg"
        if not dest.is_file():
            _write_padded(attachments.thumbnail(handle, finding_id, first), dest)
        return dest
    raise not_found("thumbnail", finding_id)


def _write_padded(src: Path, dest: Path, window: tuple[int, int, int, int] | None = None) -> None:
    """`src` (cropped to `window` if given) letterboxed to SIZE, through a temp name and a rename:
    a concurrent reader sees all of it or none."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f"{dest.name}.{uuid4().hex}.tmp")
    try:
        with PILImage.open(src) as im:
            picture = (im.crop(window) if window is not None else im).convert("RGB")
            ImageOps.pad(picture, SIZE, color=LETTERBOX).save(tmp, "JPEG", quality=85)
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)
