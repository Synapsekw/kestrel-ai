"""`image_summary` (image inspection spec §7.1, I-D2): per-image annotation aggregates, recomputed
from `box` for the touched images inside the writing transaction. Nothing here ever increments.

`touch` is the public call (the box service makes it in every write). `install` also hooks the
project session factory so that ORM writes and ORM bulk statements recompute their images whoever
made them (plan I-BX Ruling 1).
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import BindParameter, case, delete, event, exists, func, inspect, literal, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from app.db.models import Box, Image, ImageSummary

GROUND_TRUTH = ("accepted", "edited")
CHUNK = 500  # one bound value per id and statement: far below SQLite's 32,766-variable limit
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
    """ONE `INSERT ... SELECT ... ON CONFLICT` statement (final review Important-1): the aggregate is
    read under the statement's own write lock, so a box write can't commit between reading it and
    storing it. The SELECT is `0011`'s SEED_SUMMARY limited to `ids`; its WHERE also settles SQLite's
    upsert-after-SELECT parsing ambiguity. Ids without an image lose their row in one DELETE."""
    table = ImageSummary.__table__
    pending = Box.review_state == "unreviewed"
    counted = Box.review_state.in_(GROUND_TRUTH) & (Box.shape != "point")
    aggregate = (
        select(
            Image.id,
            func.count(case((counted, 1))),
            func.count(case((pending, 1))),
            func.max(case((pending, Box.confidence))),
            literal(datetime.now(UTC), table.c.updated_at.type),
        )
        .select_from(Image)
        .outerjoin(Box, Box.image_id == Image.id)
        .where(Image.id.in_(ids))
        .group_by(Image.id)
    )
    stmt = sqlite_insert(table).from_select(["image_id", *_COLUMNS], aggregate)
    c.execute(
        stmt.on_conflict_do_update(index_elements=["image_id"], set_={k: stmt.excluded[k] for k in _COLUMNS})
    )
    gone = ~exists().where(Image.id == table.c.image_id)
    c.execute(delete(table).where(table.c.image_id.in_(ids), gone))


_PENDING = "image_summary_pending"


def _collect(session: Session, _flush_context) -> None:
    """after_flush: `new`/`dirty`/`deleted` and attribute history still show what this flush wrote.
    A box moved to another image recomputes the image it left too (final review Minor-1)."""
    ids = session.info.setdefault(_PENDING, set())
    for obj in (*session.new, *session.dirty, *session.deleted):
        if isinstance(obj, Box):
            ids.add(obj.image_id)
            ids.update(inspect(obj).attrs.image_id.history.deleted or ())
    ids.discard(None)


def _apply(session: Session, _flush_context) -> None:
    """after_flush_postexec: recompute through the connection, so no new flush starts."""
    ids = session.info.pop(_PENDING, None)
    if ids:
        touch_many(session.connection(), ids)


def _hold_write_lock(c: Connection) -> None:
    """pysqlite defers BEGIN to the first DML, so a SELECT before it reads outside the write lock.
    Take the lock first (final review Minor-3): then nothing can commit a box write between our
    probe and the statement. Already in a transaction means a DML ran, so the lock is held."""
    raw = c.connection.driver_connection
    if getattr(raw, "isolation_level", None) is None:  # driver autocommit: no one would commit a BEGIN
        return
    if not getattr(raw, "in_transaction", True):
        c.exec_driver_sql("BEGIN IMMEDIATE")


def _is_box(state) -> bool:
    mapper = state.bind_mapper
    if mapper is not None:
        return mapper.class_ is Box
    return getattr(state.statement, "table", None) is Box.__table__  # `delete(Box.__table__)` etc.


def _rows(params) -> list[dict]:
    if isinstance(params, dict):
        return [params]
    return [p for p in params or () if isinstance(p, dict)]


def _values(stmt) -> list[dict[str, object]]:
    """The literal SET/VALUES of a statement, as `{column name: value}` dicts. A value that isn't
    a plain bound literal (a SQL expression) is kept as `_UNKNOWN`."""
    groups = [getattr(stmt, "_values", None) or {}]
    groups += [row for rows in getattr(stmt, "_multi_values", None) or () for row in rows]
    groups += [dict(getattr(stmt, "_ordered_values", None) or ())]
    out = []
    for g in groups:
        row = {}
        for k, v in g.items():
            v = getattr(v, "value", v) if isinstance(v, BindParameter) else v
            row[getattr(k, "key", k)] = v if isinstance(v, str | type(None)) else _UNKNOWN
        if row:
            out.append(row)
    return out


_UNKNOWN = object()


def _target_ids(stmt, params) -> tuple[set[str], bool]:
    """The `image_id` values a statement writes, and whether any of them can't be read literally."""
    ids, unknown = set(), False
    for row in _values(stmt) + _rows(params):
        if "image_id" in row:
            if row["image_id"] is _UNKNOWN:
                unknown = True
            elif row["image_id"]:
                ids.add(row["image_id"])
    return ids, unknown


