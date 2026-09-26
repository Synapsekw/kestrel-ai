"""The migration's data steps (foundation spec §11.4), in order.

Each step's project writes and its ledger record commit together (`app.migration.pipeline`).
Writes to the catalogue and the library commit separately, so every step is idempotent on its
own: a re-run after a crash finds what it wrote and writes nothing twice. `STORE_LOCK` serialises
the catalogue and library write sections: the library runner runs two upgrades at once, and two
projects must not both create "dump_truck".

`PIPELINE` stays empty until Task 15 arms it (see the ADR
2026-09-26-migration-framework-ships-disarmed).
"""

from __future__ import annotations

import json
import threading

from sqlalchemy import text

from app.migration import ports
from app.migration.pipeline import Step, StepContext
from app.migration.rekey import rekey_area_counts, rekey_counts, remap_classes, remap_values

DEFAULT_COLOUR = "#4f46e5"
STORE_LOCK = threading.Lock()


def old_classes(ctx: StepContext) -> list[dict]:
    """The project's old classes in their order: the migration's input, only read (spec §6.1).

    Reads the raw v1 column `legacy_classes`, never the `.classes` property: that property is
    read-only and, for a v1 project, appends every `project_type` row after the legacy list (a v1
    project that went through BC's `create` may already have one). Reading `.classes` here would
    treat those rows as old classes too and map their type ids back onto themselves."""
    raw = ctx.handle.row(ctx.session).legacy_classes or []
    usable = [c for c in raw if isinstance(c, dict) and c.get("id") and (c.get("name") or "").strip()]
    return sorted(usable, key=lambda c: c.get("order", 0))


def catalogue_merge(ctx: StepContext) -> dict:
    """Step 1: find each class's catalogue type by name, or create it as a migrated `object` type
    with the class colour and, if free, its hotkey; write `class_id_map`; flag the new types for
    classification (spec §11.4, F4)."""
    catalogue = ports.require_catalogue(ctx.env.catalogue)
    merged, created, pairs = [], [], []
    with STORE_LOCK, catalogue.session() as cs:
        for c in old_classes(ctx):
            name = c["name"].strip()
            found = ports.find_type(cs, name)
            if found is not None:
                type_id = found["id"]
                merged.append(name)
            else:
                hotkey = c.get("hotkey") or None
                if hotkey and not ports.hotkey_free(cs, hotkey):
                    hotkey = None
                colour = c.get("colour") or DEFAULT_COLOUR
                type_id = ports.create_type(cs, name=name, colour=colour, hotkey=hotkey)
                cs.flush()
                created.append(name)
            pairs.append((c["id"], type_id))
        if created:
            ports.flag_needs_classification(cs)
    for old, new in pairs:
        ctx.session.execute(
            text("INSERT OR REPLACE INTO class_id_map (old_class_id, type_id) VALUES (:old, :new)"),
            {"old": old, "new": new},
        )
    return {"types_merged": len(merged), "types_created": len(created), "merged": merged, "created": created}


ROW_TABLES = ("box", "map_detection", "map_label")
# (table, key column, {json column: rekey function}): run rows are tens per project.
JSON_ROWS = (
    ("query_run", "id", {"counts": rekey_counts, "verified_counts": rekey_counts, "class_map": remap_values}),
    (
        "map_run",
        "id",
        {
            "counts": rekey_counts,
            "verified_counts": rekey_counts,
            "area_counts": rekey_area_counts,
            "class_map": remap_values,
        },
    ),
    ("model_class_map", "library_model_id", {"mapping": remap_values}),
    ("dataset", "id", {"classes": remap_classes}),
)


def _rewrite_json(s, table: str, key: str, columns: dict, mapping: dict[str, str]) -> int:
    names = ", ".join(columns)
    changed = 0
    for row in s.execute(text(f"SELECT {key}, {names} FROM {table}")).mappings().all():
        values = {}
        for column, fn in columns.items():
            old = json.loads(row[column]) if row[column] else None
            new = fn(old, mapping)
            if new != (old if old is not None else type(new)()):
                values[column] = json.dumps(new)
        if values:
            sets = ", ".join(f"{c} = :{c}" for c in values)
            s.execute(text(f"UPDATE {table} SET {sets} WHERE {key} = :key"), {**values, "key": row[key]})
            changed += 1
    return changed


def rewrite_class_ids(ctx: StepContext) -> dict:
    """Step 2: point every class id at its catalogue type id, where old differs from new. Row
    tables with one set-based UPDATE each (no row is loaded); JSON only on run, model-map and
    dataset rows. `dataset_image.boxes` is not rewritten: legacy datasets train from their
    materialised data.yaml, whose class names are unchanged (spec §11.4)."""
    s = ctx.session
    mapping = dict(
        s.execute(text("SELECT old_class_id, type_id FROM class_id_map WHERE old_class_id != type_id")).all()
    )
    rows = {}
    for table in ROW_TABLES:
        result = s.execute(
            text(
                f"UPDATE {table} SET class_id = (SELECT m.type_id FROM class_id_map m"
                f" WHERE m.old_class_id = {table}.class_id)"
                " WHERE class_id IN (SELECT old_class_id FROM class_id_map WHERE old_class_id != type_id)"
            )
        )
        rows[table] = result.rowcount
    json_rows = sum(_rewrite_json(s, table, key, columns, mapping) for table, key, columns in JSON_ROWS)
    warnings = []
    for table in ROW_TABLES:
        orphans = s.execute(
            text(
                f"SELECT COUNT(*) FROM {table} WHERE class_id NOT IN"
                " (SELECT type_id FROM class_id_map UNION SELECT type_id FROM project_type)"
            )
        ).scalar_one()
        if orphans:
            warnings.append(
                f"{table}: {orphans} row(s) use a class that is not in the project's class list"
                " and keep their old class id"
            )
    return {
        "rows_rewritten": rows,
        "json_rows": json_rows,
        "classes_changed": len(mapping),
        "warnings": warnings,
    }


PIPELINE: tuple[Step, ...] = ()
