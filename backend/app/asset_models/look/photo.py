"""Photos for the build agent: the cached downscale for a whole view, the original for a crop."""

from __future__ import annotations

from PIL import Image

from app.asset_models.look import LookError, LookImage, clamp_region, to_jpeg
from app.errors import AppError


def _box(region, W: int, H: int) -> tuple[int, int, int, int]:
    """Pixel crop box for a fractional region: at least 1 px a side, inside the W x H frame."""
    x0 = min(int(region[0] * W), W - 1)
    y0 = min(int(region[1] * H), H - 1)
    x1 = min(max(int(region[2] * W), x0 + 1), W)
    y1 = min(max(int(region[3] * H), y0 + 1), H)
    return (x0, y0, x1, y1)


def photo_view(handle, image_id: str, region=None, *, max_side: int = 1600) -> LookImage:
    from app.datasets.images import get_image, image_file

    region, note = clamp_region(region)
    try:
        get_image(handle, image_id)  # the row: absent means no such photo
    except AppError:
        raise LookError("There is no photo with that id in this project.") from None
    try:
        path = image_file(handle, image_id, None if region else max_side)
    except (AppError, OSError):  # the row exists, so the file is what is missing
        raise LookError("The photo's file is not reachable.") from None
    with Image.open(path) as img:
        if region:
            W, H = img.size
            box = _box(region, W, H)
            # JPEG: decode the whole frame no larger than needed for the crop to reach max_side
            s = min(1.0, max_side / max(box[2] - box[0], box[3] - box[1], 1))
            img.draft("RGB", (max(1, int(W * s)), max(1, int(H * s))))
            W2, H2 = img.size
            if (W2, H2) != (W, H):
                box = _box([c / (W if i % 2 == 0 else H) for i, c in enumerate(box)], W2, H2)
            img = img.crop(box)
        return to_jpeg(img, max_side, note)
