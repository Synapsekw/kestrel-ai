"""`image_summary` (image inspection spec §7.1, I-D2): per-image annotation aggregates, recomputed
from `box` for the touched images inside the writing transaction. Nothing here ever increments.

`touch` is the public call (the box service makes it in every write). `install` also hooks the
project session factory so that ORM writes and ORM bulk statements recompute their images whoever
made them (plan I-BX Ruling 1).
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import case, delete, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from app.db.models import Box, Image, ImageSummary

GROUND_TRUTH = ("accepted", "edited")
CHUNK = 500  # 5 bound values a row: far below SQLite's 32,766-variable limit
_COLUMNS = ("annotation_count", "pending_count", "max_pending_conf", "updated_at")


def _connection(conn: Session | Connection) -> Connection:
    if isinstance(conn, Session):
        conn.flush()  # the caller's pending box changes must be visible to the aggregate
        return conn.connection()
    return conn


def touch(s: Session | Connection, image_id: str) -> None:
    """Recompute one image's summary row now, in the caller's transaction (C0 ruling 10: the box
    service passes its Session; the session events below pass a Connection)."""
    touch_many(s, [image_id])


def touch_many(conn: Session | Connection, image_ids: Iterable[str]) -> int:
    """Recompute the rows of `image_ids` (duplicates and empties ignored); returns how many ids.
    The semantics are exactly `0011`'s SEED_SUMMARY (C0 ruling 4)."""
    ids = sorted({i for i in image_ids if i})
    if not ids:
        return 0
    c = _connection(conn)
    for start in range(0, len(ids), CHUNK):
        _recompute(c, ids[start : start + CHUNK])
    return len(ids)


def _recompute(c: Connection, ids: list[str]) -> None:
    pending = Box.review_state == "unreviewed"
    counted = Box.review_state.in_(GROUND_TRUTH) & (Box.shape != "point")
    agg = {
        image_id: (int(n or 0), int(p or 0), conf)
        for image_id, n, p, conf in c.execute(
            select(
                Box.image_id,
                func.sum(case((counted, 1), else_=0)),
                func.sum(case((pending, 1), else_=0)),
                func.max(case((pending, Box.confidence), else_=None)),
            )
            .where(Box.image_id.in_(ids))
            .group_by(Box.image_id)
        )
    }
    live = set(c.execute(select(Image.id).where(Image.id.in_(ids))).scalars())
    now = datetime.now(UTC)
    values = [
        {
            "image_id": i,
            "annotation_count": agg.get(i, (0, 0, None))[0],
            "pending_count": agg.get(i, (0, 0, None))[1],
            "max_pending_conf": agg.get(i, (0, 0, None))[2],
            "updated_at": now,
        }
        for i in ids
        if i in live
    ]
    table = ImageSummary.__table__
    if values:
        stmt = sqlite_insert(table).values(values)
        stmt = stmt.on_conflict_do_update(
            index_elements=["image_id"], set_={k: stmt.excluded[k] for k in _COLUMNS}
        )
        c.execute(stmt)
    gone = [i for i in ids if i not in live]
    if gone:
        c.execute(delete(table).where(table.c.image_id.in_(gone)))
