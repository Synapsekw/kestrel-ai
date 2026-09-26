"""Everything the migration steps use from units BC (catalogue, findings) and BM (library
datasets, class maps), in one file (foundation spec §7, §8, §12).

Plain SQL against the tables and columns the spec fixes, so the steps depend on the schema, not
on Python names another unit was free to choose. `tests/test_migration_ports.py` checks every
column named here against the merged migrations: when it fails, fix this file, not the steps.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.catalogue.handle import open_catalogue_db  # BC: open catalogue.db under a data dir
from app.catalogue.names import normalise_hotkey  # BC: the hotkey rule (1-9 or a letter, or None)
from app.catalogue.service import NEEDS_CLASSIFICATION, normalise_name  # BC: the name rule (spec §7.1)
from app.db.base import new_id
from app.errors import AppError
from app.findings import activity as finding_activity  # BC: the one writer of `activity` (kind check)
from app.findings import counts as finding_counts  # BC: the only writer of the counts (spec §8.4)

__all__ = ["normalise_name", "open_catalogue_db"]

CATALOGUE_TYPE = (
    "id",
    "name",
    "name_key",
    "colour",
    "kind",
    "default_severity",
    "hotkey",
    "group",
    "archived",
    "origin",
    "created_at",
    "updated_at",
)
CATALOGUE_META = ("key", "value")
PROJECT_TYPE = (
    "type_id",
    "position",
    "hotkey_override",
    "name",
    "colour",
    "kind",
    "default_severity",
    "hotkey",
    "group",
    "refreshed_at",
)
CLASS_ID_MAP = ("old_class_id", "type_id")
FINDING = (
    "id",
    "number",
    "type_id",
    "severity",
    "status",
    "note",
    "created_by",
    "confidence",
    "anchor_kind",
    "image_id",
    "annotation_id",
    "lon",
    "lat",
    "data_type",
    "data_id",
    "created_at",
    "updated_at",
    "reviewed_at",
)
FINDING_COUNT = ("status", "severity", "type_id", "n")
ACTIVITY = ("id", "at", "kind", "subject_id", "summary", "payload")
LIBRARY_MODEL = ("id", "class_map")
# Trimmed to what MG reads: legacy dataset registration itself is BM's `register_legacy_dataset`
# (Task 13); MG only checks whether a legacy path is already registered.
LIBRARY_DATASET = ("id", "name", "origin", "filter", "legacy_path", "legacy_dataset_id", "counts")
DATASET_SOURCE = ("dataset_id", "project_id", "project_folder", "project_name", "image_count")
_TYPE_COLUMNS = 'id, name, colour, kind, default_severity, hotkey, "group"'


class MigrationBlocked(Exception):
    """A store the step needs is not open: the job fails with this message, and Retry re-runs it."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def now() -> str:
    """UTC, in the format SQLAlchemy's `UTCDateTime`/sqlite `DATETIME` stores and parses
    (`YYYY-MM-DD HH:MM:SS.ffffff`, always 6 microsecond digits), so a raw-SQL timestamp round-trips
    through the ORM the same way a `utcnow()`-stamped row does."""
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S.%f")


def require_catalogue(catalogue):
    if catalogue is None:
        raise MigrationBlocked(
            "The catalogue is not open, so the project's classes cannot be merged into it."
        )
    return catalogue


def require_library(library):
    if library is None:
        raise MigrationBlocked("The model library is not open.")
    return library


# ---- catalogue.db --------------------------------------------------------------------------------


def find_type(cs: Session, name: str) -> dict | None:
    """The non-archived type whose `name_key` matches `name`'s (spec §7.1), oldest first. `name_key`
    is stored and indexed (partial unique on `archived = 0`), so this is a bounded, indexed lookup,
    not a Python scan."""
    key = normalise_name(name)
    row = (
        cs.execute(
            text(
                f"SELECT {_TYPE_COLUMNS} FROM catalogue_type WHERE name_key = :k AND archived = 0"
                " ORDER BY created_at, id LIMIT 1"
            ),
            {"k": key},
        )
        .mappings()
        .first()
    )
    return dict(row) if row is not None else None


def hotkey_free(cs: Session, hotkey: str | None) -> bool:
    try:
        key = normalise_hotkey(hotkey)
    except AppError:
        return True  # an invalid key holds nothing, so nothing is "taken"
    if key is None:
        return True
    found = cs.execute(
        text("SELECT 1 FROM catalogue_type WHERE hotkey = :h AND archived = 0 LIMIT 1"), {"h": key}
    ).first()
    return found is None


