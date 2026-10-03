"""`kestrel-backend.exe review-import-selftest`: proves the frozen bundle carries ijson (and names
the backend it chose; the cp311 wheel's compiled `yajl2_c` is expected) and the cv2 contour
functions the review kit import uses. Prints `review-import ok <backend> <items> <rings>`."""

from __future__ import annotations


def main() -> int:
    import io

    import ijson
    import numpy as np

    from app.asset_review.kit_masks import vectorise

    doc = b'{"patches": [{"photo": "p1", "center": [1.5, 2.0, 3.0]}, {"photo": "p2", "center": [0, 0, 0]}]}'
    items = list(ijson.items(io.BytesIO(doc), "patches.item", use_float=True))
    mask = np.zeros((40, 60), np.uint8)
    mask[5:15, 5:25] = 2
    mask[25:35, 30:55] = 1
    rings = vectorise(mask, {1, 2, 3})
    print(f"review-import ok {ijson.backend} {len(items)} {len(rings)}")
    return 0
