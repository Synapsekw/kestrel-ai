"""The step ledger: `migration_step(name, done_at, detail)` in the project database (spec §11.4).

Plain SQL on purpose: the table and its ORM class belong to unit BC (revision 0010), and the
ledger needs only its three columns. A step records itself in the same transaction as its own
project writes, so a step is either done and recorded, or not done at all.
"""

import json
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

TABLE = "migration_step"


def done_steps(s: Session) -> set[str]:
    return set(s.execute(text(f"SELECT name FROM {TABLE}")).scalars())


def details(s: Session) -> dict[str, dict]:
    """Every recorded step's detail by name; a detail that is not a JSON object reads as `{}`."""
    out: dict[str, dict] = {}
    for name, raw in s.execute(text(f"SELECT name, detail FROM {TABLE}")).all():
        try:
            detail = json.loads(raw) if raw else {}
        except (TypeError, ValueError):
            detail = {}
        out[name] = detail if isinstance(detail, dict) else {}
    return out


def record(s: Session, name: str, detail: dict) -> None:
    s.execute(
        text(f"INSERT OR REPLACE INTO {TABLE} (name, done_at, detail) VALUES (:name, :done_at, :detail)"),
        {
            "name": name,
            "done_at": datetime.now(UTC).replace(tzinfo=None).isoformat(sep=" "),
            "detail": json.dumps(detail, default=str),
        },
    )
