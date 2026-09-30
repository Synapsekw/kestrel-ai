"""Report logos (spec 2026-09-26-reports §6.1 `report_asset`, §15).

A local file picked in the Tauri dialog, at most 20 MB (checked before Pillow opens it), JPEG, PNG
or WebP, decoded draft-reduced when it is a JPEG, EXIF-rotated, down-scaled to at most 1200 px a
side and written as `reports/assets/logo-<sha8>.png`, sha8 being the first 8 hex digits of the PNG
bytes' sha256 (plan R1 Ruling 10). Synchronous: small by construction, like finding photos.
"""

from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path
from uuid import uuid4

from PIL import Image as PILImage
from PIL import ImageOps, UnidentifiedImageError
from sqlalchemy import select

from app.db.base import new_id
from app.errors import AppError
from app.projects.service import ProjectHandle
from app.reports.models import ReportAsset as AssetRow
from app.reports.schemas import ReportAsset

MAX_BYTES = 20 * 1024 * 1024
MAX_SIDE = 1200
# MPO is what Pillow calls a phone/camera JPEG carrying a second frame; it decodes as a JPEG.
FORMATS = frozenset({"JPEG", "MPO", "PNG", "WEBP"})
# Pixels a source may have at decode time (after a JPEG's draft reduction): ~200 MB as RGBA.
MAX_SOURCE_PIXELS = 50_000_000
ASSETS_DIR = "reports/assets"


def _invalid(reason: str, message: str, **details) -> AppError:
    return AppError("asset_invalid", message, 422, {"reason": reason, **details})


def _check(src: Path) -> None:
    if not src.is_absolute():
        raise _invalid("not_absolute", f"{src} is not an absolute path.")
    if not src.is_file():
        raise _invalid("not_found", f"{src} is not a file.")
    size = src.stat().st_size
    if size > MAX_BYTES:
        raise _invalid(
            "too_large", f"{src.name} is {size / 1024 / 1024:.0f} MB; the limit is 20 MB.", bytes=size
        )


def _has_alpha(im: PILImage.Image) -> bool:
    return im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info)


def _encode(src: Path) -> tuple[bytes, int, int]:
    """The logo as PNG bytes at most MAX_SIDE a side, and its size; 422 for anything unreadable."""
    try:
        with PILImage.open(src) as opened:
            if opened.format not in FORMATS:
                raise _invalid(
                    "not_an_image", f"{src.name} is a {opened.format} image; use PNG, JPEG or WebP."
                )
            opened.draft("RGB", (MAX_SIDE, MAX_SIDE))  # JPEG: decode reduced; a no-op otherwise
            w, h = opened.size
            if w * h > MAX_SOURCE_PIXELS:  # judged before any decode (bounded read)
                raise _invalid(
                    "too_large",
                    f"{src.name} is {w} x {h} pixels; the limit is {MAX_SOURCE_PIXELS:,} pixels.",
                    pixels=w * h,
                )
            im = ImageOps.exif_transpose(opened)
            im = im.convert("RGBA" if _has_alpha(im) else "RGB")
            im.thumbnail((MAX_SIDE, MAX_SIDE), PILImage.Resampling.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "PNG")
    except AppError:
        raise
    except (PILImage.DecompressionBombError, UnidentifiedImageError, OSError, SyntaxError, ValueError) as e:
        raise _invalid("not_an_image", f"{src.name} is not a readable PNG, JPEG or WebP image.") from e
    return buf.getvalue(), im.width, im.height


def _write(dest: Path, data: bytes) -> None:
    """Through a private temp name and a rename: a reader sees all of it or none."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f"{dest.name}.{uuid4().hex}.tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)


def import_logo(handle: ProjectHandle, source: str) -> ReportAsset:
    src = Path(source)
    _check(src)
    data, width, height = _encode(src)
    sha = hashlib.sha256(data).hexdigest()
    rel = f"{ASSETS_DIR}/logo-{sha[:8]}.png"
    with handle.session() as s:
        row = s.execute(select(AssetRow).where(AssetRow.sha256 == sha)).scalars().first()
        dest = handle.folder / (row.path if row is not None else rel)
        if row is None or not dest.is_file():  # an existing file is never rewritten (a reader may
            _write(dest, data)  # hold it open: os.replace fails on Windows); a vanished one heals
        if row is None:
            row = AssetRow(id=new_id(), kind="logo", path=rel, sha256=sha, width=width, height=height)
            s.add(row)
            s.flush()
        return ReportAsset.model_validate(row, from_attributes=True)


def asset_path(handle: ProjectHandle, asset_id: str) -> Path | None:
    """The PNG on disk for `asset_id`, or None (unknown id or a vanished file)."""
    with handle.session() as s:
        row = s.get(AssetRow, asset_id)
        if row is None:
            return None
        path = handle.folder / row.path
    return path if path.is_file() else None