def _matched(c: Connection, stmt, params) -> tuple[set[str], list[str]]:
    """(image ids, box ids) of the boxes an UPDATE/DELETE will change. An executemany UPDATE by
    primary key (no WHERE, a list of parameter rows) matches the listed ids only - not every box.
    Box ids are only read when the statement may move boxes (so the new images can be found)."""
    rows = _rows(params)
    by_pk = stmt.whereclause is None and isinstance(params, list) and rows and all("id" in r for r in rows)
    moves = stmt.is_update and ("image_id" in {k for r in _values(stmt) + rows for k in r})
    if by_pk:
        wanted = sorted({r["id"] for r in rows})
        pairs = [
            p
            for start in range(0, len(wanted), CHUNK)
            for p in c.execute(select(Box.image_id, Box.id).where(Box.id.in_(wanted[start : start + CHUNK])))
        ]
        return {i for i, _ in pairs}, [b for _, b in pairs] if moves else []
    where = stmt.whereclause
    if moves:
        probe = select(Box.image_id, Box.id)
        pairs = list(c.execute(probe if where is None else probe.where(where)))
        return {i for i, _ in pairs}, [b for _, b in pairs]
    probe = select(Box.image_id).distinct()
    return set(c.execute(probe if where is None else probe.where(where)).scalars()), []


def _bulk(state):
    """do_orm_execute: an ORM or Core bulk INSERT/UPDATE/DELETE on `box` through the session
    recomputes the images it wrote (final review Minor-2): for UPDATE/DELETE the images it matched
    (probed under the write lock) plus, when it moves boxes, the images they moved to; for INSERT
    the `image_id` values in its parameters."""
    if not (state.is_update or state.is_delete or state.is_insert) or not _is_box(state):
        return None
    session, stmt, params = state.session, state.statement, state.parameters
    if not session._flushing:  # pending ORM boxes must be in the table before we look
        session.flush()
    c = session.connection()
    ids, unknown = _target_ids(stmt, params)
    box_ids: list[str] = []
    if not state.is_insert:
        _hold_write_lock(c)
        matched, box_ids = _matched(c, stmt, params)
        ids |= matched
    result = state.invoke_statement()
    if box_ids and unknown:  # moved to an image given as an expression: read where they landed
        for start in range(0, len(box_ids), CHUNK):
            chunk = box_ids[start : start + CHUNK]
            ids.update(c.execute(select(Box.image_id).where(Box.id.in_(chunk))).scalars())
    touch_many(c, ids)
    return result


def install(target) -> None:
    """Hook a project sessionmaker (plan I-BX Ruling 1). Call once per factory."""
    event.listen(target, "after_flush", _collect)
    event.listen(target, "after_flush_postexec", _apply)
    event.listen(target, "do_orm_execute", _bulk)
