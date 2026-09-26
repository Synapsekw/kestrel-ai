"""A finding's comment thread (spec 2026-09-26-foundation section 8.3): oldest first, paged. The
author is the Settings "Your name" (`operator_name` in settings.json), else "Operator"."""

import logging
from datetime import datetime
from pathlib import Path

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.appdata import AppData
from app.db.base import utcnow
from app.db.models import FindingComment
from app.errors import AppError, not_found
from app.findings import activity, events, numbers, service
from app.pagination import clamp_limit, decode_cursor, encode_cursor

MAX_TEXT = 4000
MAX_NAME = 80
DEFAULT_AUTHOR = "Operator"
EXCERPT = 60
log = logging.getLogger(__name__)


def _clean_name(name) -> str | None:
    """Trimmed and capped at 80 characters; None when blank or not a string."""
    if not isinstance(name, str):
        return None
    return name.strip()[:MAX_NAME].rstrip() or None


def operator_name(data_dir: Path) -> str | None:
    """The stored name, or None when unset or unreadable (GET /settings/operator). An unreadable
    settings file never blocks a comment: it is logged and reads as unset."""
    try:
        values = AppData(data_dir).read_settings()
    except Exception:
        log.warning("could not read settings.json for the operator name", exc_info=True)
        return None
    return _clean_name(values.get("operator_name")) if isinstance(values, dict) else None


def author_name(data_dir: Path) -> str:
    return operator_name(data_dir) or DEFAULT_AUTHOR


def set_operator_name(data_dir: Path, name: str | None) -> str | None:
    """PUT /settings/operator: trims, caps at 80, clears on blank; keeps every other settings key.
    An unreadable settings file is never overwritten (provider settings share it): 500, nothing
    written."""
    app_data = AppData(data_dir)
    try:
        values = app_data.read_settings()
        if not isinstance(values, dict):
            raise ValueError("settings.json does not hold an object")
    except Exception as e:
        log.warning("could not read settings.json; the operator name was not saved", exc_info=True)
        raise AppError(
            "internal_error", "The settings file could not be read, so the name was not saved.", 500
        ) from e
    clean = _clean_name(name)
    if clean:
        values["operator_name"] = clean
    else:
        values.pop("operator_name", None)
    app_data.write_settings(values)
    return clean


def _text(text: str) -> str:
    clean = (text or "").strip()
    if not clean:
        raise AppError("comment_blank", "A comment cannot be blank.", 409)
    if len(clean) > MAX_TEXT:
        raise AppError("validation_error", f"a comment holds at most {MAX_TEXT} characters", 422)
    return clean


def _comment(s: Session, finding_id: str, comment_id: str) -> FindingComment:
    row = s.get(FindingComment, comment_id)
    if row is None or row.finding_id != finding_id:
        raise not_found("comment", comment_id)
    return row


def page(
    s: Session, finding_id: str, *, cursor: str | None = None, limit: int | None = None
) -> tuple[list[FindingComment], str | None]:
    service.get_or_404(s, finding_id)
    n = clamp_limit(limit)
    q = select(FindingComment).where(FindingComment.finding_id == finding_id)
    c = decode_cursor(cursor, "at", "id")
    if c:
        try:
            at = datetime.fromisoformat(c["at"])
        except (TypeError, ValueError):
            raise AppError("validation_error", "invalid cursor", 422) from None
        q = q.where(
            or_(
                FindingComment.created_at > at,
                and_(FindingComment.created_at == at, FindingComment.id > c["id"]),
            )
        )
    rows = s.execute(q.order_by(FindingComment.created_at, FindingComment.id).limit(n + 1)).scalars().all()
    nxt = encode_cursor(at=rows[n - 1].created_at.isoformat(), id=rows[n - 1].id) if len(rows) > n else None
    return list(rows[:n]), nxt


def add(s: Session, *, project_id: str, finding_id: str, text: str, author: str) -> FindingComment:
    f = service.get_or_404(s, finding_id)
    row = FindingComment(finding_id=f.id, author=author, text=_text(text))
    s.add(row)
    s.flush()
    excerpt = row.text if len(row.text) <= EXCERPT else row.text[: EXCERPT - 1] + "…"
    activity.record(
        s,
        "finding.comment",
        f.id,
        f"Comment on {numbers.format_number(f.number)}: {excerpt}",
        {"comment_id": row.id},
    )
    f.updated_at = utcnow()
    events.mark_changed(s, project_id, [f.id])
    return row


def edit(s: Session, *, project_id: str, finding_id: str, comment_id: str, text: str) -> FindingComment:
    row = _comment(s, finding_id, comment_id)
    row.text = _text(text)
    row.edited_at = utcnow()
    events.mark_changed(s, project_id, [finding_id])
    return row


def delete(s: Session, *, project_id: str, finding_id: str, comment_id: str) -> None:
    s.delete(_comment(s, finding_id, comment_id))
    events.mark_changed(s, project_id, [finding_id])
