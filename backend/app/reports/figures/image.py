"""Image figures, photos and comments of a finding page (spec §7.3). R2 stub -> R9-I fills the
bodies; the signatures are fixed (index "Interface decisions").
A figure module may also define `warnings(ctx) -> None`; the outline calls it (plan R2 Ruling 11),
and `fingerprint(ctx) -> str`; finding_pages appends it to the section etag, so an input the figures
read that no finding row carries can still move the preview.
The image hook also runs when photos or comments print, even with "image" snapshots off."""

from __future__ import annotations

from datetime import UTC

from sqlalchemy import func, select

from app.db.models import FindingComment
from app.reports.blocks import Comment, Figure
from app.reports.context import ComposeContext, FindingRow

COMMENTS_ALL_MAX = 100
MORE_AUTHOR = "Kestrel AI"


def finding_figures(ctx: ComposeContext, finding: FindingRow) -> list[Figure]:
    return []


def photos(ctx: ComposeContext, finding: FindingRow, max_n: int) -> list[Figure]:
    return []


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
