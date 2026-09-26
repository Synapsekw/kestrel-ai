"""The project activity feed (spec 2026-09-26-foundation section 8.1): the Overview's feed and the
inspector's history."""

from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.db.models import Activity
from app.errors import AppError
from app.pagination import clamp_limit, decode_cursor, encode_cursor

KINDS = (
    "finding.created",
    "finding.status",
    "finding.severity",
    "finding.comment",
    "data.imported",
    "job.finished",
    "detections.accepted",
)
MAX_SUMMARY = 200


def record(s: Session, kind: str, subject_id: str | None, summary: str, payload: dict | None = None) -> None:
    if kind not in KINDS:
        raise AppError("validation_error", f"unknown activity kind {kind!r}", 422)
    s.add(Activity(kind=kind, subject_id=subject_id, summary=summary[:MAX_SUMMARY], payload=payload or {}))


def page(
    s: Session, *, subject_id: str | None = None, cursor: str | None = None, limit: int | None = None
) -> tuple[list[Activity], str | None]:
    """Newest first, keyset on (at, id)."""
    n = clamp_limit(limit)
    q = select(Activity)
    if subject_id:
        q = q.where(Activity.subject_id == subject_id)
    c = decode_cursor(cursor, "at", "id")
    if c:
        try:
            at = datetime.fromisoformat(c["at"])
        except (TypeError, ValueError):
            raise AppError("validation_error", "invalid cursor", 422) from None
        q = q.where(or_(Activity.at < at, and_(Activity.at == at, Activity.id < c["id"])))
    rows = s.execute(q.order_by(Activity.at.desc(), Activity.id.desc()).limit(n + 1)).scalars().all()
    nxt = encode_cursor(at=rows[n - 1].at.isoformat(), id=rows[n - 1].id) if len(rows) > n else None
    return list(rows[:n]), nxt
