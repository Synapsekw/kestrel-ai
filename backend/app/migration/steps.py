"""The migration's data steps (foundation spec §11.4), in order.

Each step's project writes and its ledger record commit together (`app.migration.pipeline`).
Writes to the catalogue and the library commit separately, so every step is idempotent on its
own: a re-run after a crash finds what it wrote and writes nothing twice. `STORE_LOCK` serialises
the catalogue and library write sections: the library runner runs two upgrades at once, and two
projects must not both create "dump_truck".

`PIPELINE` is armed: every project below schema version 2 runs it (ADR
2026-09-26-migration-framework-ships-disarmed).
"""

from __future__ import annotations

import json
import threading

from sqlalchemy import text

from app.library.datasets.legacy import register_legacy_dataset
from app.library.db import LibraryDataset
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


def project_types(ctx: StepContext) -> dict:
    """Step 3: fill `project_type` from `class_id_map` in the old class order, with snapshots of the
    catalogue types (spec §7.3, F2). Rows already present (written by `create` since BC) are kept.

    A project keeps its old hotkey as `hotkey_override` when that key clashes with no catalogue
    hotkey of another type in the project and no override already given. Otherwise the catalogue's
    own hotkey applies, unless that hotkey is itself already in use by another row's override in
    this project (BC's `add_types` convention: a `hotkey_override` is a project-only string, never
    checked against the catalogue's own uniqueness) — then the row gets `hotkey_override = ""`
    ("no hotkey in this project") and a warning, rather than a silent clash with an existing row."""
    s = ctx.session
    catalogue = ports.require_catalogue(ctx.env.catalogue)
    id_map = dict(s.execute(text("SELECT old_class_id, type_id FROM class_id_map")).all())
    existing = dict(s.execute(text("SELECT type_id, position FROM project_type")).all())
    used = {k for (k,) in s.execute(text("SELECT COALESCE(hotkey_override, hotkey) FROM project_type")) if k}
    ordered, wanted = [], {}
    for c in old_classes(ctx):
        type_id = id_map.get(c["id"])
        if type_id is None or type_id in ordered:
            continue
        ordered.append(type_id)
        wanted[type_id] = c.get("hotkey") or None
    with catalogue.session() as cs:
        snaps = ports.type_rows(cs, ordered)
    missing = [t for t in ordered if t not in snaps]
    if missing:
        raise RuntimeError(f"class_id_map points at types the catalogue does not have: {missing}")
    catalogue_keys = {snaps[t]["hotkey"] for t in ordered if snaps[t]["hotkey"]}
    position = max(existing.values(), default=-1) + 1
    added = overrides = 0
    warnings = []
    for type_id in ordered:
        if type_id in existing:
            continue
        snap, key = snaps[type_id], wanted[type_id]
        override = None
        if key and key != snap["hotkey"]:
            if key in catalogue_keys or key in used:
                warnings.append(
                    f"hotkey {key} of {snap['name']} is taken in this project; it uses "
                    f"{snap['hotkey'] or 'no hotkey'}"
                )
            else:
                override = key
                overrides += 1
        effective = override or snap["hotkey"]
        if override is None and effective and effective in used:
            warnings.append(
                f"the catalogue hotkey {effective} of {snap['name']} is already used by"
                " another type in this project; it uses no hotkey"
            )
            override, effective = "", None
        if effective:
            used.add(effective)
        ports.insert_project_type(
            s, type_id=type_id, position=position, hotkey_override=override, snapshot=snap
        )
        position += 1
        added += 1
    return {"types": added, "hotkey_overrides": overrides, "warnings": warnings}


def library_class_maps(ctx: StepContext) -> dict:
    """Step 4: merge the project's `model_class_map` (values already type ids, step 2) into
    `library_model.class_map`. The first mapping wins; a conflict is reported (spec §11.4, F10)."""
    library = ports.require_library(ctx.env.library)
    rows = ctx.session.execute(text("SELECT library_model_id, mapping FROM model_class_map")).all()
    names_added = conflicts = 0
    warnings = []
    with STORE_LOCK, library.session() as ls:
        for model_id, raw in rows:
            outcome = ports.merge_class_map(ls, model_id, json.loads(raw) if raw else {})
            if outcome is None:
                warnings.append(
                    f"model {model_id} is not in the library; its class mapping was not carried over"
                )
                continue
            added, clashes = outcome
            names_added += added
            for name, kept, ours in clashes:
                conflicts += 1
                warnings.append(
                    f"model {model_id}: {name!r} stays mapped to {kept}; this project mapped it to {ours}"
                )
    return {"models": len(rows), "names_added": names_added, "conflicts": conflicts, "warnings": warnings}


class _OriginHandle:
    """A stand-in for BM's `register_legacy_dataset`, which resolves a dataset's folder from
    `handle.folder`. In a dry run the real handle is the copied database, which has no
    `datasets/`; this proxy reports the ORIGINAL project folder instead, and delegates everything
    else BM uses (`id`, `session`, `row`) to the real handle."""

    def __init__(self, handle, folder):
        self.folder, self._handle = folder, handle

    @property
    def id(self):
        return self._handle.id

    def session(self):
        return self._handle.session()

    def row(self, s):
        return self._handle.row(s)


