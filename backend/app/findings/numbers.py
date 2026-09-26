"""Human finding numbers (spec 2026-09-26-foundation section 8.1): `F-` plus at least four digits,
allocated inside the create transaction, never reused after a delete."""

import re

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.db.models import Finding, Project

_NUMBER = re.compile(r"^\s*(?:F-?)?(\d{1,9})\s*$", re.IGNORECASE)


def format_number(n: int) -> str:
    return f"F-{n:04d}"


def parse_number(text: str) -> int | None:
    """`F-0217`, `f217` or `217` -> 217; anything else -> None."""
    m = _NUMBER.match(text or "")
    return int(m.group(1)) if m else None


def allocate(s: Session, count: int = 1) -> int:
    """Reserve `count` consecutive numbers; returns the first. The UPDATE comes first, so this
    transaction holds SQLite's write lock before it reads the new mark: two writers cannot get the
    same number. `max(finding_seq, max(number))` also covers numbers written directly (MG's
    migration), and a deleted top number is never handed out again."""
    top = select(func.coalesce(func.max(Finding.number), 0)).scalar_subquery()
    s.execute(
        update(Project)
        .values(finding_seq=func.max(Project.finding_seq, top) + count)
        .execution_options(synchronize_session=False)
    )
    last = s.execute(select(Project.finding_seq)).scalar_one()
    return last - count + 1
