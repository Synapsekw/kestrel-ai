"""Image preparation ported from E:\\Dev\\Yolo\\scripts\\prepare_images.py.

Pure functions only: `process_one` runs in a worker process, so it must be importable at module
level, take and return picklable values, and never raise (a failure is reported in the result).
"""

from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import imagehash
import piexif
from PIL import Image, ImageOps

from app.library.gsd import intrinsics_from_exif  # pure: no DB, safe in the worker process

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
EXIF_IFD, GPS_IFD = 0x8769, 0x8825
TAG_ORIENTATION, TAG_DATETIME_ORIGINAL = 0x0112, 36867
TAG_MODEL, TAG_EXIF_IMAGE_WIDTH, TAG_EXIF_IMAGE_HEIGHT = 0x0110, 0xA002, 0xA003
#: Must equal `app.datasets.images.THUMB_SIDE` (pinned by tests/test_prepare.py).
THUMB_SIDE, THUMB_QUALITY = 256, 85
LRF_MAX_M = 2000.0

#: DJI XMP key -> image column (spec 2026-09-26-image-inspection §7.3). Pose names are frozen:
#: the point-cloud sub-project reads them.
XMP_FIELDS = {
    "RelativeAltitude": "rel_alt",
    "GimbalPitchDegree": "gimbal_pitch",
    "GimbalYawDegree": "gimbal_yaw",
    "GimbalRollDegree": "gimbal_roll",
    "FlightYawDegree": "flight_yaw",
    "CalibratedFocalLength": "focal_px",
}
CAMERA_FIELDS = (
    "rel_alt",
    "gimbal_pitch",
    "gimbal_yaw",
    "gimbal_roll",
    "flight_yaw",
    "lrf_distance_m",
    "focal_px",
    "focal_mm",
    "sensor_w_mm",
    "orig_w",
    "orig_h",
    "camera_model",
)
_XMP_ATTR = re.compile(rb'drone-dji:(\w+)\s*=\s*"([^"]*)"')
_XMP_ELEM = re.compile(rb"<drone-dji:(\w+)>([^<]*)</drone-dji:\1>")


def list_images(folder: Path) -> list[Path]:
    return sorted(p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTS)


def unique_dest(dest_dir: Path, stem: str, taken: set[str]) -> Path:
    """Avoid collisions such as a.png and a.jpg both mapping to a.jpg."""
    name, i = f"{stem}.jpg", 1
    while name.lower() in taken:
        name = f"{stem}_{i}.jpg"
        i += 1
    taken.add(name.lower())
    return dest_dir / name


@dataclass
class CameraMeta:
    """What an image's headers say about the camera; picklable, so the worker can return it."""

    rel_alt: float | None = None
    gimbal_pitch: float | None = None
    gimbal_yaw: float | None = None
    gimbal_roll: float | None = None
    flight_yaw: float | None = None
    lrf_distance_m: float | None = None
    focal_px: float | None = None
    focal_mm: float | None = None
    sensor_w_mm: float | None = None
    orig_w: int | None = None
    orig_h: int | None = None
    camera_model: str | None = None
    has_xmp: bool = False


def _xmp_float(raw: bytes) -> float | None:
    try:
        value = float(raw.strip())
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def parse_xmp(packet: bytes | str | None) -> dict[str, float]:
    """DJI `drone-dji:` values, attribute form (`Key="+38.40"`) or element form; no XML parser.

    The attribute form wins when a packet carries both. Junk values are skipped, never raised."""
    if not packet:
        return {}
    data = packet.encode("utf-8", "ignore") if isinstance(packet, str) else bytes(packet)
    raw: dict[str, bytes] = {}
    for key, value in _XMP_ELEM.findall(data):
        raw.setdefault(key.decode("ascii", "ignore"), value)
    for key, value in _XMP_ATTR.findall(data):
        raw[key.decode("ascii", "ignore")] = value
    out: dict[str, float] = {}
    for key, column in XMP_FIELDS.items():
        value = _xmp_float(raw[key]) if key in raw else None
        if value is not None:
            out[column] = value
    if out.get("focal_px") is not None and out["focal_px"] <= 0:
        del out["focal_px"]
    if raw.get("LRFStatus", b"").strip() == b"Normal":
        distance = _xmp_float(raw.get("LRFTargetDistance", b""))
        if distance is not None and 0 < distance <= LRF_MAX_M:
            out["lrf_distance_m"] = distance
    return out


def read_xmp(opened: Image.Image) -> dict[str, float]:
    """From the **source** file: Pillow keeps the APP1 XMP packet in `info`; the prepared JPEG drops it."""
    return parse_xmp(opened.info.get("xmp") or opened.info.get("XML:com.adobe.xmp"))


def _positive_int(value) -> int | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def read_camera(opened: Image.Image, *, original: bool) -> CameraMeta:
    """XMP pose plus EXIF intrinsics. For an original, a missing ExifImageWidth/Height falls back to
    the pixel size (the un-transposed sensor frame); a prepared copy's size is not the original's."""
    xmp = read_xmp(opened)
    meta = CameraMeta(**xmp, has_xmp=bool(xmp))
    try:
        exif = opened.getexif()
        intr = intrinsics_from_exif(exif)
        if intr is not None:
            meta.focal_mm, meta.sensor_w_mm = intr.focal_mm, intr.sensor_width_mm
        ifd = exif.get_ifd(EXIF_IFD)
        w, h = _positive_int(ifd.get(TAG_EXIF_IMAGE_WIDTH)), _positive_int(ifd.get(TAG_EXIF_IMAGE_HEIGHT))
        if w and h:
            meta.orig_w, meta.orig_h = w, h
        model = exif.get(TAG_MODEL)
        if model:
            decoded = model.decode("ascii", "ignore") if isinstance(model, bytes) else str(model)
            text = decoded.strip("\x00 ")
            meta.camera_model = text or None
    except Exception:  # a broken EXIF block costs the intrinsics, never the import
        pass
    if original and meta.orig_w is None:
        meta.orig_w, meta.orig_h = opened.size
    return meta


