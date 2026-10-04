"""Finding photos (spec 2026-09-26-foundation sections 8.3, 14): a local file chosen in the Tauri
dialog, JPEG, PNG or WebP, at most 50 MB, checked with Pillow before a byte is copied, then copied
into `findings/<finding_id>/` with a 256 px thumbnail. The copy is synchronous: the one sanctioned
exception to "long work is a job", since a photo copy is well under a second."""

import os
import shutil
from pathlib import Path
from uuid import uuid4

from PIL import Image as PILImage
from PIL import ImageOps, UnidentifiedImageError
from sqlalchemy import select

from app.db.base import new_id, utcnow
from app.db.models import FindingAttachment
from app.errors import AppError, not_found
from app.findings import events, service, trash

MAX_BYTES = 50 * 1024 * 1024
FORMATS = {"JPEG": (".jpg", "image/jpeg"), "PNG": (".png", "image/png"), "WEBP": (".webp", "image/webp")}
MEDIA = {ext: media for ext, media in FORMATS.values()}
THUMB = 256


def _invalid(reason: str, message: str, **details) -> AppError:
    return AppError("attachment_invalid", message, 422, {"reason": reason, **details})


def inspect(path: Path) -> tuple[str, int, int, int]:
    """(format, width, height, bytes), or 422 `attachment_invalid` with the reason."""
    if not path.is_absolute():
        raise _invalid("not_absolute", f"{path} is not an absolute path.")
    if not path.is_file():
        raise _invalid("not_found", f"{path} is not a file.")
    size = path.stat().st_size
    if size > MAX_BYTES:
        raise _invalid(
            "too_large", f"{path.name} is {size / 1024 / 1024:.0f} MB; the limit is 50 MB.", bytes=size
        )
    try:
        with PILImage.open(path) as im:
            fmt, (width, height) = im.format, im.size
            im.verify()
    except (PILImage.DecompressionBombError, UnidentifiedImageError, OSError, SyntaxError, ValueError) as e:
        raise _invalid("not_an_image", f"{path.name} is not a JPEG, PNG or WebP photo.") from e
    if fmt not in FORMATS:
        raise _invalid("not_an_image", f"{path.name} is a {fmt} image; use JPEG, PNG or WebP.")
    return fmt, width, height, size


def thumb_path(handle, attachment_id: str) -> Path:
    return handle.thumbs_dir / "findings" / "attachments" / f"{attachment_id}.jpg"


def _write_thumb(src: Path, dest: Path) -> Path:
    """Through a private temp name and a rename: a concurrent reader sees all of it or none."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f"{dest.name}.{uuid4().hex}.tmp")
    try:
        with PILImage.open(src) as im:
            im = ImageOps.exif_transpose(im)
            im.thumbnail((THUMB, THUMB))
            im.convert("RGB").save(tmp, "JPEG", quality=85)
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)
    return dest


def add(handle, finding_id: str, source: str, name: str | None = None) -> FindingAttachment:
    with handle.session() as s:
        service.get_or_404(s, finding_id)
    src = Path(source)
    fmt, width, height, size = inspect(src)
    aid = new_id()
    rel = f"findings/{finding_id}/{aid}{FORMATS[fmt][0]}"
    dest = handle.folder / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(src, dest)
        try:
            _write_thumb(dest, thumb_path(handle, aid))
        except OSError as e:  # a truncated file passes verify(); decoding it is what fails
            raise _invalid("not_an_image", f"{src.name} is damaged or incomplete.") from e
        with handle.session() as s:
            f = service.get_or_404(s, finding_id)  # deleted while the file copied: undo the copy
            row = FindingAttachment(
                id=aid,
                finding_id=finding_id,
                path=rel,
                original_name=(name or src.name)[:255],
                width=width,
                height=height,
                bytes=size,
            )
            s.add(row)
            f.updated_at = utcnow()
            events.mark_changed(s, handle.id, [finding_id])
            s.flush()
            s.expunge(row)
    except Exception:
        dest.unlink(missing_ok=True)
        thumb_path(handle, aid).unlink(missing_ok=True)
        raise
    return row


def list_for(handle, finding_id: str) -> list[FindingAttachment]:
    with handle.session() as s:
        service.get_or_404(s, finding_id)
        rows = list(
            s.execute(
                select(FindingAttachment)
                .where(FindingAttachment.finding_id == finding_id)
                .order_by(FindingAttachment.created_at, FindingAttachment.id)
            ).scalars()
        )
        for r in rows:
            s.expunge(r)
    return rows


def _row(s, finding_id: str, attachment_id: str) -> FindingAttachment:
    row = s.get(FindingAttachment, attachment_id)
    if row is None or row.finding_id != finding_id:
        raise not_found("attachment", attachment_id)
    return row


def delete(handle, finding_id: str, attachment_id: str) -> None:
    with handle.session() as s:
        row = _row(s, finding_id, attachment_id)
        rel = row.path
        s.delete(row)
        events.mark_changed(s, handle.id, [finding_id])
    trash.move_file(handle, rel)
    thumb_path(handle, attachment_id).unlink(missing_ok=True)


def _path(handle, finding_id: str, attachment_id: str) -> Path:
    with handle.session() as s:
        return handle.folder / _row(s, finding_id, attachment_id).path


def file(handle, finding_id: str, attachment_id: str) -> tuple[Path, str]:
    path = _path(handle, finding_id, attachment_id)
    if not path.is_file():
        raise not_found("attachment file", attachment_id)
    return path, MEDIA.get(path.suffix.lower(), "application/octet-stream")


def thumbnail(handle, finding_id: str, attachment_id: str) -> Path:
    """The 256 px thumbnail written at upload, rewritten from the copy if the cache lost it."""
    src = _path(handle, finding_id, attachment_id)  # 404 for another finding's attachment
    dest = thumb_path(handle, attachment_id)
    if dest.is_file():
        return dest
    if not src.is_file():
        raise not_found("attachment file", attachment_id)
    return _write_thumb(src, dest)
