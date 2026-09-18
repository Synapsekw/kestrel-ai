"""Tiling geometry and per-class NMS shared by every provider (spec section 8, Tiling)."""

from __future__ import annotations

from PIL import Image as PILImage

from app.providers.base import Detection, Tile, TilingSpec


def _origins(dim: int, tile: int, stride: int) -> list[int]:
    """Tile origins along one axis. The last tile is shifted back so no tile leaves the image."""
    if dim <= tile:
        return [0]
    out: list[int] = []
    o = 0
    while o + tile <= dim:
        out.append(o)
        o += stride
    if out[-1] + tile < dim:
        out.append(dim - tile)
    return out


def make_tiles(width: int, height: int, spec: TilingSpec) -> list[Tile]:
    """Row-major tiles covering the image; one tile when tiling is off or the image fits."""
    if not spec.enabled or (width <= spec.tile_size and height <= spec.tile_size):
        return [Tile(index=0, x=0, y=0, w=width, h=height)]
    stride = max(1, int(round(spec.tile_size * (1.0 - spec.overlap))))
    xs = _origins(width, spec.tile_size, stride)
    ys = _origins(height, spec.tile_size, stride)
    return [
        Tile(index=i, x=x, y=y, w=spec.tile_size, h=spec.tile_size)
        for i, (y, x) in enumerate((y, x) for y in ys for x in xs)
    ]


def crop_tile(image: PILImage.Image, tile: Tile) -> PILImage.Image:
    return image.crop((tile.x, tile.y, tile.x + tile.w, tile.y + tile.h))


def to_full_image(det: Detection, tile: Tile) -> Detection:
    """Offset a tile-local detection into full-image pixels, clamped to the tile window."""
    x0 = min(max(det.x, 0.0), float(tile.w))
    y0 = min(max(det.y, 0.0), float(tile.h))
    x1 = min(max(det.x + det.w, 0.0), float(tile.w))
    y1 = min(max(det.y + det.h, 0.0), float(tile.h))
    return Detection(
        label=det.label,
        x=x0 + tile.x,
        y=y0 + tile.y,
        w=x1 - x0,
        h=y1 - y0,
        confidence=det.confidence,
        raw_ref=det.raw_ref,
    )


def iou(a: Detection, b: Detection) -> float:
    ix = min(a.x + a.w, b.x + b.w) - max(a.x, b.x)
    iy = min(a.y + a.h, b.y + b.h) - max(a.y, b.y)
    if ix <= 0 or iy <= 0:
        return 0.0
    inter = ix * iy
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0


def nms_per_class(dets: list[Detection], iou_threshold: float) -> list[Detection]:
    """Greedy non-maximum suppression, highest confidence first, within each label."""
    kept: list[Detection] = []
    by_label: dict[str, list[Detection]] = {}
    for d in dets:
        by_label.setdefault(d.label, []).append(d)
    for label in sorted(by_label):
        for candidate in sorted(by_label[label], key=lambda d: -d.confidence):
            if all(iou(candidate, k) < iou_threshold for k in kept if k.label == label):
                kept.append(candidate)
    return kept
