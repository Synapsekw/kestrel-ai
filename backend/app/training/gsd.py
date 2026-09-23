"""The ground sample distance a model was trained at (spec 2026-09-23 sections 2-3).

The invariant: one model-input pixel must cover the same ground distance at inference as it did at
training. Training letterboxes a frame's long side to `imgsz`, so the frame's whole ground width
maps to `imgsz` pixels, and the ground width a frame covers is `alt * sensor_width / focal`.

Nothing here touches the database or decodes image pixels; `registry.py` supplies the rows and the
sampled EXIF.
"""

from __future__ import annotations

from dataclasses import dataclass

TAG_FOCAL_LENGTH = 0x920A
TAG_EXIF_IMAGE_WIDTH = 0xA002
TAG_FOCAL_35MM = 0xA405
TAG_FOCAL_PLANE_X_RES = 0xA20E
TAG_FOCAL_PLANE_UNIT = 0xA210
EXIF_IFD = 0x8769

#: FocalPlaneResolutionUnit to millimetres per unit: 2 = inch, 3 = centimetre.
UNIT_MM = {2: 25.4, 3: 10.0}
FULL_FRAME_WIDTH_MM = 36.0

#: Camera intrinsics are a property of the camera, not the frame, so a handful of headers settles
#: them. This is what keeps the estimate a bounded read.
EXIF_SAMPLE = 8

#: The band a median labelled object must fall in for an estimate to be offered as a default.
#: Deliberately wide: a smoke alarm for an order-of-magnitude error, not a judgement about what
#: the operator is detecting.
PLAUSIBLE_M = (2.0, 25.0)


@dataclass(frozen=True)
class Intrinsics:
    focal_mm: float
    sensor_width_mm: float
    source: str  # focal_plane | crop_factor


def _num(value) -> float | None:
    """EXIF numbers arrive as IFDRational, tuple or str depending on the writer."""
    if value is None:
        return None
    try:
        if isinstance(value, tuple) and len(value) == 2:
            return float(value[0]) / float(value[1])
        return float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def intrinsics_from_exif(exif) -> Intrinsics | None:
    """Focal length and sensor width, or None when the lens cannot be established.

    Focal-plane resolution is preferred because it measures the sensor directly. The 35 mm crop
    factor is the fallback; on the Aeria X the two agree to within 1.5 %.
    """
    ifd = exif.get_ifd(EXIF_IFD)
    focal = _num(ifd.get(TAG_FOCAL_LENGTH))
    if not focal:
        return None

    width = _num(ifd.get(TAG_EXIF_IMAGE_WIDTH))
    per_unit = _num(ifd.get(TAG_FOCAL_PLANE_X_RES))
    unit = ifd.get(TAG_FOCAL_PLANE_UNIT)
    if width and per_unit and unit in UNIT_MM:
        return Intrinsics(focal, (width / per_unit) * UNIT_MM[unit], "focal_plane")

    focal_35 = _num(ifd.get(TAG_FOCAL_35MM))
    if focal_35:
        return Intrinsics(focal, FULL_FRAME_WIDTH_MM * focal / focal_35, "crop_factor")
    return None


def image_gsd_cm(alt_m: float, intr: Intrinsics, stored_width_px: int) -> float:
    """Ground centimetres per pixel of the *stored* training image."""
    ground_width_cm = alt_m * 100.0 * intr.sensor_width_mm / intr.focal_mm
    return ground_width_cm / stored_width_px


def model_gsd_cm(image_gsd: float, stored_w: int, stored_h: int, imgsz: int) -> float:
    """Ground centimetres per *model-input* pixel: the letterbox scales the long side to imgsz."""
    return image_gsd * max(stored_w, stored_h) / imgsz


def plausible(median_object_m: float) -> bool:
    lo, hi = PLAUSIBLE_M
    return lo <= median_object_m <= hi
