"""Distance to the subject, its uncertainty, and the GSD per stored pixel (spec
2026-09-26-image-inspection §9.3, decision I-D4). A wrong mm is worse than no mm: when no rule
applies there is no distance and the workspace shows px only.

`Scale`/`scale` are unit I-C0's seam (plan 2026-09-27-images-c0, ruling 9), read by unit I-BA's
image measurements; unit I-BK fills them in. `image` is anything with the image columns of spec
§7.3 plus `width`/`height` (the ORM `Image`).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, NamedTuple

from app.db.models import Image

DistanceSource = Literal["manual", "lrf", "rel_alt"]
NADIR_TOLERANCE_DEG = 15.0
LRF_SIGMA_M, LRF_SIGMA_REL = 0.2, 0.002
REL_ALT_SIGMA_M = 1.0  # barometer plus terrain


@dataclass(frozen=True)
class Scale:
    distance_m: float
    distance_sigma_m: float
    distance_source: DistanceSource
    gsd_mm: float  # millimetres per stored-image pixel


class Distance(NamedTuple):
    d_m: float
    sigma_m: float
    source: DistanceSource


def _pos(value) -> float | None:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) and v > 0 else None


def distance(image) -> Distance | None:
    """The first rule that applies: operator value, laser range finder, nadir relative altitude."""
    manual = _pos(getattr(image, "subject_distance_m", None))
    if manual:
        return Distance(manual, 0.0, "manual")
    lrf = _pos(getattr(image, "lrf_distance_m", None))
    if lrf:
        return Distance(lrf, LRF_SIGMA_M + LRF_SIGMA_REL * lrf, "lrf")
    rel, pitch = _pos(getattr(image, "rel_alt", None)), getattr(image, "gimbal_pitch", None)
    if rel and pitch is not None:
        off = abs(float(pitch) + 90.0)
        if off <= NADIR_TOLERANCE_DEG:
            return Distance(rel / math.cos(math.radians(off)), REL_ALT_SIGMA_M, "rel_alt")
    return None


def _stored_long(image) -> int:
    return max(int(image.width or 0), int(image.height or 0))


def focal_px_stored(image) -> float | None:
    """Focal length in pixels of the *stored* frame, which survives the import downscale."""
    stored_long = _stored_long(image)
    if stored_long <= 0:
        return None
    focal_px = _pos(getattr(image, "focal_px", None))
    orig_long = max(int(getattr(image, "orig_w", None) or 0), int(getattr(image, "orig_h", None) or 0))
    if focal_px and orig_long > 0:
        return focal_px * stored_long / orig_long
    focal_mm, sensor_w = _pos(getattr(image, "focal_mm", None)), _pos(getattr(image, "sensor_w_mm", None))
    if focal_mm and sensor_w:
        return focal_mm * stored_long / sensor_w
    return None


def gsd_mm(image, d: Distance | None = None) -> float | None:
    """Ground millimetres per stored pixel; None without a distance or intrinsics."""
    d = d if d is not None else distance(image)
    if d is None:
        return None
    f = focal_px_stored(image)
    return d.d_m * 1000.0 / f if f else None


def scale(image: Image) -> Scale | None:
    """The first distance rule that applies to `image`, and its GSD; None means pixels only."""
    d = distance(image)
    g = gsd_mm(image, d) if d is not None else None
    if d is None or g is None:
        return None
    return Scale(distance_m=d.d_m, distance_sigma_m=d.sigma_m, distance_source=d.source, gsd_mm=g)


def length_sigma_mm(length_mm: float, s: Scale) -> float:
    """σ_L = L·σ_D/D + √2·gsd (spec §9.3)."""
    return length_mm * s.distance_sigma_m / s.distance_m + math.sqrt(2.0) * s.gsd_mm


def area_sigma_m2(area_m2: float, s: Scale) -> float:
    """σ_A ≈ 2A·σ_D/D (spec §9.3)."""
    return 2.0 * area_m2 * s.distance_sigma_m / s.distance_m