def create_type(cs: Session, *, name: str, colour: str, hotkey: str | None) -> str:
    """A migrated type: kind `object` (F4), origin `migrated`, no severity, no group. An invalid
    hotkey means no hotkey, the same convention as BC's `ensure_types`."""
    try:
        key = normalise_hotkey(hotkey)
    except AppError:
        key = None
    type_id, stamp, name_key = new_id(), now(), normalise_name(name)
    cs.execute(
        text(
            "INSERT INTO catalogue_type (id, name, name_key, colour, kind, default_severity, hotkey,"
            ' "group", archived, origin, created_at, updated_at) VALUES (:id, :name, :name_key, :colour,'
            " 'object', NULL, :hotkey, NULL, 0, 'migrated', :t, :t)"
        ),
        {"id": type_id, "name": name, "name_key": name_key, "colour": colour, "hotkey": key, "t": stamp},
    )
    return type_id


def flag_needs_classification(cs: Session) -> None:
    """BC's convention for this flag (the Overview banner reads `.get("count")`): `{"count": N}`,
    N = the number of non-archived `origin = 'migrated'` types now in the catalogue."""
    count = cs.execute(
        text("SELECT COUNT(*) FROM catalogue_type WHERE archived = 0 AND origin = 'migrated'")
    ).scalar_one()
    cs.execute(
        text("INSERT OR REPLACE INTO catalogue_meta (key, value) VALUES (:k, :v)"),
        {"k": NEEDS_CLASSIFICATION, "v": json.dumps({"count": count})},
    )


def type_rows(cs: Session, ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    params = {f"i{n}": i for n, i in enumerate(ids)}
    placeholders = ", ".join(f":{k}" for k in params)
    rows = cs.execute(
        text(f"SELECT {_TYPE_COLUMNS} FROM catalogue_type WHERE id IN ({placeholders})"), params
    )
    return {r["id"]: dict(r) for r in rows.mappings()}


# ---- project.db ----------------------------------------------------------------------------------


def insert_project_type(
    s: Session, *, type_id: str, position: int, hotkey_override: str | None, snapshot: dict
) -> None:
    s.execute(
        text(
            "INSERT INTO project_type (type_id, position, hotkey_override, name, colour, kind,"
            ' default_severity, hotkey, "group", refreshed_at) VALUES (:type_id, :position, :override,'
            " :name, :colour, :kind, :severity, :hotkey, :grp, :refreshed)"
        ),
        {
            "type_id": type_id,
            "position": position,
            "override": hotkey_override,
            "name": snapshot["name"],
            "colour": snapshot["colour"],
            "kind": snapshot["kind"],
            "severity": snapshot["default_severity"],
            "hotkey": snapshot["hotkey"],
            "grp": snapshot["group"],
            "refreshed": now(),
        },
    )


def rebuild_counts(s: Session) -> dict:
    return finding_counts.recount(s)


def add_activity_once(s: Session, *, kind: str, subject_id: str, summary: str, payload: dict) -> bool:
    """Once per (kind, subject_id, summary) — spec §16's "Project upgraded" activity is written once,
    even across re-runs. Writes through BC's `activity.record`, so the kind check and timestamp are
    BC's, not a raw INSERT of our own."""
    exists = s.execute(
        text("SELECT 1 FROM activity WHERE kind = :k AND subject_id = :s AND summary = :m LIMIT 1"),
        {"k": kind, "s": subject_id, "m": summary},
    ).first()
    if exists is not None:
        return False
    finding_activity.record(s, kind, subject_id, summary, payload)
    s.flush()  # raw-SQL existence checks in this same session do not autoflush a pending ORM add
    return True


# ---- library.db ----------------------------------------------------------------------------------


def merge_class_map(ls: Session, model_id: str, mapping: dict):
    """Merge a project's {model class name: type id | None} into the model's app-wide map. The first
    mapping wins (spec §11.4 step 4). None when the model is not in the library."""
    row = ls.execute(text("SELECT class_map FROM library_model WHERE id = :id"), {"id": model_id}).first()
    if row is None:
        return None
    current = json.loads(row[0]) if row[0] else {}
    added, clashes = 0, []
    for name, type_id in mapping.items():
        if name not in current:
            current[name] = type_id
            added += 1
        elif current[name] != type_id:
            clashes.append((name, current[name], type_id))
    if added:
        ls.execute(
            text("UPDATE library_model SET class_map = :m WHERE id = :id"),
            {"m": json.dumps(current), "id": model_id},
        )
    return added, clashes


def legacy_dataset_by_path(ls: Session, path: str) -> str | None:
    """The dataset already registered for this original legacy path, if any (idempotency for Task
    13's step; the writer itself is BM's `register_legacy_dataset`)."""
    return ls.execute(
        text("SELECT id FROM dataset WHERE origin = 'legacy' AND legacy_path = :p"), {"p": path}
    ).scalar_one_or_none()
