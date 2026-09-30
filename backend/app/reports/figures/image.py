"""Image figures, photos and comments of a finding page (spec §7.3). R2 stub -> R9-I fills the
bodies; the signatures are fixed (index "Interface decisions").
A figure module may also define `warnings(ctx) -> None`; the outline calls it (plan R2 Ruling 11),
and `fingerprint(ctx) -> str`; finding_pages appends it to the section etag, so an input the figures
read that no finding row carries can still move the preview.
The image hook also runs when photos or comments print, even with "image" snapshots off."""

from __future__ import annotations

from datetime import UTC
from pathlib import PurePosixPath

from sqlalchemy import func, select

from app.db.models import Box, Finding, FindingAttachment, FindingComment, Image
from app.reports import blocks
from app.reports.blocks import Comment, Figure
from app.reports.context import ComposeContext, FindingRow
from app.reports.schemas import AttachmentSpec, ImageCropSpec

COMMENTS_ALL_MAX = 100
MORE_AUTHOR = "Kestrel AI"
PHOTOS_MAX = 6
PHOTO_OUT = (480, 360)  # 40 x 30 mm at ~305 dpi
PHOTO_MM = (40, 30)
CAPTION_MAX = 32
MAIN_OUT = (1200, 900)  # 4:3, spec §9.2
MAIN_MM = (140, 105)  # 4:3 at the §7.3 height (Ruling 1)
CONTEXT = 3.0


def finding_figures(ctx: ComposeContext, finding: FindingRow) -> list[Figure]:
    """The image anchor's main figure: its annotation cropped with context (spec §9.2), with the
    locator inset when `context_inset`; [] for other anchors or a box/image that no longer exists
    (spec §16: the row may have been paged before the box went, so re-read the Finding fresh)."""
    if finding.anchor_kind != "image":
        return []
    with ctx.session() as s:
        current = s.get(Finding, finding.id)
        annotation_id = current.annotation_id if current is not None else None
        box = s.get(Box, annotation_id) if annotation_id else None
        img = s.get(Image, box.image_id) if box is not None else None
        if box is None or img is None:
            return []
        ring = _ring(box)
        image_id, file_name = img.id, PurePosixPath(img.path).name
    spec = ImageCropSpec(
        kind="image_crop",
        image_id=image_id,
        annotation_id=annotation_id,
        ring=ring,
        colour=finding.type_colour,
        label=f"{finding.label} · {finding.type_name}",
        context=CONTEXT,
        out=list(MAIN_OUT),
        inset=_context_inset(ctx),
    )
    ref = ctx.ref(spec, width_px=MAIN_OUT[0], height_px=MAIN_OUT[1])
    return [blocks.figure(ref, file_name, MAIN_MM[0], MAIN_MM[1])]


def _ring(box: Box) -> list[list[float]]:
    """Image-px ring by shape: a point is one vertex, a box/rbox its four corners, a polygon its
    ring (compacted to the renderer's vertex cap)."""
    from app.reports.snapshots.image_crop import ring_of  # lazy: compose must not need PIL/shapely

    return ring_of(box.shape, box.x, box.y, box.w, box.h, box.angle, box.points)


def _context_inset(ctx: ComposeContext) -> bool:
    return bool(ctx.options("finding_pages").context_inset)


def fingerprint(ctx: ComposeContext) -> str:
    """Ruling R-A: `max(Box.updated_at)` and count over the boxes that anchor image findings
    matching `ctx.where`, one aggregate query. Moving a box does not bump `Finding.updated_at`, so
    without this the preview's cached blocks would keep the old ring."""
    box_ids = select(Finding.annotation_id).where(ctx.where, Finding.anchor_kind == "image").scalar_subquery()
    with ctx.session() as s:
        count, max_updated = s.execute(
            select(func.count(), func.max(Box.updated_at)).where(Box.id.in_(box_ids))
        ).one()
    return f"{count}:{max_updated.isoformat() if max_updated else ''}"


def photos(ctx: ComposeContext, finding: FindingRow, max_n: int) -> list[Figure]:
    """The finding's first `max_n` (0-6) photos, oldest first, each printed through the cache."""
    n = max(0, min(int(max_n), PHOTOS_MAX))
    if n == 0:
        return []
    with ctx.session() as s:
        rows = s.execute(
            select(FindingAttachment.id, FindingAttachment.original_name)
            .where(FindingAttachment.finding_id == finding.id)
            .order_by(FindingAttachment.created_at, FindingAttachment.id)
            .limit(n)
        ).all()
    figures = []
    for attachment_id, original_name in rows:
        spec = AttachmentSpec(
            kind="attachment", finding_id=finding.id, attachment_id=attachment_id, out=list(PHOTO_OUT)
        )
        ref = ctx.ref(spec, width_px=PHOTO_OUT[0], height_px=PHOTO_OUT[1])
        figures.append(blocks.figure(ref, _cut(original_name), PHOTO_MM[0], PHOTO_MM[1]))
    return figures


def _cut(text: str) -> str:
    return text if len(text) <= CAPTION_MAX else text[: CAPTION_MAX - 1] + "…"


def comments(ctx: ComposeContext, finding: FindingRow, mode: str) -> list[Comment]:
    """`none` -> []; `last` -> the newest; `all` -> oldest first, at most 100 plus a "more" line."""
    if mode not in ("last", "all"):
        return []
    q = select(FindingComment).where(FindingComment.finding_id == finding.id)
    with ctx.session() as s:
        if mode == "last":
            rows = s.execute(
                q.order_by(FindingComment.created_at.desc(), FindingComment.id.desc()).limit(1)
            ).scalars()
            return [_comment(r) for r in rows]
        rows = list(
            s.execute(
                q.order_by(FindingComment.created_at, FindingComment.id).limit(COMMENTS_ALL_MAX + 1)
            ).scalars()
        )
        out = [_comment(r) for r in rows[:COMMENTS_ALL_MAX]]
        if len(rows) > COMMENTS_ALL_MAX:
            total = s.execute(
                select(func.count())
                .select_from(FindingComment)
                .where(FindingComment.finding_id == finding.id)
            ).scalar_one()
            more = total - COMMENTS_ALL_MAX
            out.append(
                Comment(
                    author=MORE_AUTHOR,
                    text=f"{more} more comments are not printed; see the finding in the app.",
                    created_at=_iso(ctx.generated_at),
                )
            )
    return out


def _comment(row: FindingComment) -> Comment:
    return Comment(author=row.author, text=row.text, created_at=_iso(row.created_at))


def _iso(dt) -> str:
    """ISO 8601 UTC text, `Z` suffix (`blocks.Comment.created_at`; `blocks.finding` validates it
    back into R0's `schemas.Comment.created_at: datetime`)."""
    d = dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)
    return d.astimezone(UTC).isoformat().replace("+00:00", "Z")
