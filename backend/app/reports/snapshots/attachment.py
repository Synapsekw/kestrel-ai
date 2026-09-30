"""The `attachment` snapshot: a finding photo at print size (reports index, coordinator ruling 2;
unit R9-I). One file per render, JPEG-draft-reduced to the smallest scale that still covers `out`,
EXIF-upright, fitted inside `out` and padded white (paper). R3's `render_to_cache` encodes it as the
cached JPEG (q85, 4:2:0, no EXIF) and turns any exception here into a placeholder with the reason
(index: SnapshotSpec kind `attachment{finding_id, attachment_id, out}`).

    source_version(handle, spec) -> str        # MISSING + reason when the source is missing
    render(handle, spec) -> PIL.Image.Image    # RGB, exactly out_of(spec); SnapshotUnavailable(reason)
"""

from __future__ import annotations

from pathlib import Path, PurePath

from PIL import Image as PILImage
from PIL import ImageOps

from app.db.models import FindingAttachment
from app.reports.snapshots import MISSING, SnapshotUnavailable, out_of

PAPER = (255, 255, 255)
UNREADABLE = "The photo file cannot be read."
OUTSIDE_FINDINGS = "The photo is not inside the project's findings folder."


def _too_large() -> str:
    return f"The photo is too large to print (over {PILImage.MAX_IMAGE_PIXELS // 1_000_000} MP)"


def _path(handle, spec) -> Path:
    """The attachment's file, or SnapshotUnavailable: unknown row, another finding's row, a path
    outside `<project>/findings/`, or a file that is gone."""
    with handle.session() as s:
        row = s.get(FindingAttachment, spec.attachment_id)
        if row is None:
            raise SnapshotUnavailable("The photo no longer exists.")
        if row.finding_id != spec.finding_id:
            raise SnapshotUnavailable("The photo does not belong to this finding.")
        rel = row.path
    # Cheap refusal before touching the filesystem: an absolute path, a ".." component or a path
    # that does not start under "findings/" (FindingAttachment.path is always written as
    # "findings/<finding_id>/<id>.<ext>", forward slashes) is refused without a resolve() call.
    rel_parts = PurePath(rel)
    if rel_parts.is_absolute() or ".." in rel_parts.parts or not rel.startswith("findings/"):
        raise SnapshotUnavailable(OUTSIDE_FINDINGS)
    root = (handle.folder / "findings").resolve()
    path = (handle.folder / rel).resolve()
    if not path.is_relative_to(root):
        raise SnapshotUnavailable(OUTSIDE_FINDINGS)
    if not path.is_file():
        raise SnapshotUnavailable("The photo file is missing.")
    return path


def source_version(handle, spec) -> str:
    """size:mtime_ns of the file, or MISSING + reason (compose never raises on a vanished photo). A
    handle with no `.session()` (R3's own placeholder-clamping tests exercise `attachment` specs
    against a bare `SimpleNamespace(folder=...)` handle) has no real attachment to find either, so
    it is handled explicitly rather than by widening the except below to mask real bugs."""
    if getattr(handle, "session", None) is None:
        return MISSING + "The photo file is missing."
    try:
        st = _path(handle, spec).stat()
    except SnapshotUnavailable as e:
        return MISSING + e.reason
    except (LookupError, OSError):
        return MISSING + "The photo file is missing."
    return f"{st.st_size}:{st.st_mtime_ns}"


def render(handle, spec) -> PILImage.Image:
    out_w, out_h = out_of(spec)
    side = max(out_w, out_h)
    path = _path(handle, spec)
    try:
        with PILImage.open(path) as im:
            # Explicit bomb-guard (amendment A11, image_crop.py's own pattern): Pillow's own
            # DecompressionBombError only fires above 2x MAX_IMAGE_PIXELS; between 1x and 2x it only
            # warns and still decodes. `warnings.catch_warnings`/`simplefilter` toggle a
            # process-global filter, which is not thread-safe with two concurrent render slots, so
            # check the pixel count explicitly instead.
            limit = PILImage.MAX_IMAGE_PIXELS
            if limit is not None and im.size[0] * im.size[1] > limit:
                raise SnapshotUnavailable(_too_large())
            if im.format in ("JPEG", "MPO"):
                im.draft("RGB", (side, side))  # square request: still covers `out` after a 90deg turn
            upright = ImageOps.exif_transpose(im)
            has_alpha = upright.mode in ("RGBA", "LA", "P")
            # Fit to `out` before flattening alpha onto white: flattening needs a same-size white
            # canvas and a paste, which is wasteful at full decoded size for a large PNG/WebP with
            # alpha (no JPEG draft to shrink it first). Converting mode (not resizing) is cheap, so
            # convert, then contain, then flatten the now print-sized image.
            prepped = upright.convert("RGBA") if has_alpha else upright.convert("RGB")
            fitted_raw = ImageOps.contain(prepped, (out_w, out_h), PILImage.Resampling.LANCZOS)
            if has_alpha:
                flat = PILImage.new("RGB", fitted_raw.size, PAPER)
                flat.paste(fitted_raw, mask=fitted_raw.getchannel("A"))
                fitted = flat
            else:
                fitted = fitted_raw
    except PILImage.DecompressionBombError:
        raise SnapshotUnavailable(_too_large()) from None
    except (OSError, SyntaxError, ValueError):
        # Covers PIL.UnidentifiedImageError (an OSError subclass) and any other decode failure on a
        # row whose file exists but is not a readable image.
        raise SnapshotUnavailable(UNREADABLE) from None
    page = PILImage.new("RGB", (out_w, out_h), PAPER)
    page.paste(fitted, ((out_w - fitted.width) // 2, (out_h - fitted.height) // 2))
    return page
