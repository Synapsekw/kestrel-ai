"""Image crop snapshots (spec §9.2): the annotation's ring on a 4:3 crop of its photo.

The spec carries the ring in stored-image pixels (I §8.1). Stored copies are already
EXIF-transposed with orientation 1 (datasets/prepare.py), so nothing here transposes. A one-vertex
ring is a point and is drawn as a pin. The JPEG draft decodes a large crop at 1/2, 1/4 or 1/8 scale,
so a 20 MP photo decodes at 5 MP or less when the defect is large."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from PIL import Image as PILImage
from PIL import ImageDraw
from shapely.geometry import Polygon

from app.db.models import Box, Image
from app.geometry import corners_of
from app.reports.snapshots import MISSING, SnapshotUnavailable, opt, out_of
from app.reports.snapshots.draw import (
    DEFAULT_COLOUR,
    PIN_R,
    WHITE,
    chip_size,
    draw_chip,
    paste_inset,
    pin,
    rgb,
)

CONTEXT_FLOOR_PX = 512
REDUCTIONS = (8, 4, 2)
MAX_RING_VERTICES = 200
RING_PX, HALO_PX = 4, 2
UNREADABLE = "The image file cannot be read"

log = logging.getLogger(__name__)


def too_large() -> str:
    return f"The image is too large to print (over {PILImage.MAX_IMAGE_PIXELS // 1_000_000} MP)"


def compact_ring(points, max_vertices: int = MAX_RING_VERTICES) -> list[list[float]]:
    """The ring rounded to 0.1 px, simplified (Douglas-Peucker, doubling tolerance from 0.5 px)
    until it has at most `max_vertices` vertices, so a SAM polygon still fits a URL."""
    ring = [[round(float(p[0]), 1), round(float(p[1]), 1)] for p in points]
    if len(ring) <= max_vertices or len(ring) < 4:
        return ring
    poly, tol = Polygon(ring), 0.5
    coords = ring
    while len(coords) > max_vertices and tol < 1e6:
        simple = poly.simplify(tol, preserve_topology=True)
        if simple.geom_type == "Polygon" and not simple.is_empty:
            coords = [list(c) for c in simple.exterior.coords[:-1]]
        tol *= 2
    return [[round(x, 1), round(y, 1)] for x, y in coords]


def ring_of(
    shape: str, x: float, y: float, w: float, h: float, angle: float = 0.0, points=None
) -> list[list[float]]:
    """An annotation (I §8.1) as the ring an `image_crop` spec carries: a point is one vertex, a
    box or rbox its four corners (`app.geometry.corners_of`, as exports/html_out.py draws them), a
    polygon its ring, compacted."""
    if shape == "point":
        return [[round(float(x), 1), round(float(y), 1)]]
    if shape == "polygon" and points:
        return compact_ring(points)
    return [[round(px, 1), round(py, 1)] for px, py in corners_of(x, y, w, h, angle or 0.0)]


def crop_box(
    ring, img_w: int, img_h: int, *, context: float, aspect: float, floor_px: float = CONTEXT_FLOOR_PX
):
    """The ring's bbox grown to `context` times its size (at least `floor_px` a side), widened to
    `aspect`, capped at the image, then shifted inside the image, never clipped. Integer
    (x0, y0, x1, y1) in source pixels."""
    if not ring:
        raise SnapshotUnavailable("The annotation has no geometry")
    xs = [float(p[0]) for p in ring]
    ys = [float(p[1]) for p in ring]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    w = max((max(xs) - min(xs)) * context, floor_px)
    h = max((max(ys) - min(ys)) * context, floor_px)
    if w / h < aspect:
        w = h * aspect
    else:
        h = w / aspect
    s = min(1.0, img_w / w, img_h / h)
    w, h = w * s, h * s
    x0 = min(max(cx - w / 2, 0.0), img_w - w)
    y0 = min(max(cy - h / 2, 0.0), img_h - h)
    return (max(0, round(x0)), max(0, round(y0)), min(img_w, round(x0 + w)), min(img_h, round(y0 + h)))


def pick_reduction(crop_w: float, crop_h: float, out_w: int, out_h: int) -> int:
    """The largest JPEG decode reduction that keeps the crop at least `out` in size."""
    for r in REDUCTIONS:
        if crop_w / r >= out_w and crop_h / r >= out_h:
            return r
    return 1


@dataclass(frozen=True)
class DecodedCrop:
    region: PILImage.Image  # RGB: the crop at the decoded scale
    box: tuple[int, int, int, int]  # in source pixels
    reduction: int
    decoded_size: tuple[int, int]
    full_size: tuple[int, int]


def decode_crop(path: Path, ring, *, context: float, out) -> DecodedCrop:
    out_w, out_h = int(out[0]), int(out[1])
    try:
        with PILImage.open(path) as im:
            full = im.size
            # Explicit bomb-guard (amendment A11): `warnings.catch_warnings`/`simplefilter` toggle a
            # process-global filter, which is not thread-safe with two concurrent render slots.
            limit = PILImage.MAX_IMAGE_PIXELS
            if limit is not None and full[0] * full[1] > limit:
                raise SnapshotUnavailable(too_large())
            box = crop_box(ring, full[0], full[1], context=context, aspect=out_w / out_h)
            r = pick_reduction(box[2] - box[0], box[3] - box[1], out_w, out_h)
            if r > 1 and im.format == "JPEG":
                im.draft("RGB", (full[0] // r, full[1] // r))
            im.load()
            fx, fy = im.size[0] / full[0], im.size[1] / full[1]
            region = im.crop((round(box[0] * fx), round(box[1] * fy), round(box[2] * fx), round(box[3] * fy)))
            decoded = im.size
    except PILImage.DecompressionBombError:
        raise SnapshotUnavailable(too_large()) from None
    except (OSError, SyntaxError, ValueError):
        raise SnapshotUnavailable(UNREADABLE) from None
    if region.mode != "RGB":
        region = region.convert("RGB")
    return DecodedCrop(region, box, r, decoded, full)


def render_crop(path: Path, ring, *, colour, label, context: float, out, inset_path: Path | None = None):
    out_w, out_h = int(out[0]), int(out[1])
    crop = decode_crop(path, ring, context=context, out=(out_w, out_h))
    img = crop.region.resize((out_w, out_h), PILImage.LANCZOS)
    x0, y0, x1, y1 = crop.box
    sx, sy = out_w / (x1 - x0), out_h / (y1 - y0)
    pts = [((float(p[0]) - x0) * sx, (float(p[1]) - y0) * sy) for p in ring]
    c = rgb(colour)
    d = ImageDraw.Draw(img)
    lift = 0
    if len(pts) == 1:
        pin(d, pts[0], c)  # draw.pin: white ring + fill (shared with map_view, amendment A16)
        lift = PIN_R + 3
    else:
        closed = pts + [pts[0]]
        d.line(closed, fill=WHITE, width=RING_PX + 2 * HALO_PX, joint="curve")
        d.line(closed, fill=c, width=RING_PX, joint="curve")
    if label:
        cw, ch = chip_size(label)
        bx, by = min(p[0] for p in pts), min(p[1] for p in pts)
        x = min(max(bx, 4), out_w - cw - 4)
        y = min(max(by - ch - 8 - lift, 4), out_h - ch - 4)
        draw_chip(d, (x, y), label)
    if inset_path is not None:
        with PILImage.open(inset_path) as thumb:
            thumb.load()
            s = thumb.width / crop.full_size[0]
            paste_inset(img, thumb, (x0 * s, y0 * s, x1 * s, y1 * s), colour=c)
    return img


def _image_file(handle, image_id: str) -> Path | str:
    """The photo's path, or the operator's reason it is missing."""
    with handle.session() as s:
        row = s.get(Image, image_id)
        if row is None:
            return "The image was deleted"
        rel = row.path
    path = Path(handle.folder) / rel
    return path if path.is_file() else "The image file is missing"


def source_version(handle, spec) -> str:
    """The file's size and mtime plus the annotation's `updated_at` (spec §9.1)."""
    found = _image_file(handle, spec.image_id)
    if isinstance(found, str):
        return MISSING + found
    updated = ""
    annotation_id = opt(spec, "annotation_id")
    if annotation_id:
        with handle.session() as s:
            box = s.get(Box, annotation_id)
            if box is None:
                return MISSING + "The annotation was deleted"
            updated = box.updated_at.isoformat() if box.updated_at else ""
    try:
        st = found.stat()
    except OSError:
        return MISSING + "The image file is missing"
    return f"{st.st_size}:{st.st_mtime_ns}:{updated}"


def render(handle, spec) -> PILImage.Image:
    found = _image_file(handle, spec.image_id)
    if isinstance(found, str):
        raise SnapshotUnavailable(found)
    inset = None
    if opt(spec, "inset", False):
        from app.datasets import images
        from app.errors import AppError

        try:
            inset = images.thumbnail(handle, spec.image_id)  # the 256 px thumbnail, never the original
        except (AppError, OSError):
            log.warning("image_crop: inset thumbnail failed for image %s", spec.image_id, exc_info=True)
            inset = None
    return render_crop(
        found,
        spec.ring,
        colour=opt(spec, "colour", DEFAULT_COLOUR),
        label=opt(spec, "label"),
        context=float(opt(spec, "context", 3.0)),
        out=out_of(spec),
        inset_path=inset,
    )