def write_thumbnail(im: Image.Image, dest: Path) -> bool:
    """The grid's 256 px thumbnail, written like `datasets/images._write_derived` (temp + rename).
    False on any failure: the lazy thumbnail endpoint then covers it."""
    tmp = dest.with_name(f"{dest.name}.{uuid4().hex}.tmp")
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        small = im.convert("RGB")  # always a copy, so the caller's image is not shrunk
        small.thumbnail((THUMB_SIDE, THUMB_SIDE), Image.LANCZOS)
        small.save(tmp, "JPEG", quality=THUMB_QUALITY, optimize=True)
        os.replace(tmp, dest)
        return True
    except Exception:
        return False
    finally:
        tmp.unlink(missing_ok=True)


@dataclass
class Prepared:
    dest: str
    src: str = ""
    width: int = 0
    height: int = 0
    phash: str = ""
    capture_time: datetime | None = None
    lat: float | None = None
    lon: float | None = None
    alt: float | None = None
    camera: CameraMeta = field(default_factory=CameraMeta)
    thumb: str = ""  # the thumbnail written, or "" (the lazy endpoint covers it)
    action: str = "failed"  # converted | downscaled | existing | failed
    error: str = ""


def _dms(value) -> float:
    d, m, s = (float(v) for v in value)
    return d + m / 60 + s / 3600


def read_exif(im: Image.Image) -> tuple[datetime | None, float | None, float | None, float | None]:
    """DateTimeOriginal (assumed UTC), GPS latitude and longitude in degrees, altitude in metres."""
    exif = im.getexif()
    capture = lat = lon = alt = None
    raw = exif.get_ifd(EXIF_IFD).get(TAG_DATETIME_ORIGINAL)
    if raw:
        try:
            capture = datetime.strptime(str(raw).strip(), "%Y:%m:%d %H:%M:%S").replace(tzinfo=UTC)
        except ValueError:
            capture = None
    gps = exif.get_ifd(GPS_IFD)
    try:
        if gps.get(2) and gps.get(4):
            lat = _dms(gps[2]) * (-1 if str(gps.get(1)).upper().startswith("S") else 1)
            lon = _dms(gps[4]) * (-1 if str(gps.get(3)).upper().startswith("W") else 1)
        if gps.get(6) is not None:
            alt = float(gps[6]) * (-1 if gps.get(5) == 1 else 1)
    except (TypeError, ValueError, ZeroDivisionError):
        lat = lon = alt = None
    return capture, lat, lon, alt


def _exif_for_save(original: bytes | None, rotated: bytes | None) -> bytes | None:
    """`exif_transpose` already rotated the pixels, so the saved copy must claim orientation 1.

    `rotated` is the transposed image's own EXIF, from which Pillow has dropped the orientation
    tag; it is the fallback when piexif cannot parse the original, because returning the raw
    original would tell viewers to rotate a second time.
    """
    if not original:
        return None
    try:
        parsed = piexif.load(original)
        if parsed["0th"].get(piexif.ImageIFD.Orientation, 1) == 1:
            return original
        parsed["0th"][piexif.ImageIFD.Orientation] = 1
        parsed["thumbnail"] = None  # a stale thumbnail would still be the unrotated one
        return piexif.dump(parsed)
    except Exception:
        return rotated


def _camera_of_source(src: str) -> CameraMeta:
    """Header only: `Image.open` is lazy, so XMP and EXIF are read without decoding pixels."""
    try:
        with Image.open(src) as opened:
            return read_camera(opened, original=True)
    except Exception:
        return CameraMeta()


def process_one(src: str, dest: str, max_side: int, quality: int, thumb: str = "") -> Prepared:
    """Convert one source image to a prepared JPEG. Originals are only ever read."""
    out = Prepared(dest=dest, src=src)
    try:
        if Path(dest).exists():
            with Image.open(dest) as im:
                out.width, out.height = im.size
                out.phash = str(imagehash.phash(im))
                out.capture_time, out.lat, out.lon, out.alt = read_exif(im)
                if thumb and write_thumbnail(im, Path(thumb)):
                    out.thumb = thumb
            out.camera = _camera_of_source(src)
            out.action = "existing"
            return out
        with Image.open(src) as opened:
            out.capture_time, out.lat, out.lon, out.alt = read_exif(opened)
            out.camera = read_camera(opened, original=True)
            im = ImageOps.exif_transpose(opened)
            exif_bytes = _exif_for_save(opened.info.get("exif"), im.info.get("exif"))
            if im.mode != "RGB":
                im = im.convert("RGB")
            w, h = im.size
            if max(w, h) > max_side:
                scale = max_side / max(w, h)
                im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
                out.action = "downscaled"
            else:
                out.action = "converted"
            out.width, out.height = im.size
            out.phash = str(imagehash.phash(im))
            kwargs: dict = {"quality": quality, "optimize": True}
            if exif_bytes:
                kwargs["exif"] = exif_bytes
            Path(dest).parent.mkdir(parents=True, exist_ok=True)
            im.save(dest, "JPEG", **kwargs)
            if thumb and write_thumbnail(im, Path(thumb)):
                out.thumb = thumb
    except Exception as e:  # reported, never raised: the pool must keep going
        out.action, out.error = "failed", repr(e)
    return out