def _never_built(name: str, path: str) -> str:
    return f"dataset {name} was never built on disk ({path}); it is not carried into Models"


def _dataset_per_class(s, dataset_id: str, id_map: dict[str, str]) -> dict[str, int]:
    """Boxes per catalogue type for one dataset, counted in SQL (`json_each`): no row is loaded."""
    per_class: dict[str, int] = {}
    for old, n in s.execute(
        text(
            "SELECT json_extract(b.value, '$.class_id'), COUNT(*) FROM dataset_image di,"
            " json_each(di.boxes) b WHERE di.dataset_id = :d GROUP BY 1"
        ),
        {"d": dataset_id},
    ).all():
        key = id_map.get(old, old)
        per_class[key] = per_class.get(key, 0) + n
    return per_class


def legacy_datasets(ctx: StepContext) -> dict:
    """Step 5: register each materialised project dataset in the library as a legacy dataset,
    through BM's `register_legacy_dataset`, so it stays trainable from Models (spec §6.1, §11.4,
    §12.1). The folder is found under the original project folder (`ctx.env.origin_folder`), never
    a dry run's copy, through the `_OriginHandle` proxy above. BM is idempotent on `legacy_path`,
    but the check-then-register-then-fill sequence for one dataset still runs under `STORE_LOCK`:
    two workers racing here would both pass the pre-check and collide on the unique dataset name.
    BM leaves `counts.per_class` empty; this step fills it (bounded `json_each` SQL) in the same
    library session it reads the new row's name back from."""
    library = ports.require_library(ctx.env.library)
    s = ctx.session
    origin = _OriginHandle(ctx.handle, ctx.env.origin_folder)
    id_map = dict(s.execute(text("SELECT old_class_id, type_id FROM class_id_map")).all())
    rows = s.execute(text("SELECT id, name, path FROM dataset ORDER BY created_at, id")).mappings().all()
    names, already, warnings = [], 0, []
    for d in rows:
        root = (ctx.env.origin_folder / d["path"]).resolve()
        if not (root / "data.yaml").is_file():
            warnings.append(_never_built(d["name"], d["path"]))
            continue
        with STORE_LOCK:
            with library.session() as ls:
                existing = ports.legacy_dataset_by_path(ls, str(root))
            if existing is not None:
                already += 1
                continue
            dataset_id = register_legacy_dataset(library, origin, d["id"])
            if dataset_id is None:
                warnings.append(_never_built(d["name"], d["path"]))
                continue
            with library.session() as ls:
                row = ls.get(LibraryDataset, dataset_id)
                if not row.counts.get("per_class"):
                    row.counts = {**row.counts, "per_class": _dataset_per_class(s, d["id"], id_map)}
                names.append(row.name)
    return {"registered": len(names), "names": names, "already_registered": already, "warnings": warnings}


FINDING_BATCH = 1000


def findings_from_annotations(ctx: StepContext) -> dict:
    """Step 6: findings from accepted boxes on the project's **defect** types, through BC's one
    implementation (`app.findings.backfill.findings_from_annotations`, spec §7.2 and §11.4): batched,
    one transaction per batch, idempotent on `annotation_id`, so a resumed step creates none twice.
    With F4 every migrated type is an `object`, so this is normally empty; the Catalogue's backfill
    runs the same function later for a type the operator marks as a defect.

    BC's function opens and commits its own session per batch, so the step must not hold one across
    the call: `ctx.session.commit()` releases the step's (otherwise unused) read snapshot first, a
    no-op when nothing was read through it, before touching `ctx.session` again."""
    from app.findings.backfill import findings_from_annotations as create_findings

    ctx.session.commit()
    if getattr(ctx.handle, "catalogue", None) is None:
        ctx.handle.catalogue = ctx.env.catalogue  # BC's function reads the catalogue through the handle
    created = create_findings(
        ctx.handle,
        None,
        batch=FINDING_BATCH,
        check_cancelled=ctx.env.check_cancelled,
        progress=lambda done, total: ctx.env.progress(
            0.8, f"Created {done} of {total} findings from accepted annotations"
        ),
    )
    return {"findings_created": created}


def counts_rebuild(ctx: StepContext) -> dict:
    """Step 7: rebuild `finding_count` and `finding_daily` from `finding` (the counts module is
    their only writer), and log "Project upgraded" once in the activity feed."""
    s = ctx.session
    result = ports.rebuild_counts(s)
    ports.add_activity_once(
        s,
        kind="job.finished",
        subject_id=ctx.handle.id,
        summary="Project upgraded",
        payload={"job_type": "project_migrate", "findings": result["findings"]},
    )
    return {"findings": result["findings"]}


PIPELINE: tuple[Step, ...] = (
    Step("catalogue_merge", "Merging the project's classes into the catalogue", catalogue_merge),
    Step("rewrite_class_ids", "Pointing annotations and detections at catalogue types", rewrite_class_ids),
    Step("project_types", "Building the project's type list", project_types),
    Step("library_class_maps", "Moving model class mappings into the library", library_class_maps),
    Step("legacy_datasets", "Registering the project's datasets in Models", legacy_datasets),
    Step(
        "findings_from_annotations",
        "Creating findings from accepted defect annotations",
        findings_from_annotations,
    ),
    Step("counts_rebuild", "Counting findings", counts_rebuild),
)
