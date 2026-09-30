"""The `attachment` snapshot: a finding photo at print size (reports index, coordinator ruling 2;
unit R9-I). One file per render, JPEG-draft-reduced to the smallest scale that still covers `out`,
EXIF-upright, fitted inside `out` and padded white (paper). R3's `render_to_cache` encodes it as the
cached JPEG (q85, 4:2:0, no EXIF) and turns any exception here into a placeholder with the reason
(index: SnapshotSpec kind `attachment{finding_id, attachment_id, out}`).

    source_version(handle, spec) -> str        # MISSING + reason when the source is missing
    render(handle, spec) -> PIL.Image.Image    # RGB, exactly out_of(spec); SnapshotUnavailable(reason)
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image as PILImage
from PIL import ImageOps

from app.db.models import FindingAttachment
from app.reports.snapshots import MISSING, SnapshotUnavailable, out_of

PAPER = (255, 255, 255)
UNREADABLE = "The photo file cannot be read."


def _path(handle, spec) -> Path:
    """The attachment's file, or SnapshotUnavailable: unknown row, another finding's row, a path
    outside `<project>/findings/`, or a file that is gone."""
    with handle.session() as s:
        row = s.get(FindingAttachment, spec.attachment_id)
        if row is None or row.finding_id != spec.finding_id:
            raise SnapshotUnavailable("The photo no longer exists.")
        rel = row.path
    root = (handle.folder / "findings").resolve()
    path = (handle.folder / rel).resolve()
    if not path.is_relative_to(root):
        raise SnapshotUnavailable("The photo is not inside the project's findings folder.")
    if not path.is_file():
        raise SnapshotUnavailable("The photo file is missing.")
    return path


def source_version(handle, spec) -> str:
    """size:mtime_ns of the file, or MISSING + reason (compose never raises on a vanished photo, nor
    on a malformed handle/spec: R3's own tests exercise `attachment` specs against a bare
    `SimpleNamespace(folder=...)` handle to check placeholder clamping, expecting no source ever to
    be reachable there)."""
    try:
        st = _path(handle, spec).stat()
    except SnapshotUnavailable as e:
        return MISSING + e.reason
    except (LookupError, OSError, AttributeError, TypeError):
        return MISSING + "The photo file is missing."
    return f"{st.st_size}:{st.st_mtime_ns}"


def render(handle, spec) -> PILImage.Image:
    out_w, out_h = out_of(spec)
    side = max(out_w, out_h)
    path = _path(handle, spec)
    try:
        with PILImage.open(path) as im:
            if im.format == "JPEG":
                im.draft("RGB", (side, side))  # square request: still covers `out` after a 90deg turn
            upright = ImageOps.exif_transpose(im)
            if upright.mode in ("RGBA", "LA", "P"):
                rgba = upright.convert("RGBA")
                flat = PILImage.new("RGB", rgba.size, PAPER)
                flat.paste(rgba, mask=rgba.getchannel("A"))
                upright = flat
            else:
                upright = upright.convert("RGB")
            fitted = ImageOps.contain(upright, (out_w, out_h), PILImage.Resampling.LANCZOS)
    except PILImage.DecompressionBombError:
        raise SnapshotUnavailable(
            f"The photo is too large to print (over {PILImage.MAX_IMAGE_PIXELS // 1_000_000} MP)"
        ) from None
    except (OSError, SyntaxError, ValueError):
        # Covers PIL.UnidentifiedImageError (an OSError subclass) and any other decode failure on a
        # row whose file exists but is not a readable image.
        raise SnapshotUnavailable(UNREADABLE) from None
    page = PILImage.new("RGB", (out_w, out_h), PAPER)
    page.paste(fitted, ((out_w - fitted.width) // 2, (out_h - fitted.height) // 2))
    return page
