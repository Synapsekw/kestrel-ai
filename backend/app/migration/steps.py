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

import threading

from sqlalchemy import text

from app.migration import ports
from app.migration.pipeline import Step, StepContext

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


PIPELINE: tuple[Step, ...] = ()
