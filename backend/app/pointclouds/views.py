"""Stored report views (spec 2026-09-26-point-cloud-workspace section 11; reports spec section 9.4).

Every cloud finding and cloud measurement keeps one picture the workspace rendered (the backend
cannot render the BROTLI octree), with the pose and render settings that took it. The file lives at
`pointclouds/<cloud_id>/views/<subject_kind>-<subject_id>.<png|jpg>`, written through
`views/.partial-<hex>` and an atomic replace, then the `cloud_view` row is upserted. `stale` is
computed on read from `anchor_hash`. R's report job reads views in-process through `stored_view`.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import re

from PIL import Image as PILImage
from PIL import UnidentifiedImageError
from pydantic import ValidationError

from app.errors import AppError
from app.pointclouds.schemas import CloudViewMeta

log = logging.getLogger(__name__)

WIDTH, HEIGHT = 1600, 1000  # R's print size, aspect 1.6 (spec section 11.1)
MAX_BYTES = 6 * 1024 * 1024
MAX_META_BYTES = 64 * 1024
MAX_LISTED = 1500  # 500 pins + 1 000 measurements (spec section 13)
SWEEP_GRACE_S = 60.0  # a sweep never touches a file younger than this: it may be an in-flight PUT's
PARTIAL = ".partial-"
FORMATS = {"PNG": ("png", "image/png"), "JPEG": ("jpg", "image/jpeg")}
MEDIA = {"png": "image/png", "jpg": "image/jpeg"}
VIEW_FILE = re.compile(r"^(finding|cloud_measurement)-[0-9A-Za-z-]+\.(png|jpg)$")


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _mm(v: float) -> int:
    return round(float(v) * 1000)


def finding_hash(x: float, y: float, z: float) -> str:
    """A cloud finding's anchor, rounded to the millimetre."""
    return _sha(json.dumps([_mm(x), _mm(y), _mm(z)]))


def measurement_hash(points: list[dict]) -> str:
    """A measurement's points (millimetres) and their rings `group`; `uncertainty_m` is not geometry."""
    return _sha(json.dumps([[_mm(p["x"]), _mm(p["y"]), _mm(p["z"]), p.get("group")] for p in points]))


def bad_image(reason: str, message: str) -> AppError:
    return AppError("bad_view_image", message, 422, {"reason": reason})


def check_image(data: bytes) -> str:
    """The extension (`png` | `jpg`) of a valid view image, else 422 `bad_view_image {reason}`.

    Bounded: the size cap first, then Pillow's header read, then (only at exactly 1600 x 1000) one
    decode, which catches truncated or corrupt pixel data."""
    if len(data) > MAX_BYTES:
        raise bad_image("too_large", f"the view is {len(data) / 1024 / 1024:.1f} MiB; the limit is 6 MiB")
    try:
        with PILImage.open(io.BytesIO(data)) as im:
            fmt, size = im.format, im.size
            if fmt not in FORMATS:
                raise bad_image("wrong_format", f"the view is a {fmt} image; send a PNG or a JPEG")
            if size != (WIDTH, HEIGHT):
                raise bad_image("wrong_size", f"the view is {size[0]} x {size[1]}; it must be 1600 x 1000")
            im.load()
    except AppError:
        raise
    except (UnidentifiedImageError, PILImage.DecompressionBombError, OSError, SyntaxError, ValueError) as e:
        raise bad_image("not_an_image", "the view is not a readable PNG or JPEG") from e
    return FORMATS[fmt][0]


def _invalid(message: str) -> AppError:
    return AppError("validation_error", message, 422)


def parse_meta(raw: str | bytes, subject_kind: str) -> CloudViewMeta:
    """The upload's `meta` part, validated; every number finite; a finding's normal made unit length
    (null when zero), a measurement's dropped (spec section 9.1: findings only)."""
    if len(raw) > MAX_META_BYTES:
        raise _invalid("the view's meta is over 64 KiB")
    try:
        meta = CloudViewMeta.model_validate_json(raw)
    except ValidationError as e:
        first = e.errors()[0]
        where = ".".join(str(p) for p in first.get("loc", ()))
        raise _invalid(f"the view's meta is not valid: {where} {first.get('msg', '')}".strip()) from e
    pose, render = meta.pose, meta.render
    numbers = [*pose.position, *pose.target, *pose.up, pose.fov_deg, render.point_size]
    numbers += list(meta.anchor_normal or [])
    if render.clip_box is not None:
        numbers += [*render.clip_box.centre, *render.clip_box.size, render.clip_box.yaw_deg]
    if not all(math.isfinite(v) for v in numbers):
        raise _invalid("the view's meta has a number that is not finite")
    normal = None
    if subject_kind == "finding" and meta.anchor_normal is not None:
        length = math.sqrt(sum(v * v for v in meta.anchor_normal))
        normal = [v / length for v in meta.anchor_normal] if length > 1e-9 else None
    return meta.model_copy(update={"anchor_normal": normal})
