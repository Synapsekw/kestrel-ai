"""Photos for the build agent: the cached downscale for a whole view, the original for a crop."""

from __future__ import annotations

from PIL import Image

from app.asset_models.look import LookError, LookImage, clamp_region, to_jpeg
from app.errors import AppError


def photo_view(handle, image_id: str, region=None, *, max_side: int = 1600) -> LookImage:
    from app.datasets.images import image_file

    region, note = clamp_region(region)
    try:
        path = image_file(handle, image_id, None if region else max_side)
    except AppError:
        raise LookError("There is no photo with that id in this project.") from None
    with Image.open(path) as img:
        if region:
            W, H = img.size
            box = (int(region[0] * W), int(region[1] * H), int(region[2] * W), int(region[3] * H))
            # JPEG: decode the whole frame no larger than needed for the crop to reach max_side
            s = min(1.0, max_side / max(box[2] - box[0], box[3] - box[1], 1))
            img.draft("RGB", (max(1, int(W * s)), max(1, int(H * s))))
            W2, H2 = img.size
            if (W2, H2) != (W, H):
                box = tuple(int(c * W2 / W) if i % 2 == 0 else int(c * H2 / H) for i, c in enumerate(box))
            img = img.crop(box)
        return to_jpeg(img, max_side, note)
