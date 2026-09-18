"""Image preparation ported from E:\\Dev\\Yolo\\scripts\\prepare_images.py.

Pure functions only: `process_one` runs in a worker process, so it must be importable at module
level, take and return picklable values, and never raise (a failure is reported in the result).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import imagehash
import piexif
from PIL import Image, ImageOps

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
EXIF_IFD, GPS_IFD = 0x8769, 0x8825
TAG_ORIENTATION, TAG_DATETIME_ORIGINAL = 0x0112, 36867


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
class Prepared:
    dest: str
    width: int = 0
    height: int = 0
    phash: str = ""
    capture_time: datetime | None = None
    lat: float | None = None
    lon: float | None = None
    alt: float | None = None
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


def process_one(src: str, dest: str, max_side: int, quality: int) -> Prepared:
    """Convert one source image to a prepared JPEG. Originals are only ever read."""
    out = Prepared(dest=dest)
    try:
        if Path(dest).exists():
            with Image.open(dest) as im:
                out.width, out.height = im.size
                out.phash = str(imagehash.phash(im))
                out.capture_time, out.lat, out.lon, out.alt = read_exif(im)
            out.action = "existing"
            return out
        with Image.open(src) as opened:
            out.capture_time, out.lat, out.lon, out.alt = read_exif(opened)
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
    except Exception as e:  # reported, never raised: the pool must keep going
        out.action, out.error = "failed", repr(e)
    return out
